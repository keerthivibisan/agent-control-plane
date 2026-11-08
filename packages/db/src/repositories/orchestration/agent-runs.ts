import {
  AgentRoleKindSchema,
  AgentRunSchema,
  AgentRunStatusSchema,
  HARD_MAX_DEPTH,
  DEFAULT_MANAGED_PROVIDER,
  ManagedProviderIdSchema,
  ToolUseCountsSchema,
  type AgentRoleKind,
  type AgentRun,
  type AgentRunStatus,
  type IsoTimestamp,
  type ManagedProviderId,
  type ToolUseCounts,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  parseInput,
  parseStored,
  parseStoredJson,
  placeholders,
  toStoredTimestampOrNull,
} from '../../internal/validate.js';
import { guardWrite, nonNegativeInt, positiveInt, statusGuard } from './shared.js';

export interface AgentRunInsertInput {
  runId: string;
  /**
   * `lead`: no parent, no task. `worker`: a parent in the same run (the lead, or a helper of the
   * lead: at most HARD_MAX_DEPTH levels), and a task.
   */
  kind: AgentRoleKind;
  parentAgentRunId: string | null;
  role: string;
  /** The worker's task text (ADR-0015); null for the lead. */
  task: string | null;
  /** Defaults to the run's `budget.maxTokensPerAgent`. */
  budgetTokensLimit?: number;
  /** Defaults to `QUEUED`. */
  status?: AgentRunStatus;
  /** ADR-0031: the provider that runs the agent. Defaults to Claude Code. */
  provider?: ManagedProviderId;
}

/**
 * A stored agent run. `sessionId` is the observed top-level session for the agent's primary
 * provider session (agent_run_sessions), or null until the observation pipeline has ingested it.
 * `budgetTokensLimit` is not in core's `AgentRun` yet (proposed): it starts at the run's cap and
 * grows when the owner approves a budget raise. `provider` (ADR-0031, migration 0013) is not in it
 * either: rows stored before 0013 read as Claude Code. `toolCounts` (CM-2, migration 0015): the
 * agent's content-free tool calls by category; null when none were counted.
 */
export interface StoredAgentRun extends AgentRun {
  budgetTokensLimit: number;
  provider: ManagedProviderId;
  toolCounts: ToolUseCounts | null;
}

export interface AgentRunStatusUpdate {
  /** Only update when the current status is one of these; otherwise `DbError('conflict')`. */
  from?: readonly AgentRunStatus[];
  /** Sets `endedAt`; `null` clears it; absent leaves it unchanged. */
  endedAt?: IsoTimestamp | null;
}

export interface AgentRunsRepository {
  /** Throws `not_found` for an unknown run or parent, `invalid_input` for a broken shape. */
  insert(input: AgentRunInsertInput): StoredAgentRun;
  getById(id: string): StoredAgentRun | undefined;
  /** The run's agents in creation order (the lead first). */
  listForRun(runId: string): StoredAgentRun[];
  /** Agents in any of `statuses`, oldest first (restart handling). */
  listByStatus(statuses: readonly AgentRunStatus[]): StoredAgentRun[];
  setStatus(
    id: string,
    status: AgentRunStatus,
    update?: AgentRunStatusUpdate,
  ): StoredAgentRun | undefined;
  /** Stores the engine's deduplicated budget-token total (ADR-0014). */
  setBudgetTokensUsed(id: string, used: number): StoredAgentRun | undefined;
  /** Raises (or sets) the agent's cap after a `budget-raise` approval. */
  setBudgetTokensLimit(id: string, limit: number): StoredAgentRun | undefined;
  /**
   * CM-2: stores the agent's tool-call counts by category (`ToolUseCountsSchema`). Throws
   * `invalid_input` on a database before migration 0015.
   */
  setToolCounts(id: string, counts: ToolUseCounts): StoredAgentRun | undefined;
}

interface AgentRunDbRow {
  id: string;
  run_id: string;
  parent_agent_run_id: string | null;
  kind: string;
  role: string;
  task: string | null;
  status: string;
  session_id: string | null;
  budget_tokens_used: number;
  budget_tokens_limit: number;
  provider: string;
  tool_counts: string | null;
  created_at: string;
  ended_at: string | null;
}

const T = 'agent_runs';

/**
 * `provider` is read only where migration 0013 added it; on an older database (only the migration
 * tests build repositories on one) every agent reads as Claude Code, which is what ran them.
 * `tool_counts` likewise only where 0015 added it; before, no counts.
 */
