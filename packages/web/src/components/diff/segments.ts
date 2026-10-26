import type { SyntaxToken } from './highlight';
import type { Range } from './word-diff';

/** A run of one line's text with one syntax style, inside or outside a word change. */
export interface Segment extends SyntaxToken {
  changed: boolean;
}

/**
 * Cuts a line's syntax tokens at the word-change boundaries, so a changed word can carry its
 * tint and its token color at once. Without tokens (plain text, still loading, or tokens that do
 * not spell the line) the line is one plain token.
 */
export function lineSegments(
  text: string,
  tokens: readonly SyntaxToken[] | undefined,
  ranges: readonly Range[] | undefined,
): Segment[] {
  const base: readonly SyntaxToken[] =
    tokens !== undefined && tokens.map((t) => t.content).join('') === text
      ? tokens
      : [{ content: text }];
  if (ranges === undefined || ranges.length === 0) {
    return base.filter((t) => t.content.length > 0).map((t) => ({ ...t, changed: false }));
  }
  const inChange = (pos: number) => ranges.some(([s, e]) => pos >= s && pos < e);
  const cuts = new Set<number>();
  for (const [s, e] of ranges) {
    cuts.add(s);
    cuts.add(e);
  }
  const out: Segment[] = [];
  let pos = 0;
  for (const t of base) {
    let start = 0;
    for (let i = 1; i <= t.content.length; i += 1) {
      if (i === t.content.length || cuts.has(pos + i)) {
        const piece = t.content.slice(start, i);
        if (piece.length > 0) out.push({ ...t, content: piece, changed: inChange(pos + start) });
        start = i;
      }
    }
    pos += t.content.length;
  }
  return out;
}
