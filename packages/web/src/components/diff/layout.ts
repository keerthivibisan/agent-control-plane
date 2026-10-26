import { fileLineCount, type DiffFile, type DiffHunk, type DiffLine } from './parse';

/**
 * How a parsed diff is laid out: which unchanged lines fold away, how lines pair up side by side,
 * and which files the large-diff guard holds back. Pure, so the rules are tested without a DOM.
 */

/** Unchanged lines kept next to a change; longer runs fold behind "Show N hidden lines". */
export const CONTEXT_LINES = 3;
/** A fold hides at least this many lines; hiding one line behind a button saves nothing. */
export const MIN_FOLD = 2;

/** The large-diff guard (ADR-0025 §6). Numbers are diff lines, context included. */
export const LARGE_DIFF = {
  /** A file with more lines than this waits for "Show this file". */
  fileLines: 400,
  /** Files are drawn in order until this many lines; the rest wait for "Show this file". */
  totalLines: 1500,
} as const;

export type UnifiedRow =
  { type: 'line'; line: DiffLine } | { type: 'fold'; id: string; lines: DiffLine[] };

export type SplitRow =
  | { type: 'pair'; left: DiffLine | null; right: DiffLine | null }
  | { type: 'fold'; id: string; lines: DiffLine[] };

/** A fold's id: the hunk and the index of its first hidden line, stable across renders. */
export function foldId(hunkIndex: number, firstLine: number): string {
  return `${hunkIndex}:${firstLine}`;
}

/**
 * A hunk's rows with long unchanged runs folded. A run before the first change keeps its last
 * CONTEXT_LINES, a run after the last change its first, and a run between changes both ends.
 * Folds whose id is in `expanded` are shown in full.
 */
export function hunkRows(
  hunk: DiffHunk,
  hunkIndex: number,
  expanded: ReadonlySet<string>,
  context: number = CONTEXT_LINES,
): UnifiedRow[] {
  const lines = hunk.lines;
  const hasChange = lines.some((l) => l.kind !== 'context');
  const rows: UnifiedRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as DiffLine;
    if (line.kind !== 'context' || !hasChange) {
      rows.push({ type: 'line', line });
      i += 1;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]?.kind === 'context') end += 1;
    const keepBefore = i === 0 ? 0 : context; // after a change
    const keepAfter = end === lines.length ? 0 : context; // before a change
    const hideFrom = i + keepBefore;
    const hideTo = end - keepAfter;
    const id = foldId(hunkIndex, hideFrom);
    if (hideTo - hideFrom >= MIN_FOLD && !expanded.has(id)) {
      for (let k = i; k < hideFrom; k += 1) rows.push({ type: 'line', line: lines[k] as DiffLine });
      rows.push({ type: 'fold', id, lines: lines.slice(hideFrom, hideTo) });
      for (let k = hideTo; k < end; k += 1) rows.push({ type: 'line', line: lines[k] as DiffLine });
    } else {
      for (let k = i; k < end; k += 1) rows.push({ type: 'line', line: lines[k] as DiffLine });
    }
    i = end;
  }
  return rows;
}

/**
 * The same rows side by side: unchanged lines on both sides, and each block of removed lines
 * beside the added lines that follow it, in order, with blank cells where one side is longer.
 */
export function splitRows(rows: readonly UnifiedRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] as UnifiedRow;
    if (row.type === 'fold') {
      out.push(row);
      i += 1;
      continue;
    }
    if (row.line.kind === 'context') {
      out.push({ type: 'pair', left: row.line, right: row.line });
      i += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < rows.length) {
      const r = rows[i] as UnifiedRow;
      if (r.type !== 'line' || r.line.kind !== 'del' || adds.length > 0) break;
      dels.push(r.line);
      i += 1;
    }
    while (i < rows.length) {
      const r = rows[i] as UnifiedRow;
      if (r.type !== 'line' || r.line.kind !== 'add') break;
      adds.push(r.line);
      i += 1;
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) {
      out.push({ type: 'pair', left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return out;
}

/**
 * The files drawn at first. Files are taken in order while the running total stays within
 * `totalLines`; a file over `fileLines` is held back on its own without using the budget, and
 * once the budget is spent every later file is held back. Files without lines (binary, a rename
 * only) are always drawn: they cost nothing.
 */
export function initiallyShown(
  files: readonly DiffFile[],
  limits: { fileLines: number; totalLines: number } = LARGE_DIFF,
): Set<string> {
  const shown = new Set<string>();
  let used = 0;
  let spent = false;
  for (const f of files) {
    const n = fileLineCount(f);
    if (n === 0) {
      shown.add(f.id);
      continue;
    }
    if (spent || n > limits.fileLines) continue;
    if (used + n > limits.totalLines) {
      spent = true;
      continue;
    }
    used += n;
    shown.add(f.id);
  }
  return shown;
}

/**
 * Paths the server listed as changed that the diff text does not include: with a cut diff, the
 * files after the cut. Renamed files count under either name.
 */
export function missingPaths(
  files: readonly DiffFile[],
  listed: readonly string[] | undefined,
): string[] {
  if (listed === undefined) return [];
  const present = new Set<string>();
  for (const f of files) {
    if (f.oldPath !== null) present.add(f.oldPath);
    if (f.newPath !== null) present.add(f.newPath);
  }
  return listed.filter((p) => !present.has(p));
}
