import { useState } from 'react';
import { addTicketComment, reviewAction, ticketBranchAction } from '../../lib/api';
import { useTicketAction } from '../ticket/actions';
import type { ReviewChoiceId } from './choices';

/**
 * One send of a review through whichever existing owner endpoint its choice needs (D-A; C-D moved
 * it out of the review page): rework to a helper (`POST /runs/:id/review`), Request changes to the
 * lead (`POST /runs/:id/ticket-branch`) or Comment (`POST /tickets/:id/comments`). `send` answers
 * true when it went through; `error` is the last choice's refusal.
 */
export function useReviewSend(runId: string, ticketId: string, agentRunId: string | null) {
  const rework = useTicketAction(reviewAction);
  const request = useTicketAction(ticketBranchAction);
  const comment = useTicketAction(addTicketComment);
  const [last, setLast] = useState<ReviewChoiceId | null>(null);
  const send = async (choice: ReviewChoiceId, text: string): Promise<boolean> => {
    setLast(choice);
    if (choice === 'rework' && agentRunId !== null) {
      return (await rework.run(runId, { agentRunId, action: 'rework', comment: text })) !== null;
    }
    if (choice === 'request-changes') {
      return (await request.run(runId, { action: 'request-changes', comment: text })) !== null;
    }
    return (await comment.run(ticketId, { body: text })) !== null;
  };
  const used = last === 'rework' ? rework : last === 'request-changes' ? request : comment;
  return {
    send,
    sending: rework.pending || request.pending || comment.pending,
    error: last === null ? null : used.error,
  };
}
