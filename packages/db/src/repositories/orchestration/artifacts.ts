import type { IsoTimestamp } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  nonEmptyOrNull,
  parseInput,
  parseStored,
  requireNonEmpty,
  storedTimestamp,
} from '../../internal/validate.js';
import { guardWrite, literalParser, nonNegativeInt } from './shared.js';

/** M1 artifacts: a worker's patch and its changed-file manifest. Not in core yet (proposed). */
export const ARTIFACT_KINDS = ['patch', 'manifest'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
const KindParser = literalParser(ARTIFACT_KINDS);

export interface ArtifactInsertInput {
  runId: string;
  /** The producing agent (must belong to `runId`), or null for a run-level artifact. */
  agentRunId: string | null;
  kind: ArtifactKind;
  /**
   * Where the file lives, relative to the data dir, '/'-separated (e.g.
   * `artifacts/<run>/<agent>/patch.diff`). Absolute paths and '..' segments are rejected so a
   * stored path can never point outside the data dir.
   */
  storagePath: string;
  /** Lowercase hex sha256 of the file content. */
  sha256: string;
  sizeBytes: number;
}

export interface ArtifactRow extends ArtifactInsertInput {
  id: string;
  createdAt: IsoTimestamp;
}

/** Artifacts are immutable: there is no update; rows go with their run. */
export interface ArtifactsRepository {
  insert(input: ArtifactInsertInput): ArtifactRow;
  getById(id: string): ArtifactRow | undefined;
  /** Oldest first. */
  listForRun(runId: string): ArtifactRow[];
  /** Oldest first. */
  listForAgentRun(agentRunId: string): ArtifactRow[];
}

interface ArtifactDbRow {
  id: string;
  run_id: string;
  agent_run_id: string | null;
  kind: string;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  created_at: string;
}

const T = 'artifacts';
const COLUMNS = 'id, run_id, agent_run_id, kind, storage_path, sha256, size_bytes, created_at';
const SHA256 = /^[0-9a-f]{64}$/;

/** Validates a data-dir-relative path; exported for tests and callers that build paths. */
export function isSafeStoragePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  // Windows drive letters ("C:...") would be absolute there.
  if (/^[a-zA-Z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function toArtifact(row: ArtifactDbRow): ArtifactRow {
  return {
    id: row.id,
    runId: row.run_id,
    agentRunId: row.agent_run_id,
    kind: parseStored(KindParser, row.kind, T, 'kind'),
    storagePath: row.storage_path,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    createdAt: storedTimestamp(row.created_at, T, 'created_at'),
  };
}

export function createArtifactsRepository(ctx: RepositoryContext): ArtifactsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const forRun = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY created_at, rowid`,
  );
  const forAgent = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE agent_run_id = ? ORDER BY created_at, rowid`,
  );

  return {
    insert(input) {
      const kind = parseInput(KindParser, input.kind, 'artifact kind');
      if (typeof input.storagePath !== 'string' || !isSafeStoragePath(input.storagePath)) {
        throw new DbError(
          'invalid_input',
          'artifact storagePath must be relative to the data dir, without ".." segments',
        );
      }
      if (typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)) {
        throw new DbError('invalid_input', 'artifact sha256 must be 64 lowercase hex characters');
      }
      const sizeBytes = parseInput(nonNegativeInt, input.sizeBytes, 'artifact sizeBytes');
      return guardWrite('artifact', () =>
        toArtifact(
          insert.get(
            ctx.newId(),
            requireNonEmpty(input.runId, 'artifact runId'),
            nonEmptyOrNull(input.agentRunId, 'artifact agentRunId'),
            kind,
            input.storagePath,
            input.sha256,
            sizeBytes,
            ctx.now().toISOString(),
          ) as ArtifactDbRow,
        ),
      );
    },
    getById(id) {
      const row = byId.get(id) as ArtifactDbRow | undefined;
      return row && toArtifact(row);
    },
    listForRun(runId) {
      return (forRun.all(runId) as ArtifactDbRow[]).map(toArtifact);
    },
    listForAgentRun(agentRunId) {
      return (forAgent.all(agentRunId) as ArtifactDbRow[]).map(toArtifact);
    },
  };
}
