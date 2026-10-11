import {
  OrchestrationRunSchema,
  RunBudgetSchema,
  RunStatusSchema,
  type IsoTimestamp,
  type OrchestrationRun,
  type RunBudget,
  type RunStatus,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  pageLimit,
  parseInput,
  parseStored,
  placeholders,
  toStoredTimestamp,
  toStoredTimestampOrNull,
} from '../../internal/validate.js';
import { guardWrite, statusGuard } from './shared.js';

export interface RunInsertInput {
  /** A registered project (`not_found` otherwise). */
  projectId: string;
  title: string;
  budget: RunBudget;
  /** Defaults to `QUEUED`. */
  status?: RunStatus;
}

export interface RunListItem extends OrchestrationRun {
  /** Agent runs in this run, the lead included. */
  agentCount: number;
  pendingApprovals: number;
}

/** Keyset cursor for `list`: the last item of the previous page. */
export interface RunCursor {
  createdAt: IsoTimestamp;
  id: string;
}

export interface RunListOptions {
  projectId?: string;
  /** 1..MAX_PAGE_SIZE; default 50. */
  limit?: number;
  before?: RunCursor;
}

export interface RunStatusUpdate {
  /**
   * Only update when the current status is one of these; otherwise throw `DbError('conflict')`.
   * The engine decides transitions; this guard keeps two writers from both applying one.
   */
  from?: readonly RunStatus[];
  /** Sets `endedAt`; `null` clears it; absent leaves it unchanged. */
  endedAt?: IsoTimestamp | null;
}

/** What a removed run left on disk, for the caller to delete (the rows are already gone). */
export interface RunRemoval {
  /** Artifact paths relative to the data dir. */
  artifactPaths: string[];
  /** Worktrees still recorded as `active`. */
  activeWorktreePaths: string[];
}

export interface OrchestrationRunsRepository {
  insert(input: RunInsertInput): OrchestrationRun;
  getById(id: string): OrchestrationRun | undefined;
  /** Newest first (`createdAt` DESC, `id` DESC), with agent and pending-approval counts. */
  list(options?: RunListOptions): RunListItem[];
  /** Runs in any of `statuses`, oldest first (restart handling: live runs → NEEDS_REVIEW). */
  listByStatus(statuses: readonly RunStatus[]): OrchestrationRun[];
  /** Returns the updated run, or undefined when it does not exist. */
  setStatus(id: string, status: RunStatus, update?: RunStatusUpdate): OrchestrationRun | undefined;
  setBudget(id: string, budget: RunBudget): OrchestrationRun | undefined;
  /**
   * Deletes the run and, by cascade, its agents, sessions links, approvals, artifacts, workspaces,
   * and chat messages (ADR-0015). Returns undefined when it did not exist.
   */
  remove(id: string): RunRemoval | undefined;
}

interface RunDbRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  max_tokens_per_agent: number;
  soft_cost_usd_per_run: number | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

const COLUMNS = `id, project_id, title, status, max_tokens_per_agent, soft_cost_usd_per_run,
  created_at, updated_at, ended_at`;
const T = 'orchestration_runs';
const PREFIXED = COLUMNS.split(',')
  .map((col) => `r.${col.trim()}`)
  .join(', ');

