import { isAbsolute } from 'node:path';
import { ReviewStateSchema, type IsoTimestamp, type ReviewState } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  parseInput,
  parseStored,
  requireNonEmpty,
  storedTimestamp,
  storedTimestampOrNull,
} from '../../internal/validate.js';
import { guardWrite, literalParser, nonNegativeInt, nullable, textParser } from './shared.js';

/**
 * Disk lifecycle of a worker's worktree: `active` while it exists, `removed` after merge, discard,
 * or orphan cleanup. The owner's decision is `reviewState`. Not in core yet (proposed).
 */
export const WORKSPACE_STATES = ['active', 'removed'] as const;
export type WorkspaceState = (typeof WORKSPACE_STATES)[number];
const StateParser = literalParser(WORKSPACE_STATES);
const BaseCommitParser = nullable(textParser(7, 64));

export interface WorkspaceInsertInput {
  runId: string;
  /** A worker of `runId`; one workspace per agent run. */
  agentRunId: string;
  /** Absolute path of the worktree (`<ACP_DATA_DIR>/worktrees/<run>/<agent>`, ADR-0013). */
  worktreePath: string;
  /** `acp/<run>/<agent>`. */
  branch: string;
  baseBranch: string;
  /** The base branch's commit at creation, when known. */
  baseCommit: string | null;
}

export interface WorkspaceRow extends WorkspaceInsertInput {
  id: string;
  /** The run's project (joined). */
  projectId: string;
  state: WorkspaceState;
  reviewState: ReviewState;
  /** Null until the changes were computed. */
  changedFiles: number | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  removedAt: IsoTimestamp | null;
}

export interface WorkspaceReviewUpdate {
  reviewState: ReviewState;
  /** Absent leaves the stored count unchanged. */
  changedFiles?: number | null;
}

export interface ManagedWorkspacesRepository {
  /** Creates an `active` workspace with review state `pending`. */
  insert(input: WorkspaceInsertInput): WorkspaceRow;
  getById(id: string): WorkspaceRow | undefined;
  getByAgentRun(agentRunId: string): WorkspaceRow | undefined;
  listForRun(runId: string): WorkspaceRow[];
  /** Every `active` workspace (orphan cleanup on start; extra roots for the scheduler). */
  listActive(): WorkspaceRow[];
  setReview(id: string, update: WorkspaceReviewUpdate): WorkspaceRow | undefined;
  /** Marks the worktree as gone from disk. Idempotent: keeps the first `removedAt`. */
  markRemoved(id: string): WorkspaceRow | undefined;
}

interface WorkspaceDbRow {
  id: string;
  run_id: string;
  agent_run_id: string;
  project_id: string;
  worktree_path: string;
  branch: string;
  base_branch: string;
  base_commit: string | null;
  state: string;
  review_state: string;
  changed_files: number | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
}

const T = 'managed_workspaces';
const SELECT = `SELECT w.id, w.run_id, w.agent_run_id, r.project_id, w.worktree_path, w.branch,
    w.base_branch, w.base_commit, w.state, w.review_state, w.changed_files, w.created_at,
    w.updated_at, w.removed_at
  FROM managed_workspaces w JOIN orchestration_runs r ON r.id = w.run_id`;

function toWorkspace(row: WorkspaceDbRow): WorkspaceRow {
  return {
    id: row.id,
    runId: row.run_id,
    agentRunId: row.agent_run_id,
    projectId: row.project_id,
    worktreePath: row.worktree_path,
    branch: row.branch,
    baseBranch: row.base_branch,
    baseCommit: row.base_commit,
    state: parseStored(StateParser, row.state, T, 'state'),
    reviewState: parseStored(ReviewStateSchema, row.review_state, T, 'review_state'),
    changedFiles: row.changed_files,
    createdAt: storedTimestamp(row.created_at, T, 'created_at'),
    updatedAt: storedTimestamp(row.updated_at, T, 'updated_at'),
    removedAt: storedTimestampOrNull(row.removed_at, T, 'removed_at'),
  };
}

