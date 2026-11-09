import {
  assembleCodeMapFile,
  CodeMapBlobSchema,
  CodeMapBlobShaSchema,
  CodeMapCommitSchema,
  CodeMapCountsSchema,
  CodeMapEntryDataSchema,
  CodeMapErrorCodeSchema,
  CodeMapPathSchema,
  CODE_MAP_INDEXER_VERSION,
  type CodeMapBlob,
  type CodeMapCounts,
  type CodeMapEntryData,
  type CodeMapErrorCode,
  type CodeMapFile,
  type CodeMapManifest,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  parseInput,
  parseStored,
  parseStoredJson,
  placeholders,
  requireNonEmpty,
  storedTimestamp,
  toStoredTimestamp,
} from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

/** Ready manifests kept per project; older ones (and blobs only they used) are deleted. */
export const CODE_MAP_KEPT_MANIFESTS = 5;

export interface CodeMapManifestRecord {
  id: string;
  projectId: string;
  commit: string;
  builtAt: string;
  indexerVersion: number;
  status: 'ready' | 'failed';
  /** Null for a failed build. */
  counts: CodeMapCounts | null;
  /** Null for a ready build. */
  error: CodeMapErrorCode | null;
}

export interface CodeMapEntryInput {
  path: string;
  blobSha: string;
  sizeBytes: number;
  data: CodeMapEntryData;
}

export interface CodeMapManifestInput {
  projectId: string;
  commit: string;
  builtAt: string;
  indexerVersion: number;
  counts: CodeMapCounts;
  entries: readonly CodeMapEntryInput[];
}

export interface CodeMapFailureInput {
  projectId: string;
  commit: string;
  builtAt: string;
  indexerVersion: number;
  error: CodeMapErrorCode;
}

export interface CodeMapRepository {
  /** The cached parse results among `shas` made by this indexer version. */
  getBlobs(projectId: string, shas: readonly string[]): Map<string, CodeMapBlob>;
  /** Stores (or replaces) parse results, in one transaction. */
  putBlobs(projectId: string, blobs: readonly { blobSha: string; blob: CodeMapBlob }[]): void;
  getManifest(projectId: string, commit: string): CodeMapManifestRecord | undefined;
  /** The newest manifest of any status. */
  latest(projectId: string): CodeMapManifestRecord | undefined;
  /** The newest ready manifest. */
  latestReady(projectId: string): CodeMapManifestRecord | undefined;
  /** Every stored manifest, newest first. */
  listManifests(projectId: string): CodeMapManifestRecord[];
  /**
   * Stores a ready manifest and its entries in one transaction, replacing any row for the same
   * commit, then keeps the newest CODE_MAP_KEPT_MANIFESTS ready manifests and the newest failure
   * and deletes blobs no kept manifest uses. `not_found` for an unknown project.
   */
  insertManifest(input: CodeMapManifestInput): CodeMapManifestRecord;
  /** Records a failed build (replacing an older failure for the commit, never a ready map). */
  recordFailure(input: CodeMapFailureInput): CodeMapManifestRecord;
  /** A manifest's files, sorted by path, assembled from entries and cached blobs. */
  listFiles(manifestId: string): CodeMapFile[];
}

/** A ready record as core's manifest. */
export function toCodeMapManifest(record: CodeMapManifestRecord): CodeMapManifest {
  if (record.counts === null) throw new DbError('invalid_input', 'a failed build has no manifest');
  return {
    projectId: record.projectId,
    commit: record.commit,
    builtAt: record.builtAt,
    indexerVersion: record.indexerVersion,
    counts: record.counts,
  };
}

interface ManifestDbRow {
  id: string;
  project_id: string;
  commit_sha: string;
  built_at: string;
  indexer_version: number;
  counts: string | null;
  status: string;
  error: string | null;
}

interface FileDbRow {
  path: string;
  size_bytes: number;
  data: string;
  blob_data: string | null;
  blob_version: number | null;
}

const M = 'code_map_manifests';
const COLUMNS = 'id, project_id, commit_sha, built_at, indexer_version, counts, status, error';
/** Below SQLite's parameter limit, with room for the project id. */
const CHUNK = 500;

