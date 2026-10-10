import type { Checkpoint, CheckpointStore, IsoTimestamp } from '@acp/core';
import { DbError } from '../errors.js';
import type { RepositoryContext } from '../internal/context.js';
import { requireNonEmpty, storedTimestamp } from '../internal/validate.js';

export interface StoredCheckpoint extends Checkpoint {
  updatedAt: IsoTimestamp;
}

/**
 * Restart-safe read positions (domain-model §3 IngestionCheckpoint). Implements core's
 * `CheckpointStore` so it can be handed to an adapter's `poll()` directly. `set` must run in the
 * same transaction as the events read up to that checkpoint.
 */
export interface CheckpointsRepository extends CheckpointStore {
  get(sourcePath: string): Checkpoint | undefined;
  set(checkpoint: Checkpoint): void;
  list(): StoredCheckpoint[];
  remove(sourcePath: string): boolean;
}

interface CheckpointDbRow {
  source_path: string;
  file_identity: string;
  size_bytes: number;
  mtime_ms: number;
  byte_offset: number;
  head_hash: string;
  parse_errors: number;
  updated_at: string;
}

const COLUMNS = `source_path, file_identity, size_bytes, mtime_ms, byte_offset, head_hash,
  parse_errors, updated_at`;

function toCheckpoint(row: CheckpointDbRow): Checkpoint {
  return {
    sourcePath: row.source_path,
    fileIdentity: row.file_identity,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    byteOffset: row.byte_offset,
    headHash: row.head_hash,
    parseErrors: row.parse_errors,
  };
}

function nonNegativeInt(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DbError('invalid_input', `${what} must be a non-negative integer`);
  }
  return value;
}

export function createCheckpointsRepository(ctx: RepositoryContext): CheckpointsRepository {
  const c = ctx.connection;
  const get = c.prepare(`SELECT ${COLUMNS} FROM ingestion_checkpoints WHERE source_path = ?`);
  const set = c.prepare(`
    INSERT INTO ingestion_checkpoints (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_path) DO UPDATE SET
      file_identity = excluded.file_identity,
      size_bytes = excluded.size_bytes,
      mtime_ms = excluded.mtime_ms,
      byte_offset = excluded.byte_offset,
      head_hash = excluded.head_hash,
      parse_errors = excluded.parse_errors,
      updated_at = excluded.updated_at`);
  const all = c.prepare(`SELECT ${COLUMNS} FROM ingestion_checkpoints ORDER BY source_path`);
  const remove = c.prepare('DELETE FROM ingestion_checkpoints WHERE source_path = ?');

  return {
    get(sourcePath) {
      const row = get.get(sourcePath) as CheckpointDbRow | undefined;
      return row && toCheckpoint(row);
    },
    set(cp) {
      if (!Number.isFinite(cp.mtimeMs) || cp.mtimeMs < 0) {
        throw new DbError('invalid_input', 'mtimeMs must be a non-negative number');
      }
      set.run(
        requireNonEmpty(cp.sourcePath, 'sourcePath'),
        requireNonEmpty(cp.fileIdentity, 'fileIdentity'),
        nonNegativeInt(cp.sizeBytes, 'sizeBytes'),
        cp.mtimeMs,
        nonNegativeInt(cp.byteOffset, 'byteOffset'),
        requireNonEmpty(cp.headHash, 'headHash'),
        nonNegativeInt(cp.parseErrors, 'parseErrors'),
        ctx.now().toISOString(),
      );
    },
    list() {
      return (all.all() as CheckpointDbRow[]).map((row) => ({
        ...toCheckpoint(row),
        updatedAt: storedTimestamp(row.updated_at, 'ingestion_checkpoints', 'updated_at'),
      }));
    },
    remove(sourcePath) {
      return remove.run(sourcePath).changes > 0;
    },
  };
}
