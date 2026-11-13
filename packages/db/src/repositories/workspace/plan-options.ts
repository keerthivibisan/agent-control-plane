import {
  TicketPlanOptionSchema,
  TicketPlanOptionStatusSchema,
  type IsoTimestamp,
  type PlanStep,
  type TicketPlanOption,
  type TicketPlanOptionStatus,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import {
  parseInput,
  parseStored,
  parseStoredJson,
  toStoredTimestamp,
} from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

export interface TicketPlanOptionInsertInput {
  ticketId: string;
  /** A run of this ticket (`not_found` otherwise). */
  runId: string;
  /** The planner agent run that submitted it. */
  agentRunId: string;
  nodeId: string;
  label: string;
  summary: string;
  steps: PlanStep[];
  plannedHelpers: number;
}

/** How a `proposed` option is decided (ADR-0037 §4). */
export type TicketPlanOptionDecision = Exclude<TicketPlanOptionStatus, 'proposed'>;

/**
 * Plan options of runs with two or more planners (ADR-0037 §4, migration 0016). The chosen
 * option's plan is stored in `ticket_plans` like any plan; this table keeps every draft.
 */
export interface TicketPlanOptionsRepository {
  /** Stores a planner's option as the run's next option index (1, 2, ...), status `proposed`. */
  insert(input: TicketPlanOptionInsertInput): TicketPlanOption;
  getById(id: string): TicketPlanOption | undefined;
  /** The run's options by option index. */
  listForRun(runId: string): TicketPlanOption[];
  /**
   * Decides a `proposed` option: `chosen` needs the plan it became (`planId`, a plan of the same
   * ticket), every other status takes none. `conflict` when it is no longer proposed, undefined
   * when it does not exist. `at` defaults to now.
   */
  decide(
    id: string,
    status: TicketPlanOptionDecision,
    options?: { planId?: string; at?: IsoTimestamp },
  ): TicketPlanOption | undefined;
}

interface PlanOptionDbRow {
  id: string;
  ticket_id: string;
  run_id: string;
  option_index: number;
  agent_run_id: string;
  node_id: string;
  label: string;
  summary: string;
  steps: string;
  planned_helpers: number;
  status: string;
  plan_id: string | null;
  created_at: string;
  decided_at: string | null;
}

const T = 'ticket_plan_options';
const COLUMNS = `id, ticket_id, run_id, option_index, agent_run_id, node_id, label, summary, steps,
  planned_helpers, status, plan_id, created_at, decided_at`;
const shape = TicketPlanOptionSchema.shape;

function toOption(row: PlanOptionDbRow): TicketPlanOption {
  return parseStored(
    TicketPlanOptionSchema,
    {
      id: row.id,
      ticketId: row.ticket_id,
      runId: row.run_id,
      optionIndex: row.option_index,
      agentRunId: row.agent_run_id,
      nodeId: row.node_id,
      label: row.label,
      summary: row.summary,
      steps: parseStoredJson(shape.steps, row.steps, T, 'steps'),
      plannedHelpers: row.planned_helpers,
      status: row.status,
      planId: row.plan_id,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    },
    T,
    '*',
  );
}

export function createTicketPlanOptionsRepository(
  ctx: RepositoryContext,
): TicketPlanOptionsRepository {
  const c = ctx.connection;
  // Prepared on first use, so the other workspace repositories still open on a database before
  // migration 0016 (older-schema tests build them all at once).
  let prepared: ReturnType<typeof prepare> | undefined;
  function prepare() {
    return {
      // The index is computed in the same statement; UNIQUE (run_id, option_index) backs it up.
      insert: c.prepare(
        `INSERT INTO ${T} (${COLUMNS})
         SELECT ?, ?, ?, COALESCE((SELECT MAX(option_index) FROM ${T} WHERE run_id = ?), 0) + 1,
           ?, ?, ?, ?, ?, ?, 'proposed', NULL, ?, NULL
         RETURNING ${COLUMNS}`,
      ),
      byId: c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`),
      forRun: c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY option_index`),
      decide: c.prepare(
        `UPDATE ${T} SET status = ?, plan_id = ?, decided_at = ?
         WHERE id = ? AND status = 'proposed'
         RETURNING ${COLUMNS}`,
      ),
      currentStatus: c.prepare(`SELECT status FROM ${T} WHERE id = ?`).pluck(),
    };
  }
  const q = () => (prepared ??= prepare());

  return {
    insert(input) {
      const at = ctx.now().toISOString();
      const row = guardWrite(
        'ticket plan option',
        () =>
          q().insert.get(
            ctx.newId(),
            parseInput(shape.ticketId, input.ticketId, 'plan option ticketId'),
            parseInput(shape.runId, input.runId, 'plan option runId'),
            input.runId,
            parseInput(shape.agentRunId, input.agentRunId, 'plan option agentRunId'),
            parseInput(shape.nodeId, input.nodeId, 'plan option nodeId'),
            parseInput(shape.label, input.label, 'plan option label'),
            parseInput(shape.summary, input.summary, 'plan option summary'),
            JSON.stringify(parseInput(shape.steps, input.steps, 'plan option steps')),
            parseInput(shape.plannedHelpers, input.plannedHelpers, 'plan option plannedHelpers'),
            at,
          ) as PlanOptionDbRow,
      );
      return toOption(row);
    },
    getById(id) {
      const row = q().byId.get(id) as PlanOptionDbRow | undefined;
      return row && toOption(row);
    },
    listForRun(runId) {
      return (q().forRun.all(runId) as PlanOptionDbRow[]).map(toOption);
    },
    decide(id, status, options = {}) {
      const valid = parseInput(TicketPlanOptionStatusSchema, status, 'plan option decision');
      if (valid === 'proposed') {
        throw new DbError('invalid_input', 'a plan option is decided, not proposed again');
      }
      const planId = options.planId ?? null;
      if ((valid === 'chosen') !== (planId !== null)) {
        throw new DbError('invalid_input', 'only the chosen plan option names its plan');
      }
      const decidedAt =
        options.at === undefined
          ? ctx.now().toISOString()
          : toStoredTimestamp(options.at, 'plan option decidedAt');
      const row = guardWrite(
        'ticket plan option',
        () => q().decide.get(valid, planId, decidedAt, id) as PlanOptionDbRow | undefined,
      );
      if (row) return toOption(row);
      const current = q().currentStatus.get(id) as string | undefined;
      if (current === undefined) return undefined;
      throw new DbError('conflict', `plan option is ${current}, not proposed`);
    },
  };
}
