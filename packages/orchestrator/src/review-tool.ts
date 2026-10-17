import { redact, TicketCommentSchema } from '@acp/core';
import type { ChangeVerdict } from '@acp/core';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { emitRound, leadCanDecide, notifyLead } from './loop.js';
import { isChangeReviewer, MAX_REVIEW_POSTS, REVIEW_POST_MAX_CHARS } from './stages.js';
import type { EngineContext, EngineResult, RunState } from './state.js';
import { cleanSummary } from './summary.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * The reviewer's one control-plane tool (ADR-0019 §2, decision B): `post_review` turns its
 * plain-text findings into a ticket comment by author `reviewer`. It never blocks or merges
 * anything. The input is validated with `LeadToolInputs.post_review` in `leadToolCall`.
 */

/**
 * Redacts, then caps to the comment limit. Redaction can lengthen the text (replacement markers),
 * so the cap comes after it and the stored comment always fits `TicketCommentSchema.body`.
 */
export function cleanReviewBody(text: string): string {
  const body = redact(text).trim();
  return body.length <= REVIEW_POST_MAX_CHARS
    ? body
    : `${body.slice(0, REVIEW_POST_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * A reviewer's `post_review`. Allowed for a live reviewer of a run in REVIEW, at most
 * `MAX_REVIEW_POSTS` times. Emits `review-comment`; the server stores it. With the review loop
 * (ADR-0021 §5) the final review runs while the run is RUNNING and each finding also goes to the
 * live lead.
 */
export function postReview(
  state: RunState,
  callerAgentRunId: string,
  text: string,
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const reviewer = d.agent(callerAgentRunId);
    if (reviewer?.kind !== 'reviewer') {
      return refusal('not-lead', 'Only the reviewer can post a review.');
    }
    if (isChangeReviewer(reviewer)) {
      return refusal('not-lead', 'A change reviewer submits its review with submit_review.');
    }
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    const loop = d.integration !== undefined;
    const reviewing = loop
      ? ['RUNNING', 'BLOCKED', 'REVIEW'].includes(d.run.status)
      : d.run.status === 'REVIEW';
    if (!reviewing || !isLiveAgentStatus(reviewer.status)) {
      return refusal('run-not-active', 'The code review is over.');
    }
    const posted = reviewer.reviewPosts ?? 0;
    if (posted >= MAX_REVIEW_POSTS) {
      return refusal(
        'invalid-input',
        `You already posted ${MAX_REVIEW_POSTS} times, the most allowed; finish now.`,
      );
    }
    const body = cleanReviewBody(text);
    if (!TicketCommentSchema.shape.body.safeParse(body).success) {
      return refusal('invalid-input', 'The findings are empty.');
    }
    reviewer.reviewPosts = posted + 1;
    d.effects.push({ type: 'review-comment', agentRunId: reviewer.id, body });
    if (loop) notifyLead(d, `Final code review finding:\n\n${body}`);
    return { value: 'Posted to the ticket. Post more findings, or finish if you are done.' };
  });
}

/**
 * A change reviewer's `submit_review` (ADR-0021 §3; input validated with
 * `LeadToolInputs.submit_review`): once per review, while its change is under its review. The
 * findings become a ticket comment by author `reviewer` and go to the lead with the verdict; the
 * change waits for the lead's decision (or the owner's, when no lead is live). The verdict is
 * advice, never a gate.
 */
export function submitReview(
  state: RunState,
  callerAgentRunId: string,
  input: { verdict: ChangeVerdict; findings: string },
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const reviewer = d.agent(callerAgentRunId);
    if (reviewer === undefined || !isChangeReviewer(reviewer)) {
      return refusal('not-lead', 'Only a change reviewer can submit a change review.');
    }
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    if (!isLiveAgentStatus(reviewer.status)) {
      return refusal('run-not-active', 'This review is over.');
    }
    const helper = d.agent(reviewer.reviewsAgentRunId ?? '');
    const change = helper?.change;
    if (
      helper === undefined ||
      change?.state !== 'reviewing' ||
      change.reviewerAgentRunId !== reviewer.id
    ) {
      return refusal(
        'run-not-active',
        'Your review was already submitted, or the change was decided; end your turn now.',
      );
    }
    const body = cleanReviewBody(input.findings);
    if (!TicketCommentSchema.shape.body.safeParse(body).success) {
      return refusal('invalid-input', 'The findings are empty.');
    }
    change.verdict = input.verdict;
    change.state = leadCanDecide(d) ? 'decision' : 'needs-owner';
    reviewer.reviewPosts = 1;
    reviewer.latestActivity = cleanSummary(
      `Reviewed ${helper.role}'s change: ${input.verdict}`,
      'Reviewed a change',
    );
    d.effects.push({
      type: 'review-comment',
      agentRunId: reviewer.id,
      body,
      changeOf: helper.id,
      round: change.round,
      verdict: input.verdict,
    });
    emitRound(d, helper);
    notifyLead(
      d,
      [
        `The review agent reviewed ${helper.role}'s change (agentId ${helper.id}${change.round > 0 ? `, after rework round ${change.round}` : ''}). Verdict: ${input.verdict}.`,
        `Findings:\n${body}`,
        'Decide with merge_change, request_rework (with comments), discard_change (with a reason) or ask_owner; view_change shows the change.',
      ].join('\n\n'),
    );
    return { value: 'Submitted. Your review is done: end your turn now.' };
  });
}
