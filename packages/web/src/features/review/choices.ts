import type { ChangeReviewDto, RunDetailDto, TicketBranchDto } from '@acp/core/api';
import { ownerMayDecide, ticketBranchMode } from '../review-loop/logic';
import { REVIEW_PAGE_COPY } from './copy';

/**
 * What "Review changes" may do now (v0.3.0 D-A), through the owner's existing endpoints only:
 *
 * - **rework** (a helper's change): `POST /runs/:id/review` `{ action: 'rework', comment }`, only
 *   when it is the owner's turn on the change (`ownerMayDecide`, as the change card's buttons);
 * - **request-changes** (the ticket branch): `POST /runs/:id/ticket-branch`
 *   `{ action: 'request-changes', comment }`, only while the branch waits for the owner's final
 *   step (`ticketBranchMode` is `merge`, as the branch card's buttons);
 * - **comment**: `POST /tickets/:id/comments` `{ body }`, an owner ticket comment, always.
 *
 * A choice that doesn't apply stays listed, disabled, with the reason. The server checks again;
 * a refusal shows its own reason. `max` is the endpoint's length limit (core's request schemas).
 */

export type ReviewChoiceId = 'rework' | 'request-changes' | 'comment';

export interface ReviewChoice {
  id: ReviewChoiceId;
  enabled: boolean;
  /** Why it is disabled; null when enabled. */
  reason: string | null;
  /** The endpoint's limit on the text (`ReviewActionRequestSchema` and friends). */
  max: number;
}

/** `ReviewActionRequestSchema.comment`. */
export const REWORK_MAX = 4000;
/** `TicketBranchActionRequestSchema.comment`. */
export const REQUEST_CHANGES_MAX = 8000;
/** `TicketCommentRequestSchema.body`. */
export const COMMENT_MAX = 8000;

const R = REVIEW_PAGE_COPY.reasons;

export type ReviewTarget =
  | {
      kind: 'change';
      run: Pick<RunDetailDto, 'agents'>;
      /** Null for a run without the review loop (a helper reviewed the Phase 4 way). */
      change: Pick<ChangeReviewDto, 'state'> | null;
    }
  | {
      kind: 'branch';
      run: Pick<RunDetailDto, 'status'>;
      branch: Pick<TicketBranchDto, 'state'> | null;
    };

function reworkReason(target: Extract<ReviewTarget, { kind: 'change' }>): string | null {
  const { change, run } = target;
  if (change === null) return R.noLoop;
  if (ownerMayDecide(change, run)) return null;
  switch (change.state) {
    case 'merged':
      return R.merged;
    case 'discarded':
      return R.discarded;
    case 'no-changes':
      return R.noChanges;
    case 'sealing':
      return R.sealing;
    default:
      return R.leadDecides;
  }
}

function requestReason(target: Extract<ReviewTarget, { kind: 'branch' }>): string | null {
  const { branch, run } = target;
  if (branch === null) return R.noBranch;
  switch (ticketBranchMode(run, branch)) {
    case 'merge':
      return null;
    case 'waiting':
      return R.branchWaiting;
    case 'discard-only':
      return R.branchStopped;
    case 'closed':
      return branch.state === 'merged' ? R.branchMerged : R.branchDiscarded;
  }
}

/** The choices for this review, the decision first, then Comment. */
export function reviewChoices(target: ReviewTarget): ReviewChoice[] {
  const decide: ReviewChoice =
    target.kind === 'change'
      ? (() => {
          const reason = reworkReason(target);
          return { id: 'rework', enabled: reason === null, reason, max: REWORK_MAX };
        })()
      : (() => {
          const reason = requestReason(target);
          return {
            id: 'request-changes',
            enabled: reason === null,
            reason,
            max: REQUEST_CHANGES_MAX,
          };
        })();
  return [decide, { id: 'comment', enabled: true, reason: null, max: COMMENT_MAX }];
}

/** The choice picked at first: the decision when it is open, else Comment. */
export function defaultChoice(choices: readonly ReviewChoice[]): ReviewChoiceId {
  return choices.find((c) => c.enabled)?.id ?? 'comment';
}