function selectSql(hasProvider: boolean, hasToolCounts: boolean): string {
  const provider = hasProvider ? 'a.provider' : `'${DEFAULT_MANAGED_PROVIDER}' AS provider`;
  const toolCounts = hasToolCounts ? 'a.tool_counts' : 'NULL AS tool_counts';
  return `SELECT a.id, a.run_id, a.parent_agent_run_id, a.kind, a.role, a.task, a.status,
    s.id AS session_id, a.budget_tokens_used, a.budget_tokens_limit, ${provider}, ${toolCounts},
    a.created_at, a.ended_at
  FROM agent_runs a
  LEFT JOIN agent_run_sessions l ON l.agent_run_id = a.id AND l.relation = 'primary'
  LEFT JOIN sessions s ON s.provider = l.provider AND s.provider_session_id = l.provider_session_id
    AND s.provider_agent_id = ''`;
}

function toAgentRun(row: AgentRunDbRow): StoredAgentRun {
  const run = parseStored(
    AgentRunSchema,
    {
      id: row.id,
      runId: row.run_id,
      parentAgentRunId: row.parent_agent_run_id,
      kind: row.kind,
      role: row.role,
      task: row.task,
      status: row.status,
      sessionId: row.session_id,
      budgetTokensUsed: row.budget_tokens_used,
      createdAt: row.created_at,
      endedAt: row.ended_at,
    },
    T,
    '*',
  );
  const limit = parseStored(positiveInt, row.budget_tokens_limit, T, 'budget_tokens_limit');
  const provider = parseStored(ManagedProviderIdSchema, row.provider, T, 'provider');
  const toolCounts =
    row.tool_counts === null
      ? null
      : parseStoredJson(ToolUseCountsSchema, row.tool_counts, T, 'tool_counts');
  return { ...run, budgetTokensLimit: limit, provider, toolCounts };
}

