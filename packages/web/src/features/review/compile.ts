import { COMPILED_HEADING } from './copy';
import type { PendingComment, PendingReview } from './pending-review';

/**
 * A pending review as the text of an existing owner decision (v0.3.0 D-A): the rework comment to
 * a helper, the request for changes to the lead, or an owner ticket comment. No new storage: the
 * line comments travel inside that text, one per line, then the overall comment:
 *
 *     Review comments:
 *     - src/api.ts:42 (new): cap the page size at 100.
 *     - src/api.ts:10–14 (old): this check is gone; keep it.
 *     Please also update the docs.
 *
 * A comment over several lines keeps its line breaks, the later lines indented under the first.
 * A comment written on an earlier commit says so, since its line numbers may have moved. The
 * text is never cut: when it is over the endpoint's limit the page says so and waits.
 */

/** "src/api.ts:42 (new)" or "src/api.ts:10–14 (old)". */
export function lineRef(c: Pick<PendingComment, 'path' | 'line' | 'endLine' | 'side'>): string {
  const lines = c.line === c.endLine ? `${c.line}` : `${c.line}–${c.endLine}`;
  return `${c.path}:${lines} (${c.side})`;
}

/**
 * The comments in reading order: by the file's place in the diff (`order`, else by path), then
 * by line, the old side first, then oldest first.
 */
export function sortComments(
  comments: readonly PendingComment[],
  order: (path: string) => number = () => 0,
): PendingComment[] {
  return [...comments].sort(
    (a, b) =>
      order(a.path) - order(b.path) ||
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.endLine - b.endLine ||
      (a.side === b.side ? 0 : a.side === 'old' ? -1 : 1) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

function commentLine(c: PendingComment, commit: string | null): string {
  const earlier =
    c.commit !== null && commit !== null && c.commit !== commit
      ? `, written on ${c.commit.slice(0, 7)}`
      : '';
  const [first = '', ...rest] = c.body.trim().split(/\r?\n/);
  const ref = lineRef(c).replace(/\)$/, `${earlier})`);
  return [`- ${ref}: ${first}`, ...rest.map((l) => (l.length > 0 ? `  ${l}` : ''))].join('\n');
}

/**
 * The text sent for a review; empty when there is nothing to send. `commit` is the change's
 * current commit, to mark comments written on an earlier one.
 */
export function compileReview(
  review: PendingReview,
  { commit = null, order }: { commit?: string | null; order?: (path: string) => number } = {},
): string {
  const parts: string[] = [];
  if (review.comments.length > 0) {
    parts.push(
      [
        COMPILED_HEADING,
        ...sortComments(review.comments, order).map((c) => commentLine(c, commit)),
      ].join('\n'),
    );
  }
  const summary = review.summary.trim();
  if (summary.length > 0) parts.push(summary);
  return parts.join('\n');
}

export interface CompiledReview {
  text: string;
  /** The length the server checks (it trims first). */
  length: number;
  max: number;
  empty: boolean;
  fits: boolean;
}

/** The text with its length against the endpoint's limit. */
export function compileFor(
  review: PendingReview,
  max: number,
  options: { commit?: string | null; order?: (path: string) => number } = {},
): CompiledReview {
  const text = compileReview(review, options).trim();
  return { text, length: text.length, max, empty: text.length === 0, fits: text.length <= max };
}
