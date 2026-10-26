import type { DiffHunk, DiffLine } from './parse';

/**
 * Word-level changes inside a changed line pair: which characters of the removed line went and
 * which of the added line came. A pair is the i-th removed and the i-th added line of one change
 * block (removed lines followed by added lines). Lines that share too little get no word marks:
 * the whole line changed, and marking every word would only add noise.
 */

/** A half-open character range [start, end). */
export type Range = readonly [number, number];

export interface WordChanges {
  old: Range[];
  new: Range[];
}

/** Above this many token pairs the comparison is skipped (the LCS table is n·m). */
const MAX_CELLS = 40_000;
/** At least this share of the longer line must be unchanged for word marks to help. */
const MIN_SHARED = 0.3;

/** Words, runs of spaces, and single other characters (punctuation, operators). */
export function tokenizeWords(s: string): string[] {
  return s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

function toRanges(tokens: readonly string[], changed: readonly boolean[]): Range[] {
  const out: [number, number][] = [];
  let pos = 0;
  tokens.forEach((t, i) => {
    const end = pos + t.length;
    if (changed[i] === true) {
      const last = out[out.length - 1];
      if (last !== undefined && last[1] === pos) last[1] = end;
      else out.push([pos, end]);
    }
    pos = end;
  });
  return out;
}

/** The changed ranges of a removed and an added line, or null when word marks would not help. */
export function wordChanges(oldText: string, newText: string): WordChanges | null {
  if (oldText === newText) return null;
  const a = tokenizeWords(oldText);
  const b = tokenizeWords(newText);
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) return null;

  // Longest common subsequence of tokens, filled from the end so the walk below goes forward.
  const w = b.length + 1;
  const table = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * w + j] =
        a[i] === b[j]
          ? (table[(i + 1) * w + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * w + j] ?? 0, table[i * w + j + 1] ?? 0);
    }
  }
  const keptA = new Array<boolean>(a.length).fill(false);
  const keptB = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keptA[i] = true;
      keptB[j] = true;
      // Spaces alone do not make two lines alike.
      if (!/^\s+$/.test(a[i] ?? '')) shared += (a[i] ?? '').length;
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * w + j] ?? 0) >= (table[i * w + j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  const longest = Math.max(oldText.trim().length, newText.trim().length);
  if (longest === 0 || shared / longest < MIN_SHARED) return null;
  return {
    old: toRanges(
      a,
      keptA.map((k) => !k),
    ),
    new: toRanges(
      b,
      keptB.map((k) => !k),
    ),
  };
}

/**
 * The word changes of every paired line in a hunk, keyed by line. Each block of removed lines
 * directly followed by added lines pairs them in order; the extra lines of the longer side have
 * no partner and keep the whole-line colour only.
 */
export function hunkWordChanges(hunk: DiffHunk): Map<DiffLine, Range[]> {
  const out = new Map<DiffLine, Range[]>();
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.kind !== 'del') {
      i += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    while (lines[i]?.kind === 'del') dels.push(lines[i++] as DiffLine);
    const adds: DiffLine[] = [];
    while (lines[i]?.kind === 'add') adds.push(lines[i++] as DiffLine);
    for (let k = 0; k < Math.min(dels.length, adds.length); k += 1) {
      const d = dels[k] as DiffLine;
      const p = adds[k] as DiffLine;
      const changes = wordChanges(d.text, p.text);
      if (changes === null) continue;
      out.set(d, changes.old);
      out.set(p, changes.new);
    }
  }
  return out;
}
