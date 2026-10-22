import type { RunDetailDto, TicketBranchReviewDto } from '@acp/core/api';
import { reviewLoopPaths, reviewLoopSchemas, type ApiError } from '../../lib/api';
import { useApiQuery } from '../../lib/query';

/*
 * "Files changed" after a merge (ADR-0026 §5): read only, from the commits the merge recorded
 * (base → merged). The server answers the same `GET /api/runs/:id/ticket-branch` for a merged
 * branch; when git no longer has those commits it refuses, and the page says the files are no
 * longer available. Diffs are never stored, so there is nothing else to show.
 */

export type MergedFiles =
  | { state: 'loading' }
  | { state: 'files'; review: TicketBranchReviewDto }
  | { state: 'unavailable' }
  | { state: 'error'; error: ApiError };

/**
 * How a refusal says the commits are gone: 410 Gone, or a 404/409 whose code names a missing
 * commit, branch or diff (`commits_unavailable`, `ticket_branch_missing`, …).
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

export function mergedFilesState(query: {
  data: TicketBranchReviewDto | undefined;
  error: ApiError | null;
}): MergedFiles {
  const review = query.data;
  if (review !== undefined) {
    // A merged branch with neither files nor a diff: the server had nothing to read them from.
    return review.files.length === 0 && review.diff.length === 0
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

/** The merged ticket branch's files, read only once the branch is merged. */
export function useMergedFiles(run: RunDetailDto | undefined): MergedFiles | null {
  const merged = run?.ticketBranch?.state === 'merged';
  const q = useApiQuery(
    merged && run !== undefined ? reviewLoopPaths.ticketBranch(run.id) : null,
    reviewLoopSchemas.ticketBranch,
  );
  return merged ? mergedFilesState(q) : null;
}
