import { redact, TicketCommentSchema } from '@acp/core';
import type { ChangeVerdict } from '@acp/core';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { isOverBudget } from './budget.js';
import type { Draft } from './draft.js';
import { runLimits } from './limits.js';
import { activeHelperCount, applyDecision, emitRound, leadCanDecide, notifyLead } from './loop.js';
import { editingNodeOf, reviewRouteOf } from './program.js';
import type { EngineAgent } from './state.js';
import { isChangeReviewer, MAX_REVIEW_POSTS, REVIEW_POST_MAX_CHARS, stageOf } from './stages.js';
import type { EngineContext, EngineResult, RunState } from './state.js';
import { cleanSummary } from './summary.js';
import { isActiveAgentStatus, isLiveAgentStatus } from './transitions.js';

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
    // ADR-0023 §4, route "direct": the reviewer sends a change back to its helper itself while
    // its rounds, the helper's budget and a slot allow; otherwise the lead decides, as in route b.
    const route = reviewRouteOf(d.program(), helper);
    const directRounds =
      route.by === 'agent' && route.then === 'direct' ? route.reviewerRounds : null;
    const reworkDirect =
      directRounds !== null &&
      input.verdict === 'rework' &&
      directReworkAllowed(d, helper, reviewer, directRounds);
    change.state = reworkDirect ? 'decision' : leadCanDecide(d) ? 'decision' : 'needs-owner';
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
    if (reworkDirect) {
      applyDecision(d, helper, { decision: 'rework', by: 'reviewer', comments: body });
      return {
        value:
          'Submitted. Your findings went back to the helper for rework, and its next change will be reviewed again. Your review is done: end your turn now.',
      };
    }
    const outOfRounds =
      directRounds !== null && input.verdict === 'rework'
        ? `The review agent has no rework round left for it (${directRounds} used or not allowed now), so you decide.`
        : null;
    notifyLead(
      d,
      [
        `The review agent reviewed ${helper.role}'s change (agentId ${helper.id}${change.round > 0 ? `, after rework round ${change.round}` : ''}). Verdict: ${input.verdict}.`,
        `Findings:\n${body}`,
        outOfRounds,
        'Decide with merge_change, request_rework (with comments), discard_change (with a reason) or ask_owner; view_change shows the change.',
      ]
        .filter((l) => l !== null)
        .join('\n\n'),
    );
    return { value: 'Submitted. Your review is done: end your turn now.' };
  });
}

/**
 * Whether a change reviewer on route "direct" may send the change back itself (ADR-0023 §4): it
 * has rounds left, the run is going, the helper waits for its review within its budget, and a
 * helper slot is free (the reviewer itself is done, so it does not hold one) as well as room in
 * the helper's node.
 */
function directReworkAllowed(
  d: Draft,
  helper: EngineAgent,
  reviewer: EngineAgent,
  rounds: number,
): boolean {
  const change = helper.change;
  if (change === undefined || (change.reviewerRounds ?? 0) >= rounds) return false;
  if (!['RUNNING', 'BLOCKED', 'REVIEW'].includes(d.run.status)) return false;
  if (helper.status !== 'AWAITING_REVIEW' || change.merging) return false;
  if (isOverBudget(helper.budgetTokensUsed, helper.budgetLimit)) return false;
  const others = activeHelperCount(d) - (isActiveAgentStatus(reviewer.status) ? 1 : 0);
  if (others >= runLimits(d).maxConcurrentHelpers) return false;
  const node = editingNodeOf(d.program(), helper);
  if (node !== undefined && node.type !== 'tester') {
    const id = stageOf(helper);
    const live = d.agents.filter(
      (a) => a.kind === helper.kind && stageOf(a) === id && isActiveAgentStatus(a.status),
    ).length;
    if (live >= node.maxInstances) return false;
  }
  return true;
}
