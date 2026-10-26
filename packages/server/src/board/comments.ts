import type { Attachment, TicketCommentKind } from '@acp/core';
import type { AttachmentDto, TicketCommentDto } from '@acp/core/api';
import { DbError, type StoredTicketComment } from '@acp/db';
import { isRunSummaryComment } from '../control/run-summary.js';
import { HttpError } from '../errors.js';

/**
 * Ticket comments and attachments as the API shows them (ADR-0026 §1). `kind` decides the tab:
 * stored since migration 0009, derived for older comments from who wrote them:
 * - the owner → `comment`; a reviewer → `review`; the lead → `note` (its rework, discard and ask
 *   notes were its only comments before 0009);
 * - the app → `run-facts` for a run summary (ADR-0024 §3), else `system` (merge and pull request
 *   lines, ticket branch failures).
 */
export function commentKindOf(comment: StoredTicketComment): TicketCommentKind {
  if (comment.kind !== null) return comment.kind;
  switch (comment.author) {
    case 'owner':
      return 'comment';
    case 'reviewer':
      return 'review';
    case 'lead':
      return 'note';
    case 'app':
      return isRunSummaryComment(comment) ? 'run-facts' : 'system';
  }
}

/**
 * The attachments repository's refusals as HTTP errors: an id that is not the ticket's (404), one
 * already on another comment, or the per-ticket limit (409).
 */
export function attachmentDbError(error: unknown): HttpError | null {
  if (!(error instanceof DbError)) return null;
  if (error.code === 'not_found') {
    return new HttpError(404, 'attachment_not_found', 'No such attachment on this ticket');
  }
  if (error.code === 'conflict') return new HttpError(409, 'attachment_conflict', error.message);
  return null;
}

/** `/api/attachments/:id/content`. */
export function attachmentContentUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/content`;
}

export function toAttachmentDto(attachment: Attachment): AttachmentDto {
  return { ...attachment, contentUrl: attachmentContentUrl(attachment.id) };
}

/** The DTO of one comment, with the attachments that belong to it. */
export function toCommentDto(
  comment: StoredTicketComment,
  attachments: readonly Attachment[] = [],
): TicketCommentDto {
  return {
    id: comment.id,
    ticketId: comment.ticketId,
    runId: comment.runId,
    planId: comment.planId,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
    kind: commentKindOf(comment),
    agentRunId: comment.agentRunId,
    attachments: attachments.filter((a) => a.commentId === comment.id).map(toAttachmentDto),
  };
}

/** Every comment of a ticket as DTOs, oldest first, each with its attachments. */
export function toCommentDtos(
  comments: readonly StoredTicketComment[],
  attachments: readonly Attachment[],
): TicketCommentDto[] {
  return comments.map((c) => toCommentDto(c, attachments));
}
