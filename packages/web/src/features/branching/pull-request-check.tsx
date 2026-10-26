import type { TicketBranchDto } from '@acp/core/api';
import { createContext, useContext, useEffect, useRef } from 'react';
import { refreshPullRequest, type ApiError } from '../../lib/api';
import { useTicketAction } from '../ticket/actions';

/**
 * Reading an open pull request's state when the ticket page opens (ADR-0025 §2: "read when the
 * owner opens the ticket or clicks Refresh"; the server never polls). One check per page visit
 * of a ticket, decided on the first render: a pull request opened later during the visit, a
 * stream notice, a refetch or the check's own answer never start another one. Refresh stays the
 * owner's way to read it again.
 */

export interface PullRequestCheck {
  /** The check on opening the page is running. */
  pending: boolean;
  /** Why it failed, shown on the pull request until the owner presses Refresh. */
  error: ApiError | null;
}

const IDLE: PullRequestCheck = { pending: false, error: null };
const PullRequestCheckContext = createContext<PullRequestCheck>(IDLE);

export const PullRequestCheckProvider = PullRequestCheckContext.Provider;

/** The ticket page's check on opening, for the pull request on its ticket branch card. */
export function usePullRequestCheck(): PullRequestCheck {
  return useContext(PullRequestCheckContext);
}

/** Only a pull request that can still change on GitHub is worth asking about. */
export function checkOnView(
  branch: Pick<TicketBranchDto, 'pullRequest'> | null | undefined,
): boolean {
  return branch?.pullRequest?.state === 'open';
}

/**
 * Asks the server to read the ticket branch's pull request once, when the page opens on a ticket
 * whose current branch has an open one. `branch` is the ticket's current run's branch as the page
 * first has it.
 */
export function useCheckPullRequestOnView(
  ticketId: string,
  branch: Pick<TicketBranchDto, 'pullRequest'> | null | undefined,
): PullRequestCheck {
  const { run, pending, error } = useTicketAction(refreshPullRequest);
  // The ticket this visit already decided for: the effect runs again on every new `branch`
  // (each refetch), and twice under StrictMode, but asks at most once per ticket.
  const decided = useRef<string | null>(null);
  const open = checkOnView(branch);
  useEffect(() => {
    if (decided.current === ticketId) return;
    decided.current = ticketId;
    if (open) void run(ticketId);
  }, [ticketId, open, run]);
  return { pending, error };
}
