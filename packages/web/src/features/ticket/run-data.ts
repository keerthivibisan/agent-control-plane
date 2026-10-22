import type { CheckRunDto, ReviewDto, RunDetailDto, TicketDetailDto } from '@acp/core/api';
import {
  controlPaths,
  controlSchemas,
  reviewLoopPaths,
  reviewLoopSchemas,
  ticketPaths,
  ticketSchemas,
} from '../../lib/api';
import { useApiQuery } from '../../lib/query';
import { hasReview } from '../control/run-state';
import { ticketBranchMode, type TicketBranchMode } from '../review-loop/logic';

/*
 * What the ticket page's tabs read about the run on screen (v0.3.0 D-B). Read once on the page,
 * so every tab and the header share the same cached answers.
 */

export type AgentReview = ReviewDto['agents'][number];

/**
 * The run's per-helper review (files and diff): once a legacy run is in review, or once a review
 * loop run has a sealed change.
 */
export function useRunReview(run: RunDetailDto | undefined): readonly AgentReview[] {
  const q = useApiQuery(
    run !== undefined && (hasReview(run) || (run.changes ?? []).some((c) => c.headCommit !== null))
      ? controlPaths.review(run.id)
      : null,
    controlSchemas.review,
  );
  return q.data?.agents ?? [];
}

/** The run's checks: the ticket carries the current run's; an earlier run's are read on their own. */
export function useRunChecks(
  detail: TicketDetailDto,
  runId: string | null,
  isCurrent: boolean,
): readonly CheckRunDto[] {
  const older = useApiQuery(
    runId === null || isCurrent ? null : ticketPaths.runChecks(runId),
    ticketSchemas.checks,
  );
  if (runId === null) return [];
  return isCurrent ? detail.checks.filter((c) => c.runId === runId) : (older.data ?? []);
}

/**
 * The run's ticket branch (ADR-0021 §4), what the owner may do with it now, and its combined
 * change (`GET /runs/:id/ticket-branch`: files, diff, tip checks), read only once the run waits
 * for the final step or has stopped with the branch open.
 */
export function useTicketBranchReview(run: RunDetailDto | undefined) {
  const branch = run?.ticketBranch ?? null;
  const mode: TicketBranchMode | null =
    run !== undefined && branch !== null ? ticketBranchMode(run, branch) : null;
  const live = mode === 'merge' || mode === 'discard-only';
  const query = useApiQuery(
    live && run !== undefined ? reviewLoopPaths.ticketBranch(run.id) : null,
    reviewLoopSchemas.ticketBranch,
  );
  return { branch, mode, live, query };
}

export type TicketBranchReview = ReturnType<typeof useTicketBranchReview>;
