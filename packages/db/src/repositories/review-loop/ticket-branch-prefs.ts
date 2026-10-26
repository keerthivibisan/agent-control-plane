import {
  TicketBranchPrefsSchema,
  type Ticket,
  type TicketBranchPrefs,
  type TicketRunOptions,
} from '@acp/core';
import { DbError } from '../../errors.js';
import type { RepositoryContext } from '../../internal/context.js';
import { parseInput, parseStoredJson, requireNonEmpty } from '../../internal/validate.js';
import { guardWrite } from '../orchestration/shared.js';
import type { TicketInsertInput } from '../workspace/tickets.js';
import { createTicketRunOptionsRepository } from './ticket-options.js';

/**
 * A ticket's own branch name and target branch (`tickets.branch_prefs`, migration 0008,
 * ADR-0025 §4). Read and written here, like the run options (0007), so the Phase 4 tickets
 * repository stays as it shipped. NULL (never `{}`) means both follow the project's branching
 * strategy.
 */
export interface TicketBranchPrefsRepository {
  /**
   * Creates the ticket with its own run options (`TicketRunOptionsRepository.insert`) and branch
   * settings in one transaction. Invalid settings are refused before the ticket number is taken.
   */
  insert(
    input: TicketInsertInput & {
      runOptions?: TicketRunOptions | undefined;
      branch?: TicketBranchPrefs | undefined;
    },
  ): Ticket;
  /** The ticket's settings; undefined when none is set (or the ticket does not exist). */
  get(ticketId: string): TicketBranchPrefs | undefined;
  /** Settings per ticket of the project; tickets without any are absent. */
  listForProject(projectId: string): Map<string, TicketBranchPrefs>;
  /**
   * Replaces the settings as a whole; `null` or `{}` clears them. Bumps the ticket's `updatedAt`.
   * `not_found` for an unknown ticket.
   */
  set(ticketId: string, prefs: TicketBranchPrefs | null): TicketBranchPrefs | undefined;
  /** `ticket` with its settings (`branch` absent when none is set). */
  withPrefs(ticket: Ticket, prefs?: TicketBranchPrefs): Ticket;
}

const T = 'tickets';

/** The stored text: only the set fields, NULL when none is set. */
function toStored(prefs: TicketBranchPrefs | null | undefined): string | null {
  const parsed = parseInput(TicketBranchPrefsSchema, prefs ?? {}, 'ticket branch');
  const set = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined));
  return Object.keys(set).length === 0 ? null : JSON.stringify(set);
}

function fromStored(text: string | null): TicketBranchPrefs | undefined {
  return text === null
    ? undefined
    : parseStoredJson(TicketBranchPrefsSchema, text, T, 'branch_prefs');
}

export function createTicketBranchPrefsRepository(
  ctx: RepositoryContext,
): TicketBranchPrefsRepository {
  const c = ctx.connection;
  const options = createTicketRunOptionsRepository(ctx);
  const byId = c.prepare(`SELECT branch_prefs FROM ${T} WHERE id = ?`);
  const forProject = c.prepare(
    `SELECT id, branch_prefs FROM ${T} WHERE project_id = ? AND branch_prefs IS NOT NULL`,
  );
  const update = c.prepare(
    `UPDATE ${T} SET branch_prefs = ?, updated_at = ? WHERE id = ? RETURNING branch_prefs`,
  );
  const setOnly = c.prepare(`UPDATE ${T} SET branch_prefs = ? WHERE id = ?`);

  function withPrefs(ticket: Ticket, prefs?: TicketBranchPrefs): Ticket {
    const { branch: _drop, ...rest } = ticket;
    return prefs === undefined ? rest : { ...rest, branch: prefs };
  }

  return {
    insert(input) {
      const { branch, ...ticketInput } = input;
      const stored = toStored(branch);
      return c.transaction((): Ticket => {
        const ticket = options.insert(ticketInput);
        if (stored === null) return ticket;
        guardWrite('ticket', () => setOnly.run(stored, ticket.id));
        return withPrefs(ticket, fromStored(stored));
      })();
    },
    get(ticketId) {
      const row = byId.get(requireNonEmpty(ticketId, 'ticketId')) as
        { branch_prefs: string | null } | undefined;
      return row === undefined ? undefined : fromStored(row.branch_prefs);
    },
    listForProject(projectId) {
      const rows = forProject.all(requireNonEmpty(projectId, 'projectId')) as {
        id: string;
        branch_prefs: string;
      }[];
      return new Map(
        rows.flatMap((r) => {
          const prefs = fromStored(r.branch_prefs);
          return prefs === undefined ? [] : [[r.id, prefs] as const];
        }),
      );
    },
    set(ticketId, prefs) {
      const stored = toStored(prefs);
      const row = guardWrite(
        'ticket',
        () =>
          update.get(stored, ctx.now().toISOString(), requireNonEmpty(ticketId, 'ticketId')) as
            { branch_prefs: string | null } | undefined,
      );
      if (row === undefined) throw new DbError('not_found', 'ticket not found');
      return fromStored(row.branch_prefs);
    },
    withPrefs,
  };
}
