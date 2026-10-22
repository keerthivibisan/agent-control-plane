import { useCallback, useMemo } from 'react';
import { readRaw, useStoredRaw, writeRaw } from './storage';

/**
 * The pending review (v0.3.0 D-A): the owner's comments on lines and an overall comment, kept in
 * this browser until they are sent, like a GitHub review in progress. One per change (or ticket
 * branch) of a run. No server storage: on submit the comments are compiled into the text of an
 * existing owner decision (`compile.ts`), and the pending review is cleared.
 */

export type CommentSide = 'old' | 'new';

export interface PendingComment {
  id: string;
  /** The file's path in the diff (the new path; the old one for a deleted file). */
  path: string;
  side: CommentSide;
  /** The first line of a range; equal to `endLine` for one line. */
  line: number;
  /** The line the comment is shown under: the last of a range. */
  endLine: number;
  body: string;
  /** The commit the comment was written on; null when the change had none. */
  commit: string | null;
  createdAt: string;
}

export interface PendingReview {
  comments: PendingComment[];
  /** The overall comment, sent after the line comments. */
  summary: string;
}

export const EMPTY_REVIEW: PendingReview = { comments: [], summary: '' };

/** Which review: a helper's change (`agentRunId`) or the run's ticket branch (null). */
export interface ReviewScope {
  runId: string;
  agentRunId: string | null;
}

export const PENDING_PREFIX = 'acp.review.pending.';

export function scopeId(scope: ReviewScope): string {
  return `${scope.runId}:${scope.agentRunId ?? 'branch'}`;
}

export function pendingKey(scope: ReviewScope): string {
  return `${PENDING_PREFIX}${scopeId(scope)}`;
}

// ------------------------------------------------------------------------------- pure changes

export interface NewComment {
  path: string;
  side: CommentSide;
  line: number;
  endLine: number;
  body: string;
  commit: string | null;
}

export function addComment(
  review: PendingReview,
  input: NewComment,
  id: string,
  now: Date,
): PendingReview {
  const body = input.body.trim();
  if (body.length === 0) return review;
  const line = Math.min(input.line, input.endLine);
  const endLine = Math.max(input.line, input.endLine);
  return {
    ...review,
    comments: [
      ...review.comments,
      { ...input, id, body, line, endLine, createdAt: now.toISOString() },
    ],
  };
}

/** An empty text deletes the comment, as clearing a GitHub comment does nothing useful. */
export function editComment(review: PendingReview, id: string, body: string): PendingReview {
  const text = body.trim();
  if (text.length === 0) return deleteComment(review, id);
  return {
    ...review,
    comments: review.comments.map((c) => (c.id === id ? { ...c, body: text } : c)),
  };
}

export function deleteComment(review: PendingReview, id: string): PendingReview {
  return { ...review, comments: review.comments.filter((c) => c.id !== id) };
}

export function setSummary(review: PendingReview, summary: string): PendingReview {
  return { ...review, summary };
}

export function isEmptyReview(review: PendingReview): boolean {
  return review.comments.length === 0 && review.summary.trim().length === 0;
}

// ------------------------------------------------------------------------------- storage

const isString = (v: unknown): v is string => typeof v === 'string';
const isLine = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

function toComment(v: unknown): PendingComment | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const { id, path, side, line, endLine, body, commit, createdAt } = o;
  if (!isString(id) || !isString(path) || !isString(body) || !isString(createdAt)) return null;
  if (side !== 'old' && side !== 'new') return null;
  if (!isLine(line) || !isLine(endLine) || endLine < line) return null;
  if (commit !== null && !isString(commit)) return null;
  if (body.trim().length === 0) return null;
  return { id, path, side, line, endLine, body, commit, createdAt };
}

/**
 * Reads a stored review. The text is data from an earlier visit: anything that isn't a review is
 * ignored, and comments that aren't comments are dropped, never shown or sent.
 */
export function parsePending(raw: string | null): PendingReview {
  if (raw === null) return EMPTY_REVIEW;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_REVIEW;
  }
  if (typeof data !== 'object' || data === null) return EMPTY_REVIEW;
  const o = data as Record<string, unknown>;
  const comments = Array.isArray(o['comments'])
    ? o['comments'].map(toComment).filter((c): c is PendingComment => c !== null)
    : [];
  const summary = isString(o['summary']) ? o['summary'] : '';
  return { comments, summary };
}

export function readPending(scope: ReviewScope): PendingReview {
  return parsePending(readRaw(pendingKey(scope)));
}

/** Stores the review; an empty one is removed, so nothing lingers after a submit. */
export function writePending(scope: ReviewScope, review: PendingReview): void {
  writeRaw(
    pendingKey(scope),
    isEmptyReview(review)
      ? null
      : JSON.stringify({ v: 1, comments: review.comments, summary: review.summary }),
  );
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** The pending review of one change or ticket branch, and its changes, kept in this browser. */
export function usePendingReview(scope: ReviewScope) {
  const key = pendingKey(scope);
  const raw = useStoredRaw(key);
  const review = useMemo(() => parsePending(raw), [raw]);
  const { runId, agentRunId } = scope;
  const update = useCallback(
    (fn: (r: PendingReview) => PendingReview) => {
      const s = { runId, agentRunId };
      writePending(s, fn(readPending(s)));
    },
    [runId, agentRunId],
  );
  return {
    review,
    add: useCallback(
      (input: NewComment) => update((r) => addComment(r, input, newId(), new Date())),
      [update],
    ),
    edit: useCallback(
      (id: string, body: string) => update((r) => editComment(r, id, body)),
      [update],
    ),
    remove: useCallback((id: string) => update((r) => deleteComment(r, id)), [update]),
    setSummary: useCallback((text: string) => update((r) => setSummary(r, text)), [update]),
    clear: useCallback(() => update(() => EMPTY_REVIEW), [update]),
  };
}
