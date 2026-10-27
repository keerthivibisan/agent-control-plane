import { ConflictResolutionRecordSchema, type ConflictResolutionRecord } from '@acp/core/api';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStoredJson } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

/**
 * A run's conflict-resolution operations (ADR-0030, migration 0012 `conflict_resolutions`). The row
 * holds the operation record (core's `ConflictResolutionRecordSchema`, validated both ways) plus the
 * columns the database itself enforces: one active operation per run (a partial unique index), and
 * updates that compare and swap on the state the caller read, so two writers never both win.
 */
export interface ConflictResolutionsRepository {
  /** Refused with `conflict` when the run already has an active operation. */
  insert(record: ConflictResolutionRecord): ConflictResolutionRecord;
  get(id: string): ConflictResolutionRecord | undefined;
  /** The run's latest operation (active or finished). */
  latestForRun(runId: string): ConflictResolutionRecord | undefined;
  /** Operations in an active state (for restart recovery). */
  listActive(): ConflictResolutionRecord[];
  /**
   * Replaces the record when the stored state still is `expectedState`; undefined when it moved
   * (another writer won) or the row is gone.
   */
  update(
    record: ConflictResolutionRecord,
    expectedState: ConflictResolutionRecord['state'],
  ): ConflictResolutionRecord | undefined;
}

const T = 'conflict_resolutions';
const ACTIVE = `('preparing', 'resolving', 'verifying', 'awaiting-owner', 'delivering')`;

interface Row {
  record: string;
}

export function createConflictResolutionsRepository(
  ctx: RepositoryContext,
): ConflictResolutionsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (id, run_id, project_id, state, ticket_commit, target_commit,
       candidate_commit, policy_fingerprint, record, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byId = c.prepare(`SELECT record FROM ${T} WHERE id = ?`);
  const latest = c.prepare(
    `SELECT record FROM ${T} WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  );
  const active = c.prepare(`SELECT record FROM ${T} WHERE state IN ${ACTIVE} ORDER BY created_at`);
  const update = c.prepare(
    `UPDATE ${T} SET state = ?, candidate_commit = ?, policy_fingerprint = ?, record = ?,
       updated_at = ?
     WHERE id = ? AND state = ? RETURNING record`,
  );

  const read = (row: Row | undefined) =>
    row === undefined
      ? undefined
      : parseStoredJson(ConflictResolutionRecordSchema, row.record, T, 'record');
  const valid = (record: ConflictResolutionRecord) =>
    parseInput(ConflictResolutionRecordSchema, record, 'conflict resolution');

  return {
    insert(record) {
      const r = valid(record);
      return guardWrite('conflict resolution', () => {
        insert.run(
          r.id,
          r.runId,
          r.projectId,
          r.state,
          r.ticketCommit,
          r.targetCommit,
          r.candidateCommit,
          r.policyFingerprint,
          JSON.stringify(r),
          r.createdAt,
          r.updatedAt,
        );
        return r;
      });
    },
    get(id) {
      return read(byId.get(id) as Row | undefined);
    },
    latestForRun(runId) {
      return read(latest.get(runId) as Row | undefined);
    },
    listActive() {
      return (active.all() as Row[]).map((row) => read(row) as ConflictResolutionRecord);
    },
    update(record, expectedState) {
      const r = valid(record);
      const stored = byId.get(r.id) as Row | undefined;
      if (stored === undefined) return undefined;
      const before = read(stored);
      if (before !== undefined && before.runId !== r.runId) {
        throw new DbError('invalid_input', 'conflict resolution: the run cannot change');
      }
      return read(
        guardWrite(
          'conflict resolution',
          () =>
            update.get(
              r.state,
              r.candidateCommit,
              r.policyFingerprint,
              JSON.stringify(r),
              r.updatedAt,
              r.id,
              expectedState,
            ) as Row | undefined,
        ),
      );
    },
  };
}
