import { COMMENTS_TAB_KINDS, type TicketCommentKind } from '@acp/core';
import type { TicketCommentDto } from '@acp/core/api';
import { parseMergeLine } from '../ticket/run-summary';

/*
 * Which tab a ticket comment belongs on (ADR-0026 §1). The server stores or derives `kind`; a
 * comment from a server before 0.3.0 has none, so the page derives it the same way: the owner's
 * is a comment, the reviewer's its findings, the app's the run facts (or, for the one-line merge
 * and pull request notes, a system line) and the lead's a note.
 */

export function commentKind(
  comment: Pick<TicketCommentDto, 'kind' | 'author' | 'body'>,
): TicketCommentKind {
  if (comment.kind !== undefined) return comment.kind;
  switch (comment.author) {
    case 'owner':
      return 'comment';
    case 'reviewer':
      return 'review';
    case 'app':
      return parseMergeLine(comment.body) !== null ? 'system' : 'run-facts';
    case 'lead':
      return 'note';
  }
}

/** True for comments on the Comments tab: people's comments and the lead's ticket summary. */
export function onCommentsTab(comment: Pick<TicketCommentDto, 'kind' | 'author' | 'body'>) {
  return COMMENTS_TAB_KINDS.includes(commentKind(comment));
}

function byTime<T extends { createdAt: string }>(a: T, b: T): number {
  return a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? -1 : 1;
}

export interface CommentsTabParts<C> {
  /** The lead's newest ticket summary, or null when it has written none. */
  summary: C | null;
  /** Its earlier versions, newest first. */
  earlierSummaries: C[];
  /** People's comments, oldest first. */
  comments: C[];
}

/** What the Comments tab shows of the ticket's comments. */
export function commentsTabParts<C extends TicketCommentDto>(
  all: readonly C[],
): CommentsTabParts<C> {
  const summaries = all
    .filter((c) => commentKind(c) === 'ticket-summary')
    .sort(byTime)
    .reverse();
  return {
    summary: summaries[0] ?? null,
    earlierSummaries: summaries.slice(1),
    comments: all.filter((c) => commentKind(c) === 'comment').sort(byTime),
  };
}

/** The Comments tab's count: people's comments, plus one for the summary when there is one. */
export function commentsTabCount(all: readonly TicketCommentDto[]): number {
  const parts = commentsTabParts(all);
  return parts.comments.length + (parts.summary !== null ? 1 : 0);
}
