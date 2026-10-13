import {
  TicketPlanSchema,
  TicketPlanStatusSchema,
  type IsoTimestamp,
  type PlanStep,
  type TicketPlan,
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

export interface TicketPlanInsertInput {
  ticketId: string;
  /** A run of this ticket (`not_found` otherwise). */
  runId: string;
  summary: string;
  steps: PlanStep[];
}

/** The owner's decision on a proposed plan (ADR-0016). */
export type TicketPlanDecision = 'approved' | 'changes-requested';

export interface TicketPlansRepository {
  /**
   * Stores the lead's plan as the run's next version (1, 2, ...), status `proposed`. A plan of the
   * run still `proposed` becomes `superseded` in the same transaction. `plannedHelpers` is the
   * number of distinct step roles other than "Lead".
   */
  insert(input: TicketPlanInsertInput): TicketPlan;
  getById(id: string): TicketPlan | undefined;
  /** All plans of the ticket, across its runs, oldest first. */
  listForTicket(ticketId: string): TicketPlan[];
  /** The run's plans by version. */
  listForRun(runId: string): TicketPlan[];
  /** The run's highest version, or undefined before the lead submitted one. */
  latestForRun(runId: string): TicketPlan | undefined;
  /** The run's approved plan, if any. */
  approvedForRun(runId: string): TicketPlan | undefined;
  /**
   * Decides a `proposed` plan; `conflict` when it is no longer proposed, undefined when it does
   * not exist. `at` defaults to now.
   */
  decide(id: string, decision: TicketPlanDecision, at?: IsoTimestamp): TicketPlan | undefined;
  /** Marks the run's `proposed` plan `superseded` (e.g. the run stopped). Returns the count. */
  supersedeProposed(runId: string, at?: IsoTimestamp): number;
}

interface PlanDbRow {
  id: string;
  ticket_id: string;
  run_id: string;
  version: number;
  summary: string;
  steps: string;
  planned_helpers: number;
  status: string;
  created_at: string;
  decided_at: string | null;
}

const T = 'ticket_plans';
const COLUMNS = `id, ticket_id, run_id, version, summary, steps, planned_helpers, status,
  created_at, decided_at`;
const shape = TicketPlanSchema.shape;

function toPlan(row: PlanDbRow): TicketPlan {
  return parseStored(
    TicketPlanSchema,
    {
      id: row.id,
      ticketId: row.ticket_id,
      runId: row.run_id,
      version: row.version,
      summary: row.summary,
      steps: parseStoredJson(shape.steps, row.steps, T, 'steps'),
      plannedHelpers: row.planned_helpers,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    },
    T,
    '*',
  );
}

/** Distinct helper roles in the steps; "Lead" steps are done by the lead itself. */
function countPlannedHelpers(steps: readonly PlanStep[]): number {
  const roles = new Set(
    steps.map((s) => s.role.trim().toLowerCase()).filter((role) => role !== 'lead'),
  );
  return roles.size;
}

export function createTicketPlansRepository(ctx: RepositoryContext): TicketPlansRepository {
  const c = ctx.connection;
  const supersede = c.prepare(
    `UPDATE ${T} SET status = 'superseded', decided_at = ? WHERE run_id = ? AND status = 'proposed'`,
  );
  // The version is computed in the same statement; UNIQUE (run_id, version) backs it up.
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS})
     SELECT ?, ?, ?, COALESCE((SELECT MAX(version) FROM ${T} WHERE run_id = ?), 0) + 1,
       ?, ?, ?, 'proposed', ?, NULL
     RETURNING ${COLUMNS}`,
  );
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const forTicket = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE ticket_id = ? ORDER BY created_at, rowid`,
  );
  const forRun = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY version`);
  const latest = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? ORDER BY version DESC LIMIT 1`,
  );
  const approved = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE run_id = ? AND status = 'approved'`,
  );
  const decide = c.prepare(
    `UPDATE ${T} SET status = ?, decided_at = ? WHERE id = ? AND status = 'proposed'
     RETURNING ${COLUMNS}`,
  );
  const currentStatus = c.prepare(`SELECT status FROM ${T} WHERE id = ?`).pluck();

  const insertTx = c.transaction(
    (input: TicketPlanInsertInput & { plannedHelpers: number }): TicketPlan => {
      const at = ctx.now().toISOString();
      supersede.run(at, input.runId);
      return guardWrite('ticket plan', () =>
        toPlan(
          insert.get(
            ctx.newId(),
            input.ticketId,
            input.runId,
            input.runId,
            input.summary,
            JSON.stringify(input.steps),
            input.plannedHelpers,
            at,
          ) as PlanDbRow,
        ),
      );
    },
  );

  return {
    insert(input) {
      const steps = parseInput(shape.steps, input.steps, 'plan steps');
      return insertTx.immediate({
        ticketId: parseInput(shape.ticketId, input.ticketId, 'plan ticketId'),
        runId: parseInput(shape.runId, input.runId, 'plan runId'),
        summary: parseInput(shape.summary, input.summary, 'plan summary'),
        steps,
        plannedHelpers: countPlannedHelpers(steps),
      });
    },
    getById(id) {
      const row = byId.get(id) as PlanDbRow | undefined;
      return row && toPlan(row);
    },
    listForTicket(ticketId) {
      return (forTicket.all(ticketId) as PlanDbRow[]).map(toPlan);
    },
    listForRun(runId) {
      return (forRun.all(runId) as PlanDbRow[]).map(toPlan);
    },
    latestForRun(runId) {
      const row = latest.get(runId) as PlanDbRow | undefined;
      return row && toPlan(row);
    },
    approvedForRun(runId) {
      const row = approved.get(runId) as PlanDbRow | undefined;
      return row && toPlan(row);
    },
    decide(id, decision, at) {
      const status = parseInput(TicketPlanStatusSchema, decision, 'plan decision');
      if (status !== 'approved' && status !== 'changes-requested') {
        throw new DbError('invalid_input', 'a plan is approved or sent back with changes');
      }
      const decidedAt =
        at === undefined ? ctx.now().toISOString() : toStoredTimestamp(at, 'plan decidedAt');
      const row = guardWrite(
        'ticket plan',
        () => decide.get(status, decidedAt, id) as PlanDbRow | undefined,
      );
      if (row) return toPlan(row);
      const current = currentStatus.get(id) as string | undefined;
      if (current === undefined) return undefined;
      throw new DbError('conflict', `plan is ${current}, not proposed`);
    },
    supersedeProposed(runId, at) {
      const when =
        at === undefined ? ctx.now().toISOString() : toStoredTimestamp(at, 'plan decidedAt');
      return supersede.run(when, runId).changes;
    },
  };
}
