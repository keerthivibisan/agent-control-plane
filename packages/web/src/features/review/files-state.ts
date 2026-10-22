import type {
  ChangeReviewDto,
  ReviewDto,
  RunDetailDto,
  TicketBranchDto,
  TicketBranchReviewDto,
} from '@acp/core/api';
import type { ApiError } from '../../lib/api';

/*
 * What the ticket's Files changed tab shows (v0.3.0 C-D), as pure rules: which change is chosen in
 * "Changes from", which state the work is in (open, merged, closed), and what the ticket branch's
 * answer means once it is merged or discarded (ADR-0026 §5: read only, from the recorded commits;
 * "no longer available" when git no longer has them). Diffs are never stored.
 */

/** The tab's state label: the ticket branch's state, or null for a run without one. */
export type FilesState = 'open' | 'merged' | 'closed';

export function filesStateOf(branch: Pick<TicketBranchDto, 'state'> | null): FilesState | null {
  if (branch === null) return null;
  return branch.state === 'open' ? 'open' : branch.state === 'merged' ? 'merged' : 'closed';
}

/** Merged or closed work is read only: files, the tree and Viewed; no comments, no reviews. */
export const isReadOnly = (state: FilesState | null) => state === 'merged' || state === 'closed';

/** One helper's change in "Changes from": its agent run and helper, and what the run knows. */
export interface ChangeChoice {
  agentRunId: string;
  role: string;
  /** The review loop's change (ADR-0021); null for a helper of a run without the loop. */
  change: ChangeReviewDto | null;
  /** The server's review entry (files and diff) while it lists one. */
  review: ReviewDto['agents'][number] | null;
}

/**
 * The changes the picker offers: a review-loop run's changes, in the run's order; else every
 * helper that works in its own copy and has (or had) a review.
 */
export function changeChoices(
  run: Pick<RunDetailDto, 'changes' | 'agents'>,
  reviews: readonly ReviewDto['agents'][number][],
  hasWorktree: (kind: RunDetailDto['agents'][number]['kind']) => boolean,
): ChangeChoice[] {
  const reviewOf = (id: string) => reviews.find((r) => r.agentRunId === id) ?? null;
  if (run.changes !== undefined) {
    return run.changes.map((c) => ({
      agentRunId: c.agentRunId,
      role: c.role,
      change: c,
      review: reviewOf(c.agentRunId),
    }));
  }
  return run.agents
    .filter((a) => hasWorktree(a.kind))
    .map((a) => ({ agentRunId: a.id, role: a.role, change: null, review: reviewOf(a.id) }));
}

/** What the tab shows: all changes (the ticket branch), one change, or nothing yet. */
export type FilesSelection =
  { kind: 'all' } | { kind: 'change'; agentRunId: string } | { kind: 'none' };

/**
 * The address's `change` when it names one; else all changes when the run has a ticket branch;
 * else (a run without one) the first change the server lists files for, then the first change.
 */
export function selectionFor(
  asked: string | null,
  hasBranch: boolean,
  choices: readonly ChangeChoice[],
): FilesSelection {
  if (asked !== null) return { kind: 'change', agentRunId: asked };
  if (hasBranch) return { kind: 'all' };
  const first = choices.find((c) => c.review !== null) ?? choices[0];
  return first === undefined ? { kind: 'none' } : { kind: 'change', agentRunId: first.agentRunId };
}

/**
 * How a refusal says the commits are gone: 410 Gone (`diff_unavailable`), or a 404/409 whose code
 * names a missing commit, branch or diff (`commits_unavailable`, `ticket_branch_missing`, …).
 */
export function isGoneError(error: ApiError): boolean {
  if (error.kind !== 'http') return false;
  if (error.status === 410) return true;
  return (
    (error.status === 404 || error.status === 409) &&
    error.code !== null &&
    /unavailable|missing|gone|not_available/.test(error.code)
  );
}

export type BranchFiles =
  | { state: 'loading' }
  | { state: 'files'; review: TicketBranchReviewDto }
  | { state: 'unavailable' }
  | { state: 'error'; error: ApiError };

/**
 * The ticket branch's answer for the tab. Once the branch is settled (`closed`: merged or
 * discarded), an answer with neither files nor a diff is what servers before ADR-0026 §5 send,
 * which had nothing to read them from: "no longer available" too. An open branch with no files
 * is simply empty.
 */
export function branchFilesState(
  query: { data: TicketBranchReviewDto | undefined; error: ApiError | null },
  closed: boolean,
): BranchFiles {
  const review = query.data;
  if (review !== undefined) {
    return closed && review.files.length === 0 && review.diff.length === 0
      ? { state: 'unavailable' }
      : { state: 'files', review };
  }
  if (query.error !== null) {
    return isGoneError(query.error)
      ? { state: 'unavailable' }
      : { state: 'error', error: query.error };
  }
  return { state: 'loading' };
}
