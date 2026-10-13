import { TicketCommentAuthorSchema, TicketCommentSchema, type TicketComment } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStored, type Parser } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';

export type TicketCommentAuthor = TicketComment['author'];

export interface TicketCommentInsertInput {
  ticketId: string;
  /** A run of this ticket; defaults to the plan's run when `planId` is given, else null. */
  runId?: string | null;
  /** A plan of this ticket, or null. */
  planId?: string | null;
  author: TicketCommentAuthor;
  /** Owner or lead text, stored per ADR-0016. */
  body: string;
}

export interface TicketCommentsRepository {
  /**
   * `not_found` for an unknown ticket, or a run or plan that is not this ticket's;
   * `invalid_input` when `runId` and the plan's run disagree.
   */
  insert(input: TicketCommentInsertInput): TicketComment;
  getById(id: string): TicketComment | undefined;
  /** Oldest first. */
  listForTicket(ticketId: string): TicketComment[];
  /** Comments about one plan (e.g. the owner's change request), oldest first. */
  listForPlan(planId: string): TicketComment[];
}

interface CommentDbRow {
  id: string;
  ticket_id: string;
  run_id: string | null;
  plan_id: string | null;
  author: string;
  body: string;
  created_at: string;
}

const T = 'ticket_comments';
const COLUMNS = 'id, ticket_id, run_id, plan_id, author, body, created_at';
const shape = TicketCommentSchema.shape;

function toComment(row: CommentDbRow): TicketComment {
  return parseStored(
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
  const insert = c.prepare(
    `INSERT INTO ${T} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
  );
  const planRun = c
    .prepare('SELECT run_id FROM ticket_plans WHERE id = ? AND ticket_id = ?')
    .pluck();
  const byId = c.prepare(`SELECT ${COLUMNS} FROM ${T} WHERE id = ?`);
  const forTicket = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE ticket_id = ? ORDER BY created_at, rowid`,
  );
  const forPlan = c.prepare(
    `SELECT ${COLUMNS} FROM ${T} WHERE plan_id = ? ORDER BY created_at, rowid`,
  );

  return {
    insert(input) {
      const ticketId = parseInput(shape.ticketId, input.ticketId, 'comment ticketId');
      const planId = optionalId(shape.planId, input.planId, 'comment planId') ?? null;
      let runId = optionalId(shape.runId, input.runId, 'comment runId');
      const author = parseInput(TicketCommentAuthorSchema, input.author, 'comment author');
      const body = parseInput(shape.body, input.body, 'comment body');
      if (planId !== null) {
        const ofPlan = planRun.get(planId, ticketId) as string | undefined;
        if (ofPlan === undefined) throw new DbError('not_found', 'plan not found on this ticket');
        if (runId === undefined) runId = ofPlan;
        else if (runId !== ofPlan) {
          throw new DbError('invalid_input', "comment runId is not the plan's run");
        }
      }
      return guardWrite('ticket comment', () =>
        toComment(
          insert.get(
            ctx.newId(),
            ticketId,
            runId ?? null,
            planId,
            author,
            body,
            ctx.now().toISOString(),
          ) as CommentDbRow,
        ),
      );
    },
    getById(id) {
      const row = byId.get(id) as CommentDbRow | undefined;
      return row && toComment(row);
    },
    listForTicket(ticketId) {
      return (forTicket.all(ticketId) as CommentDbRow[]).map(toComment);
    },
    listForPlan(planId) {
      return (forPlan.all(planId) as CommentDbRow[]).map(toComment);
    },
  };
}