function toRecord(row: ManifestDbRow): CodeMapManifestRecord {
  const status = row.status === 'ready' ? 'ready' : row.status === 'failed' ? 'failed' : null;
  if (status === null) throw new DbError('invalid_input', `${M}.status is not a known status`);
  return {
    id: row.id,
    projectId: row.project_id,
    commit: parseStored(CodeMapCommitSchema, row.commit_sha, M, 'commit_sha'),
    builtAt: storedTimestamp(row.built_at, M, 'built_at'),
    indexerVersion: row.indexer_version,
    status,
    counts:
      row.counts === null ? null : parseStoredJson(CodeMapCountsSchema, row.counts, M, 'counts'),
    error: row.error === null ? null : parseStored(CodeMapErrorCodeSchema, row.error, M, 'error'),
  };
}

export function createCodeMapRepository(ctx: RepositoryContext): CodeMapRepository {
  const c = ctx.connection;
  const putBlob = c.prepare(
    `INSERT INTO code_map_blobs (project_id, blob_sha, indexer_version, data) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id, blob_sha) DO UPDATE SET
       indexer_version = excluded.indexer_version, data = excluded.data`,
  );
  const byCommit = c.prepare(`SELECT ${COLUMNS} FROM ${M} WHERE project_id = ? AND commit_sha = ?`);
  const newest = c.prepare(
    `SELECT ${COLUMNS} FROM ${M} WHERE project_id = ? ORDER BY built_at DESC, rowid DESC LIMIT 1`,
  );
  const newestReady = c.prepare(
    `SELECT ${COLUMNS} FROM ${M} WHERE project_id = ? AND status = 'ready'
     ORDER BY built_at DESC, rowid DESC LIMIT 1`,
  );
  const all = c.prepare(
    `SELECT ${COLUMNS} FROM ${M} WHERE project_id = ? ORDER BY built_at DESC, rowid DESC`,
  );
  const deleteForCommit = c.prepare(`DELETE FROM ${M} WHERE project_id = ? AND commit_sha = ?`);
  const insertManifest = c.prepare(
    `INSERT INTO ${M} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const insertEntry = c.prepare(
    `INSERT INTO code_map_entries (manifest_id, path, blob_sha, size_bytes, data)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const pruneReady = c.prepare(
    `DELETE FROM ${M} WHERE project_id = ? AND status = 'ready' AND id NOT IN (
       SELECT id FROM ${M} WHERE project_id = ? AND status = 'ready'
       ORDER BY built_at DESC, rowid DESC LIMIT ${CODE_MAP_KEPT_MANIFESTS})`,
  );
  const pruneFailed = c.prepare(
    `DELETE FROM ${M} WHERE project_id = ? AND status = 'failed' AND id NOT IN (
       SELECT id FROM ${M} WHERE project_id = ? AND status = 'failed'
       ORDER BY built_at DESC, rowid DESC LIMIT 1)`,
  );
  const pruneBlobs = c.prepare(
    `DELETE FROM code_map_blobs WHERE project_id = ? AND NOT EXISTS (
       SELECT 1 FROM code_map_entries e JOIN ${M} m ON m.id = e.manifest_id
       WHERE m.project_id = code_map_blobs.project_id AND e.blob_sha = code_map_blobs.blob_sha)`,
  );
  const files = c.prepare(
    `SELECT e.path, e.size_bytes, e.data, b.data AS blob_data, b.indexer_version AS blob_version
     FROM code_map_entries e
     JOIN ${M} m ON m.id = e.manifest_id
     LEFT JOIN code_map_blobs b ON b.project_id = m.project_id AND b.blob_sha = e.blob_sha
     WHERE e.manifest_id = ? ORDER BY e.path`,
  );

  function prune(projectId: string): void {
    pruneReady.run(projectId, projectId);
    pruneFailed.run(projectId, projectId);
    pruneBlobs.run(projectId);
  }

  const putBlobs = c.transaction(
    (projectId: string, rows: readonly { sha: string; data: string }[]) => {
      for (const r of rows) putBlob.run(projectId, r.sha, CODE_MAP_INDEXER_VERSION, r.data);
    },
  );

  const storeManifest = c.transaction((input: CodeMapManifestInput, builtAt: string) => {
    deleteForCommit.run(input.projectId, input.commit);
    const row = insertManifest.get(
      ctx.newId(),
      input.projectId,
      input.commit,
      builtAt,
      input.indexerVersion,
      JSON.stringify(input.counts),
      'ready',
      null,
    ) as ManifestDbRow;
    for (const e of input.entries) {
      insertEntry.run(row.id, e.path, e.blobSha, e.sizeBytes, JSON.stringify(e.data));
    }
    prune(input.projectId);
    return row;
  });

  const storeFailure = c.transaction((input: CodeMapFailureInput, builtAt: string) => {
    const existing = byCommit.get(input.projectId, input.commit) as ManifestDbRow | undefined;
    if (existing?.status === 'ready') {
      throw new DbError('conflict', 'a ready code map exists for this commit');
    }
    deleteForCommit.run(input.projectId, input.commit);
    const row = insertManifest.get(
      ctx.newId(),
      input.projectId,
      input.commit,
      builtAt,
      input.indexerVersion,
      null,
      'failed',
      input.error,
    ) as ManifestDbRow;
    prune(input.projectId);
    return row;
  });

  return {
    getBlobs(projectId, shas) {
      const out = new Map<string, CodeMapBlob>();
      const unique = [...new Set(shas)];
      for (let i = 0; i < unique.length; i += CHUNK) {
        const chunk = unique.slice(i, i + CHUNK);
        const rows = c
          .prepare(
            `SELECT blob_sha, indexer_version, data FROM code_map_blobs
             WHERE project_id = ? AND blob_sha IN (${placeholders(chunk.length)})`,
          )
          .all(projectId, ...chunk) as {
          blob_sha: string;
          indexer_version: number;
          data: string;
        }[];
        for (const r of rows) {
          if (r.indexer_version !== CODE_MAP_INDEXER_VERSION) continue;
          out.set(r.blob_sha, parseStoredJson(CodeMapBlobSchema, r.data, 'code_map_blobs', 'data'));
        }
      }
      return out;
    },
    putBlobs(projectId, blobs) {
      requireNonEmpty(projectId, 'projectId');
      const rows = blobs.map((b) => ({
        sha: parseInput(CodeMapBlobShaSchema, b.blobSha, 'blob sha'),
        data: JSON.stringify(parseInput(CodeMapBlobSchema, b.blob, 'code map blob')),
      }));
      guardWrite('code map blob', () => putBlobs(projectId, rows));
    },
    getManifest(projectId, commit) {
      const row = byCommit.get(projectId, commit) as ManifestDbRow | undefined;
      return row && toRecord(row);
    },
    latest(projectId) {
      const row = newest.get(projectId) as ManifestDbRow | undefined;
      return row && toRecord(row);
    },
    latestReady(projectId) {
      const row = newestReady.get(projectId) as ManifestDbRow | undefined;
      return row && toRecord(row);
    },
    listManifests(projectId) {
      return (all.all(projectId) as ManifestDbRow[]).map(toRecord);
    },
    insertManifest(input) {
      requireNonEmpty(input.projectId, 'projectId');
      parseInput(CodeMapCommitSchema, input.commit, 'commit');
      parseInput(CodeMapCountsSchema, input.counts, 'code map counts');
      for (const e of input.entries) {
        parseInput(CodeMapPathSchema, e.path, 'code map path');
        parseInput(CodeMapBlobShaSchema, e.blobSha, 'blob sha');
        parseInput(CodeMapEntryDataSchema, e.data, 'code map entry');
      }
      const builtAt = toStoredTimestamp(input.builtAt, 'builtAt');
      return toRecord(guardWrite('code map manifest', () => storeManifest(input, builtAt)));
    },
    recordFailure(input) {
      requireNonEmpty(input.projectId, 'projectId');
      parseInput(CodeMapCommitSchema, input.commit, 'commit');
      parseInput(CodeMapErrorCodeSchema, input.error, 'code map error');
      const builtAt = toStoredTimestamp(input.builtAt, 'builtAt');
      return toRecord(guardWrite('code map failure', () => storeFailure(input, builtAt)));
    },
    listFiles(manifestId) {
      return (files.all(requireNonEmpty(manifestId, 'manifestId')) as FileDbRow[]).map((r) => {
        const entry = parseStoredJson(CodeMapEntryDataSchema, r.data, 'code_map_entries', 'data');
        // A blob row from another indexer version is not trusted to match this one's shape.
        const blob =
          r.blob_data === null || r.blob_version !== CODE_MAP_INDEXER_VERSION
            ? null
            : parseStoredJson(CodeMapBlobSchema, r.blob_data, 'code_map_blobs', 'data');
        return assembleCodeMapFile(r.path, r.size_bytes, blob, entry);
      });
    },
  };
}
