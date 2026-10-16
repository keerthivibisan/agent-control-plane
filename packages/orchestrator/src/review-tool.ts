import { redact, TicketCommentSchema } from '@acp/core';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { MAX_REVIEW_POSTS, REVIEW_POST_MAX_CHARS } from './stages.js';
import type { EngineContext, EngineResult, RunState } from './state.js';
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
 * `MAX_REVIEW_POSTS` times. Emits `review-comment`; the server stores it.
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
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    if (d.run.status !== 'REVIEW' || !isLiveAgentStatus(reviewer.status)) {
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
    return { value: 'Posted to the ticket. Post more findings, or finish if you are done.' };
  });
}
