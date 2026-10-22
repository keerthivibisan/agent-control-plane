import {
  GitBranchNameSchema,
  renderTicketBranchName,
  ticketBranchName,
  type BranchStrategy,
  type Ticket,
} from '@acp/core';
import { WorkspaceError } from './errors.js';

/**
 * How a ticket's branch is named and where it starts and ends (ADR-0025 §3, §4). Pure: the git
 * side is the workspace manager's.
 *
 * - **Name:** the ticket's own `branch.name`, else the project strategy's template
 *   (`renderTicketBranchName`), else (no strategy) `acp/<KEY>` as before ADR-0025. When the name
 *   is taken, attempt `n` adds `-r<n>`, for every kind of name.
 * - **Target:** the ticket's own `branch.target`, else the strategy's `defaultTargetBranch`, else
 *   null: the branch the project has checked out, as before.
 * - **Long-lived branches** the app never creates, moves, merges, pushes from or deletes as a
 *   ticket branch: `main`, `master`, the strategy's base and default target, `develop` in Git
 *   flow, and (checked by the manager in the repository) the run's target, the checked-out branch
 *   and `origin`'s default branch.
 */

export interface TicketBranchPlan {
  /** The ticket key, for messages and the legacy name. */
  ticketKey: string;
  /** The name for attempt `n` (0 is the plain name); throws a `WorkspaceError` when unsafe. */
  nameFor(attempt: number): string;
  /** The branch the ticket branch starts from and is merged into; null: the checked-out branch. */
  target: string | null;
  /** Names that are never a ticket branch, beyond the target and the repository's own. */
  protectedNames: readonly string[];
}

/** Always refused as a ticket branch, whatever the project says. */
export const ALWAYS_PROTECTED: readonly string[] = ['main', 'master'];

/** The long-lived branches a project's strategy names (and `develop` in Git flow). */
export function strategyProtectedNames(strategy: BranchStrategy | undefined): string[] {
  const names = new Set(ALWAYS_PROTECTED);
  if (strategy !== undefined) {
    names.add(strategy.baseBranch);
    names.add(strategy.defaultTargetBranch);
    if (strategy.preset === 'git-flow') names.add('develop');
  }
  return [...names];
}

function unsafe(message: string): WorkspaceError {
  return new WorkspaceError('invalid-ticket-branch', message);
}

export function ticketBranchPlan(
  strategy: BranchStrategy | undefined,
  ticket: Pick<Ticket, 'key' | 'title' | 'type' | 'branch'>,
): TicketBranchPlan {
  const own = ticket.branch?.name;
  const nameFor = (attempt: number): string => {
    if (!Number.isInteger(attempt) || attempt < 0) throw unsafe('Not a ticket branch attempt');
    try {
      if (own !== undefined) {
        return GitBranchNameSchema.parse(attempt === 0 ? own : `${own}-r${attempt}`);
      }
      if (strategy !== undefined) return renderTicketBranchName(strategy, ticket, attempt);
      return ticketBranchName(ticket.key, attempt);
    } catch {
      throw unsafe('The ticket gives no valid branch name');
    }
  };
  return {
    ticketKey: ticket.key,
    nameFor,
    target: ticket.branch?.target ?? strategy?.defaultTargetBranch ?? null,
    protectedNames: strategyProtectedNames(strategy),
  };
}

/** The legacy plan for a ticket key alone: `acp/<KEY>` from the checked-out branch. */
export function legacyTicketBranchPlan(ticketKey: string): TicketBranchPlan {
  return {
    ticketKey,
    nameFor: (attempt) => {
      try {
        return ticketBranchName(ticketKey, attempt);
      } catch {
        throw unsafe('The ticket key gives no branch name');
      }
    },
    target: null,
    protectedNames: ALWAYS_PROTECTED,
  };
}