export function createAgentRunsRepository(ctx: RepositoryContext): AgentRunsRepository {
  const c = ctx.connection;
  const columns = (c.pragma(`table_info(${T})`) as { name: string }[]).map((col) => col.name);
  const hasProvider = columns.includes('provider');
  const hasToolCounts = columns.includes('tool_counts');
  const SELECT = selectSql(hasProvider, hasToolCounts);
  const insert = c.prepare(
    `INSERT INTO ${T} (id, run_id, parent_agent_run_id, kind, role, task, status,
       budget_tokens_used, budget_tokens_limit, created_at, ended_at${hasProvider ? ', provider' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL${hasProvider ? ', ?' : ''})`,
  );
  const byId = c.prepare(`${SELECT} WHERE a.id = ?`);
  const forRun = c.prepare(`${SELECT} WHERE a.run_id = ? ORDER BY a.created_at, a.rowid`);
  const runCap = c
    .prepare('SELECT max_tokens_per_agent FROM orchestration_runs WHERE id = ?')
    .pluck();
  const parentOf = c.prepare(`SELECT run_id, kind FROM ${T} WHERE id = ?`);
  const parentIdOf = c.prepare(`SELECT parent_agent_run_id FROM ${T} WHERE id = ?`).pluck();

  /** Levels below the lead (the lead is 0). Bounded: parents are inserted before children. */
  function depthOf(id: string): number {
    let depth = 0;
    let current = parentIdOf.get(id) as string | null | undefined;
    while (current !== null && current !== undefined && depth <= HARD_MAX_DEPTH) {
      depth += 1;
      current = parentIdOf.get(current) as string | null | undefined;
    }
    return depth;
  }
  const currentStatus = c.prepare(`SELECT status FROM ${T} WHERE id = ?`).pluck();
  const setUsed = c.prepare(`UPDATE ${T} SET budget_tokens_used = ? WHERE id = ?`);
  const setLimit = c.prepare(`UPDATE ${T} SET budget_tokens_limit = ? WHERE id = ?`);
  const setCounts = hasToolCounts
    ? c.prepare(`UPDATE ${T} SET tool_counts = ? WHERE id = ?`)
    : null;

  function getById(id: string): StoredAgentRun | undefined {
    const row = byId.get(id) as AgentRunDbRow | undefined;
    return row && toAgentRun(row);
  }

  function validate(input: AgentRunInsertInput) {
    const shape = AgentRunSchema.shape;
    const kind = parseInput(AgentRoleKindSchema, input.kind, 'agent kind');
    const valid = {
      runId: parseInput(shape.runId, input.runId, 'agent runId'),
      kind,
      parentAgentRunId: parseInput(
        shape.parentAgentRunId,
        input.parentAgentRunId,
        'agent parentAgentRunId',
      ),
      role: parseInput(shape.role, input.role, 'agent role'),
      task: parseInput(shape.task, input.task, 'agent task'),
      status: parseInput(AgentRunStatusSchema, input.status ?? 'QUEUED', 'agent status'),
      provider: parseInput(
        ManagedProviderIdSchema,
        input.provider ?? DEFAULT_MANAGED_PROVIDER,
        'agent provider',
      ),
      budgetTokensLimit:
        input.budgetTokensLimit === undefined
          ? undefined
          : parseInput(positiveInt, input.budgetTokensLimit, 'agent budgetTokensLimit'),
    };
    if (kind === 'lead' && (valid.parentAgentRunId !== null || valid.task !== null)) {
      throw new DbError('invalid_input', 'a lead agent has no parent and no task');
    }
    if (kind === 'worker' && (valid.parentAgentRunId === null || valid.task === null)) {
      throw new DbError('invalid_input', 'a worker agent needs a parent and a task');
    }
    return valid;
  }

  return {
    insert(input) {
      const valid = validate(input);
      if (!hasProvider && valid.provider !== DEFAULT_MANAGED_PROVIDER) {
        throw new DbError('invalid_input', 'this database cannot store an agent provider yet');
      }
      return c.transaction((): StoredAgentRun => {
        const cap = runCap.get(valid.runId) as number | undefined;
        if (cap === undefined) throw new DbError('not_found', 'orchestration run not found');
        if (valid.parentAgentRunId !== null) {
          const parent = parentOf.get(valid.parentAgentRunId) as
            { run_id: string; kind: string } | undefined;
          if (!parent || parent.run_id !== valid.runId) {
            throw new DbError('not_found', 'parent agent run not found in this run');
          }
          // Delegation depth (ADR-0013 amendment): helpers sit at most HARD_MAX_DEPTH levels
          // below the lead. The engine applies the project's own (lower) limit.
          if (depthOf(valid.parentAgentRunId) + 1 > HARD_MAX_DEPTH) {
            throw new DbError(
              'invalid_input',
              `helpers can be at most ${HARD_MAX_DEPTH} levels below the lead`,
            );
          }
        }
        const id = ctx.newId();
        guardWrite('agent run', () =>
          insert.run(
            id,
            valid.runId,
            valid.parentAgentRunId,
            valid.kind,
            valid.role,
            valid.task,
            valid.status,
            valid.budgetTokensLimit ?? cap,
            ctx.now().toISOString(),
            ...(hasProvider ? [valid.provider] : []),
          ),
        );
        // The row was just inserted in this transaction.
        return getById(id) as StoredAgentRun;
      })();
    },
    getById,
    listForRun(runId) {
      return (forRun.all(runId) as AgentRunDbRow[]).map(toAgentRun);
    },
    listByStatus(statuses) {
      if (statuses.length === 0) return [];
      const valid = statuses.map((s) => parseInput(AgentRunStatusSchema, s, 'agent status'));
      const rows = c
        .prepare(
          `${SELECT} WHERE a.status IN (${placeholders(valid.length)})
           ORDER BY a.created_at, a.rowid`,
        )
        .all(...valid) as AgentRunDbRow[];
      return rows.map(toAgentRun);
    },
    setStatus(id, status, update = {}) {
      const next = parseInput(AgentRunStatusSchema, status, 'agent status');
      const from = statusGuard(AgentRunStatusSchema, update.from, 'agent status');
      const sets = ['status = ?'];
      const params: unknown[] = [next];
      if (update.endedAt !== undefined) {
        sets.push('ended_at = ?');
        params.push(toStoredTimestampOrNull(update.endedAt, 'agent endedAt'));
      }
      let where = 'id = ?';
      params.push(id);
      if (from) {
        where += ` AND status IN (${placeholders(from.length)})`;
        params.push(...from);
      }
      const changed = c.prepare(`UPDATE ${T} SET ${sets.join(', ')} WHERE ${where}`).run(...params);
      if (changed.changes > 0) return getById(id);
      const current = currentStatus.get(id) as string | undefined;
      if (current === undefined) return undefined;
      throw new DbError('conflict', `agent is ${current}, expected one of ${from?.join(', ')}`);
    },
    setBudgetTokensUsed(id, used) {
      const valid = parseInput(nonNegativeInt, used, 'budgetTokensUsed');
      return setUsed.run(valid, id).changes > 0 ? getById(id) : undefined;
    },
    setBudgetTokensLimit(id, limit) {
      const valid = parseInput(positiveInt, limit, 'budgetTokensLimit');
      return setLimit.run(valid, id).changes > 0 ? getById(id) : undefined;
    },
    setToolCounts(id, counts) {
      const valid = parseInput(ToolUseCountsSchema, counts, 'toolCounts');
      if (setCounts === null) {
        throw new DbError('invalid_input', 'this database cannot store tool counts yet');
      }
      return setCounts.run(JSON.stringify(valid), id).changes > 0 ? getById(id) : undefined;
    },
  };
}