function toRun(row: RunDbRow): OrchestrationRun {
  return parseStored(
    OrchestrationRunSchema,
    {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      budget: {
        maxTokensPerAgent: row.max_tokens_per_agent,
        softCostUsdPerRun: row.soft_cost_usd_per_run,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      endedAt: row.ended_at,
    },
    T,
    '*',
  );
}

export function createOrchestrationRunsRepository(
  ctx: RepositoryContext,
): OrchestrationRunsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL) RETURNING ${COLUMNS}`,
  );
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const exists = c.prepare(`SELECT status FROM ${T} WHERE id = ?`).pluck();
  const setBudget = c.prepare(
    `UPDATE ${T} SET max_tokens_per_agent = ?, soft_cost_usd_per_run = ?, updated_at = ?
     WHERE id = ? RETURNING ${COLUMNS}`,
  );
  const artifactPaths = c
    .prepare('SELECT storage_path FROM artifacts WHERE run_id = ? ORDER BY storage_path')
    .pluck();
  const activeWorktrees = c
    .prepare(
      `SELECT worktree_path FROM managed_workspaces WHERE run_id = ? AND state = 'active'
       ORDER BY worktree_path`,
    )
    .pluck();
  const remove = c.prepare(`DELETE FROM ${T} WHERE id = ?`);

  return {
    insert(input) {
      const title = parseInput(OrchestrationRunSchema.shape.title, input.title, 'run title');
      const projectId = parseInput(
        OrchestrationRunSchema.shape.projectId,
        input.projectId,
        'run projectId',
      );
      const budget = parseInput(RunBudgetSchema, input.budget, 'run budget');
      const status = parseInput(RunStatusSchema, input.status ?? 'QUEUED', 'run status');
      const at = ctx.now().toISOString();
      return guardWrite('orchestration run', () =>
        toRun(
          insert.get(
            ctx.newId(),
            projectId,
            title,
            status,
            budget.maxTokensPerAgent,
            budget.softCostUsdPerRun,
            at,
            at,
          ) as RunDbRow,
        ),
      );
    },
    getById(id) {
      const row = byId.get(id) as RunDbRow | undefined;
      return row && toRun(row);
    },
    list(options = {}) {
      const limit = pageLimit(options.limit);
      const where: string[] = [];
      const params: unknown[] = [];
      if (options.projectId !== undefined) {
        where.push('r.project_id = ?');
        params.push(options.projectId);
      }
      if (options.before) {
        const cursorAt = toStoredTimestamp(options.before.createdAt, 'cursor createdAt');
        where.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
        params.push(cursorAt, cursorAt, options.before.id);
      }
      const rows = c
        .prepare(
          `SELECT ${PREFIXED},
             (SELECT COUNT(*) FROM agent_runs a WHERE a.run_id = r.id) AS agent_count,
             (SELECT COUNT(*) FROM approvals p WHERE p.run_id = r.id AND p.status = 'pending')
               AS pending_approvals
           FROM ${T} r
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY r.created_at DESC, r.id DESC
           LIMIT ?`,
        )
        .all(...params, limit) as (RunDbRow & { agent_count: number; pending_approvals: number })[];
      return rows.map((row) => ({
        ...toRun(row),
        agentCount: row.agent_count,
        pendingApprovals: row.pending_approvals,
      }));
    },
    listByStatus(statuses) {
      if (statuses.length === 0) return [];
      const valid = statuses.map((s) => parseInput(RunStatusSchema, s, 'run status'));
      const rows = c
        .prepare(
          `SELECT ${COLUMNS} FROM ${T} WHERE status IN (${placeholders(valid.length)})
           ORDER BY created_at, id`,
        )
        .all(...valid) as RunDbRow[];
      return rows.map(toRun);
    },
    setStatus(id, status, update = {}) {
      const next = parseInput(RunStatusSchema, status, 'run status');
      const from = statusGuard(RunStatusSchema, update.from, 'run status');
      const sets = ['status = ?', 'updated_at = ?'];
      const params: unknown[] = [next, ctx.now().toISOString()];
      if (update.endedAt !== undefined) {
        sets.push('ended_at = ?');
        params.push(toStoredTimestampOrNull(update.endedAt, 'run endedAt'));
      }
      let where = 'id = ?';
      params.push(id);
      if (from) {
        where += ` AND status IN (${placeholders(from.length)})`;
        params.push(...from);
      }
      const row = c
        .prepare(`UPDATE ${T} SET ${sets.join(', ')} WHERE ${where} RETURNING ${COLUMNS}`)
        .get(...params) as RunDbRow | undefined;
      if (row) return toRun(row);
      const current = exists.get(id) as string | undefined;
      if (current === undefined) return undefined;
      throw new DbError('conflict', `run is ${current}, expected one of ${from?.join(', ')}`);
    },
    setBudget(id, budget) {
      const valid = parseInput(RunBudgetSchema, budget, 'run budget');
      const row = setBudget.get(
        valid.maxTokensPerAgent,
        valid.softCostUsdPerRun,
        ctx.now().toISOString(),
        id,
      ) as RunDbRow | undefined;
      return row && toRun(row);
    },
    remove(id) {
      return c.transaction((): RunRemoval | undefined => {
        const removal: RunRemoval = {
          artifactPaths: artifactPaths.all(id) as string[],
          activeWorktreePaths: activeWorktrees.all(id) as string[],
        };
        return remove.run(id).changes > 0 ? removal : undefined;
      })();
    },
  };
}