export function createManagedWorkspacesRepository(
  ctx: RepositoryContext,
): ManagedWorkspacesRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (id, run_id, agent_run_id, worktree_path, branch, base_branch, base_commit,
       state, review_state, changed_files, created_at, updated_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'pending', NULL, ?, ?, NULL)`,
  );
  const workerKind = c.prepare('SELECT kind FROM agent_runs WHERE id = ? AND run_id = ?').pluck();
  const byId = c.prepare(`${SELECT} WHERE w.id = ?`);
  const byAgent = c.prepare(`${SELECT} WHERE w.agent_run_id = ?`);
  const forRun = c.prepare(`${SELECT} WHERE w.run_id = ? ORDER BY w.created_at, w.rowid`);
  const active = c.prepare(`${SELECT} WHERE w.state = 'active' ORDER BY w.created_at, w.rowid`);
  const setReview = c.prepare(
    `UPDATE ${T} SET review_state = ?, changed_files = ?, updated_at = ? WHERE id = ?`,
  );
  const setReviewOnly = c.prepare(`UPDATE ${T} SET review_state = ?, updated_at = ? WHERE id = ?`);
  const markRemoved = c.prepare(
    `UPDATE ${T} SET state = 'removed', removed_at = COALESCE(removed_at, ?), updated_at = ?
     WHERE id = ?`,
  );

  function getById(id: string): WorkspaceRow | undefined {
    const row = byId.get(id) as WorkspaceDbRow | undefined;
    return row && toWorkspace(row);
  }

  return {
    insert(input) {
      const runId = requireNonEmpty(input.runId, 'workspace runId');
      const agentRunId = requireNonEmpty(input.agentRunId, 'workspace agentRunId');
      const worktreePath = requireNonEmpty(input.worktreePath, 'workspace worktreePath');
      if (!isAbsolute(worktreePath)) {
        throw new DbError('invalid_input', 'workspace worktreePath must be absolute');
      }
      const branch = requireNonEmpty(input.branch, 'workspace branch');
      const baseBranch = requireNonEmpty(input.baseBranch, 'workspace baseBranch');
      const baseCommit = parseInput(BaseCommitParser, input.baseCommit, 'workspace baseCommit');
      return c.transaction((): WorkspaceRow => {
        const kind = workerKind.get(agentRunId, runId) as string | undefined;
        if (kind === undefined) throw new DbError('not_found', 'agent run not found in this run');
        // The lead runs read-only in the project root and never gets a worktree (ADR-0013 §2).
        if (kind !== 'worker') throw new DbError('invalid_input', 'only workers get a worktree');
        const id = ctx.newId();
        const at = ctx.now().toISOString();
        guardWrite('managed workspace', () =>
          insert.run(id, runId, agentRunId, worktreePath, branch, baseBranch, baseCommit, at, at),
        );
        // The row was just inserted in this transaction.
        return getById(id) as WorkspaceRow;
      })();
    },
    getById,
    getByAgentRun(agentRunId) {
      const row = byAgent.get(agentRunId) as WorkspaceDbRow | undefined;
      return row && toWorkspace(row);
    },
    listForRun(runId) {
      return (forRun.all(runId) as WorkspaceDbRow[]).map(toWorkspace);
    },
    listActive() {
      return (active.all() as WorkspaceDbRow[]).map(toWorkspace);
    },
    setReview(id, update) {
      const reviewState = parseInput(ReviewStateSchema, update.reviewState, 'reviewState');
      const at = ctx.now().toISOString();
      const result =
        update.changedFiles === undefined
          ? setReviewOnly.run(reviewState, at, id)
          : setReview.run(
              reviewState,
              parseInput(nullable(nonNegativeInt), update.changedFiles, 'changedFiles'),
              at,
              id,
            );
      return result.changes > 0 ? getById(id) : undefined;
    },
    markRemoved(id) {
      const at = ctx.now().toISOString();
      return markRemoved.run(at, at, id).changes > 0 ? getById(id) : undefined;
    },
  };
}
