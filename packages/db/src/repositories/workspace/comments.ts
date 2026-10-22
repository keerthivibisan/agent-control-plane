import {
  TicketCommentAuthorSchema,
  TicketCommentKindSchema,
  TicketCommentSchema,
  type TicketComment,
  type TicketCommentKind,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { lazy } from '../../internal/lazy.js';
import { parseInput, parseStored, type Parser } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

export type TicketCommentAuthor = TicketComment['author'];

/**
 * A comment as stored (ADR-0026): `kind` is null for comments stored before migration 0009 (the
 * server derives it), and `agentRunId` names the helper or tester of an `agent-note`.
 */
export type StoredTicketComment = TicketComment & {
  kind: TicketCommentKind | null;
  agentRunId: string | null;
};

export interface TicketCommentInsertInput {
  ticketId: string;
  /** A run of this ticket; defaults to the plan's run when `planId` is given, else null. */
  runId?: string | null;
  /** A plan of this ticket, or null. */
  planId?: string | null;
  author: TicketCommentAuthor;
  /** Owner or lead text, stored per ADR-0016. */
  body: string;
  /** ADR-0026: which tab it belongs on. Absent: null, and the server derives it. */
  kind?: TicketCommentKind | null;
  /** The agent run that wrote it (an agent note); must be an agent of `runId`. */
  agentRunId?: string | null;
}

export interface AgentNoteInput {
  ticketId: string;
  runId: string;
  agentRunId: string;
  body: string;
}

export interface TicketCommentsRepository {
  /**
   * `not_found` for an unknown ticket, or a run or plan that is not this ticket's, or an agent run
   * that is not the run's; `invalid_input` when `runId` and the plan's run disagree, or an agent
   * run is given without a run.
   */
  insert(input: TicketCommentInsertInput): StoredTicketComment;
  /**
   * ADR-0026 §3: a helper's or tester's `report_work` note, kind `agent-note`, author `app`. One
   * per agent run: a later note replaces the body and moves the comment to now, so the timeline
   * shows it after the agent's latest turn.
   */
  upsertAgentNote(input: AgentNoteInput): StoredTicketComment;
  getById(id: string): StoredTicketComment | undefined;
  /** Oldest first. */
  listForTicket(ticketId: string): StoredTicketComment[];
  /** Comments about one plan (e.g. the owner's change request), oldest first. */
  listForPlan(planId: string): StoredTicketComment[];
}

interface CommentDbRow {
  id: string;
  ticket_id: string;
  run_id: string | null;
  plan_id: string | null;
  author: string;
  body: string;
  created_at: string;
  kind: string | null;
  agent_run_id: string | null;
}

const T = 'ticket_comments';
const COLUMNS = 'id, ticket_id, run_id, plan_id, author, body, created_at, kind, agent_run_id';
const shape = TicketCommentSchema.shape;

function toComment(row: CommentDbRow): StoredTicketComment {
  const comment = parseStored(
    TicketCommentSchema,
    {
      id: row.id,
      ticketId: row.ticket_id,
      runId: row.run_id,
      planId: row.plan_id,
      author: row.author,
      body: row.body,
      createdAt: row.created_at,
    },
    T,
    '*',
  );
  return {
    ...comment,
    kind: row.kind === null ? null : parseStored(TicketCommentKindSchema, row.kind, T, 'kind'),
    agentRunId: row.agent_run_id,
  };
}

function optionalId(
  schema: Parser<string | null>,
  value: unknown,
  what: string,
): string | null | undefined {
  return value === undefined ? undefined : parseInput(schema, value, what);
}

export function createTicketCommentsRepository(ctx: RepositoryContext): TicketCommentsRepository {
  const c = ctx.connection;
  const insert = lazy(() =>
    c.prepare(
      `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
    ),
  );
  const planRun = c
    .prepare('SELECT run_id FROM ticket_plans WHERE id = ? AND ticket_id = ?')
    .pluck();
  const agentOfRun = c.prepare('SELECT 1 FROM agent_runs WHERE id = ? AND run_id = ?').pluck();
  const byId = lazy(() => c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`));
  const forTicket = lazy(() =>
    c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE ticket_id = ? ORDER BY created_at, rowid`),
  );
  const forPlan = lazy(() =>
    c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE plan_id = ? ORDER BY created_at, rowid`),
  );
  const noteOf = lazy(() =>
    c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE agent_run_id = ? AND kind = 'agent-note'`),
  );
  const replaceNote = lazy(() =>
    c.prepare(`UPDATE ${T} SET body = ?, created_at = ? WHERE id = ? RETURNING ${COLUMNS}`),
  );

  function insertComment(input: TicketCommentInsertInput): StoredTicketComment {
    const ticketId = parseInput(shape.ticketId, input.ticketId, 'comment ticketId');
    const planId = optionalId(shape.planId, input.planId, 'comment planId') ?? null;
    let runId = optionalId(shape.runId, input.runId, 'comment runId');
    const author = parseInput(TicketCommentAuthorSchema, input.author, 'comment author');
    const body = parseInput(shape.body, input.body, 'comment body');
    const kind =
      input.kind === undefined || input.kind === null
        ? null
        : parseInput(TicketCommentKindSchema, input.kind, 'comment kind');
    const agentRunId = optionalId(shape.runId, input.agentRunId, 'comment agentRunId') ?? null;
    if (planId !== null) {
      const ofPlan = planRun.get(planId, ticketId) as string | undefined;
      if (ofPlan === undefined) throw new DbError('not_found', 'plan not found on this ticket');
      if (runId === undefined) runId = ofPlan;
      else if (runId !== ofPlan) {
        throw new DbError('invalid_input', "comment runId is not the plan's run");
      }
    }
    if (agentRunId !== null) {
      if (runId === undefined || runId === null) {
        throw new DbError('invalid_input', 'an agent comment needs its run');
      }
      if (agentOfRun.get(agentRunId, runId) === undefined) {
        throw new DbError('not_found', 'agent run not found in this run');
      }
    }
    return guardWrite('ticket comment', () =>
      toComment(
        insert().get(
          ctx.newId(),
          ticketId,
          runId ?? null,
          planId,
          author,
          body,
          ctx.now().toISOString(),
          kind,
          agentRunId,
        ) as CommentDbRow,
      ),
    );
  }

  const upsertNote = c.transaction((input: AgentNoteInput): StoredTicketComment => {
    const agentRunId = parseInput(shape.id, input.agentRunId, 'note agentRunId');
    const body = parseInput(shape.body, input.body, 'note body');
    const existing = noteOf().get(agentRunId) as CommentDbRow | undefined;
    if (existing === undefined) {
      return insertComment({
        ticketId: input.ticketId,
        runId: input.runId,
        author: 'app',
        body,
        kind: 'agent-note',
        agentRunId,
      });
    }
    if (existing.ticket_id !== input.ticketId || existing.run_id !== input.runId) {
      throw new DbError('invalid_input', "the note belongs to another run's agent");
    }
    return toComment(replaceNote().get(body, ctx.now().toISOString(), existing.id) as CommentDbRow);
  });

  return {
    insert: insertComment,
    upsertAgentNote(input) {
      return upsertNote(input);
    },
    getById(id) {
      const row = byId().get(id) as CommentDbRow | undefined;
      return row && toComment(row);
    },
    listForTicket(ticketId) {
      return (forTicket().all(ticketId) as CommentDbRow[]).map(toComment);
    },
    listForPlan(planId) {
      return (forPlan().all(planId) as CommentDbRow[]).map(toComment);
    },
  };
}
