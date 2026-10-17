import { TicketRunOptionsSchema, type Ticket, type TicketRunOptions } from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStoredJson, requireNonEmpty } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';
import { createTicketsRepository, type TicketInsertInput } from '../workspace/tickets.js';

/**
 * A ticket's own run options (`tickets.run_options`, migration 0007, RL-H). Like the 0006 columns
 * (`columns.ts`), the column is read and written here so the Phase 4 tickets repository stays as
 * it shipped and keeps working on older schemas. NULL (never `{}`) means every option follows the
 * project.
 */
export interface TicketRunOptionsRepository {
  /**
   * Creates the ticket (`TicketsRepository.insert`) and stores its options in one transaction.
   * Invalid options are refused before the ticket number is taken.
   */
  insert(input: TicketInsertInput & { runOptions?: TicketRunOptions | undefined }): Ticket;
  /** The ticket's options; undefined when none is set (or the ticket does not exist). */
  get(ticketId: string): TicketRunOptions | undefined;
  /** Options per ticket of the project; tickets without any are absent. */
  listForProject(projectId: string): Map<string, TicketRunOptions>;
  /**
   * Replaces the options as a whole; `null` or `{}` clears them. Bumps the ticket's `updatedAt`.
   * `not_found` for an unknown ticket.
   */
  set(ticketId: string, options: TicketRunOptions | null): TicketRunOptions | undefined;
  /** `ticket` with its options (`runOptions` absent when none is set). */
  withOptions(ticket: Ticket, options?: TicketRunOptions): Ticket;
}

const T = 'tickets';

/** The stored text: only the set fields, NULL when none is set. */
function toStored(options: TicketRunOptions | null | undefined): string | null {
  const parsed = parseInput(TicketRunOptionsSchema, options ?? {}, 'ticket runOptions');
  const set = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined));
  return Object.keys(set).length === 0 ? null : JSON.stringify(set);
}

function fromStored(text: string | null): TicketRunOptions | undefined {
  return text === null
    ? undefined
    : parseStoredJson(TicketRunOptionsSchema, text, T, 'run_options');
}

export function createTicketRunOptionsRepository(
  ctx: RepositoryContext,
): TicketRunOptionsRepository {
  const c = ctx.connection;
  const tickets = createTicketsRepository(ctx);
  const byId = c.prepare(`SELECT run_options FROM ${T} WHERE id = ?`);
  const forProject = c.prepare(
    `SELECT id, run_options FROM ${T} WHERE project_id = ? AND run_options IS NOT NULL`,
  );
  const update = c.prepare(
    `UPDATE ${T} SET run_options = ?, updated_at = ? WHERE id = ? RETURNING run_options`,
  );
  const setOnly = c.prepare(`UPDATE ${T} SET run_options = ? WHERE id = ?`);

  function withOptions(ticket: Ticket, options?: TicketRunOptions): Ticket {
    const { runOptions: _drop, ...rest } = ticket;
    return options === undefined ? rest : { ...rest, runOptions: options };
  }

  return {
    insert(input) {
      const { runOptions, ...ticketInput } = input;
      const stored = toStored(runOptions);
      return c.transaction((): Ticket => {
        const ticket = tickets.insert(ticketInput);
        if (stored === null) return ticket;
        guardWrite('ticket', () => setOnly.run(stored, ticket.id));
        return withOptions(ticket, fromStored(stored));
      })();
    },
    get(ticketId) {
      const row = byId.get(requireNonEmpty(ticketId, 'ticketId')) as
        { run_options: string | null } | undefined;
      return row === undefined ? undefined : fromStored(row.run_options);
    },
    listForProject(projectId) {
      const rows = forProject.all(requireNonEmpty(projectId, 'projectId')) as {
        id: string;
        run_options: string;
      }[];
      return new Map(
        rows.flatMap((r) => {
          const options = fromStored(r.run_options);
          return options === undefined ? [] : [[r.id, options] as const];
        }),
      );
    },
    set(ticketId, options) {
      const stored = toStored(options);
      const row = guardWrite(
        'ticket',
        () =>
          update.get(stored, ctx.now().toISOString(), requireNonEmpty(ticketId, 'ticketId')) as
            { run_options: string | null } | undefined,
      );
      if (row === undefined) throw new DbError('not_found', 'ticket not found');
      return fromStored(row.run_options);
    },
    withOptions,
  };
}
