import type { ChangeState, CheckRun } from '@acp/core';
import type { ChangeReviewDto, RunWorkflowDto, TicketBranchDto } from '@acp/core/api';
import type { ChangeReviewRow, TicketBranchRow } from '@acp/db';

/**
 * Review-loop state → the ticket page's DTOs (ADR-0021, `RunDetailDto.ticketBranch` and
 * `.changes`, `RunWorkflowDto.review`). Pure. The engine state is the source of truth for each
 * change (as for statuses elsewhere); the database adds the review rounds and the checks. Nothing
 * here holds conversation text: findings and notes are ticket comments, referenced by id.
 */

export function toTicketBranchDto(row: TicketBranchRow): TicketBranchDto {
  return {
    runId: row.runId,
    branch: row.branch,
    baseBranch: row.baseBranch,
    baseCommit: row.baseCommit,
    headCommit: row.headCommit,
    state: row.state,
    mergedCommit: row.mergedCommit,
    // ADR-0025: the pull request raised for the branch; its base and head are the branch's own.
    pullRequest:
      row.pullRequest === null
        ? null
        : {
            provider: row.pullRequest.provider,
            number: row.pullRequest.number,
            url: row.pullRequest.url,
            state: row.pullRequest.state,
            baseBranch: row.baseBranch,
            headBranch: row.branch,
            checkedAt: row.pullRequest.checkedAt,
            pushedCommit: row.pullRequest.pushedCommit,
          },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The parts of an engine change a card shows (`EngineChange`). */
export interface ChangeView {
  state: ChangeState;
  round: number;
  headCommit: string | null;
  changedFiles: number | null;
  conflictFiles: readonly string[];
}

export interface ChangeDtoInput {
  /** The run's agents in the run's order; those with a change get a card. */
  agents: readonly { id: string; role: string; change?: ChangeView | undefined }[];
  reviews: readonly ChangeReviewRow[];
  /** The run's checks with their commits (`CheckCommitsRepository.listForRun`), oldest first. */
  checks: readonly CheckRun[];
  /** The run's snapshotted limit (the owner can grant more; `reworkRounds` may pass it). */
  maxReworkRounds: number;
  /** ADR-0023: one change's own limit (its node's review route); `maxReworkRounds` otherwise. */
  maxRoundsOf?: (agentRunId: string) => number;
}

/** The latest result per check id, in check-id order. */
function latestPerCheck(runs: readonly CheckRun[]): CheckRun[] {
  const latest = new Map<string, CheckRun>();
  for (const run of runs) latest.set(run.checkId, run);
  return [...latest.values()].sort((a, b) => a.checkId.localeCompare(b.checkId));
}

/** One card per helper or tester whose change is in the loop. */
export function toChangeReviewDtos(input: ChangeDtoInput): ChangeReviewDto[] {
  const out: ChangeReviewDto[] = [];
  for (const agent of input.agents) {
    const change = agent.change;
    if (change === undefined) continue;
    const head = change.headCommit;
    out.push({
      agentRunId: agent.id,
      role: agent.role,
      state: change.state,
      reworkRounds: change.round,
      maxReworkRounds: input.maxRoundsOf?.(agent.id) ?? input.maxReworkRounds,
      headCommit: head,
      changedFiles: change.changedFiles,
      conflictFiles: change.conflictFiles.slice(0, 100),
      // Only results on the change's own commit (ADR-0021: checks gate the commit they ran on).
      checks:
        head === null
          ? []
          : latestPerCheck(
              input.checks.filter((c) => c.agentRunId === agent.id && c.commit === head),
            ),
      reviews: input.reviews
        .filter((r) => r.agentRunId === agent.id)
        .map((r) => ({
          id: r.id,
          round: r.round,
          reviewer: r.reviewer,
          reviewerAgentRunId: r.reviewerAgentRunId,
          verdict: r.verdict,
          decision: r.decision,
          decidedBy: r.decidedBy,
          commentId: r.commentId,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt,
        })),
    });
  }
  return out;
}

/** `RunWorkflowDto.review`: how many changes are in each part of the loop. */
export function reviewCounts(
  changes: readonly Pick<ChangeView, 'state' | 'round'>[],
): NonNullable<RunWorkflowDto['review']> {
  const counts = {
    waiting: 0,
    inReview: 0,
    rework: 0,
    needsOwner: 0,
    merged: 0,
    discarded: 0,
    noChanges: 0,
    reworkRounds: 0,
  };
  for (const c of changes) {
    counts.reworkRounds += c.round;
    switch (c.state) {
      case 'sealing':
      case 'ready':
        counts.waiting++;
        break;
      case 'reviewing':
      case 'decision':
        counts.inReview++;
        break;
      case 'rework':
        counts.rework++;
        break;
      case 'needs-owner':
        counts.needsOwner++;
        break;
      case 'merged':
        counts.merged++;
        break;
      case 'discarded':
        counts.discarded++;
        break;
      case 'no-changes':
        counts.noChanges++;
        break;
    }
  }
  return counts;
}
