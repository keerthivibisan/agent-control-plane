import { useEffect, useState } from 'react';
import { tokenize, type SyntaxLines } from './highlight';
import { languageFor } from './language';
import { fileLineCount, type DiffFile } from './parse';

/**
 * A file's syntax tokens for the diff viewer. The old and new sides are highlighted separately,
 * each as the lines of that side in the diff joined in order, so a line's tokens are at its
 * `oldIndex`/`newIndex`. Hunks are not contiguous in the real file, so a construct cut by a hunk
 * gap can be coloured as if it continued; that is a cosmetic limit of highlighting a diff.
 *
 * `status` says what the lines show: `plain` (no known language, a binary file, or too large),
 * `loading` (plain text until Shiki is ready), `highlighted`, or `failed` (plain text).
 */
export type SyntaxStatus = 'plain' | 'loading' | 'highlighted' | 'failed';

export interface FileSyntax {
  status: SyntaxStatus;
  old: SyntaxLines | null;
  new: SyntaxLines | null;
}

/** Files larger than this are left plain: highlighting them would hold up the page. */
export const MAX_HIGHLIGHT_LINES = 3000;

const PLAIN: FileSyntax = { status: 'plain', old: null, new: null };

function sides(file: DiffFile): { old: string; new: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.kind !== 'add') oldLines.push(l.text);
      if (l.kind !== 'del') newLines.push(l.text);
    }
  }
  return { old: oldLines.join('\n'), new: newLines.join('\n') };
}

export function useSyntax(file: DiffFile, enabled: boolean): FileSyntax {
  const lang = file.binary ? null : languageFor(file.path);
  const eligible =
    enabled && lang !== null && file.hunks.length > 0 && fileLineCount(file) <= MAX_HIGHLIGHT_LINES;
  const [state, setState] = useState<{ file: DiffFile; syntax: FileSyntax } | null>(null);

  useEffect(() => {
    if (!eligible || lang === null) return;
    let live = true;
    const code = sides(file);
    Promise.all([
      code.old.length > 0 ? tokenize(code.old, lang) : Promise.resolve([]),
      code.new.length > 0 ? tokenize(code.new, lang) : Promise.resolve([]),
    ]).then(
      ([oldTokens, newTokens]) => {
        if (live) {
          setState({ file, syntax: { status: 'highlighted', old: oldTokens, new: newTokens } });
        }
      },
      () => {
        if (live) setState({ file, syntax: { status: 'failed', old: null, new: null } });
      },
    );
    return () => {
      live = false;
    };
  }, [eligible, file, lang]);

  if (!eligible) return PLAIN;
  // A result for another file (the diff changed) does not count.
  if (state === null || state.file !== file) return { status: 'loading', old: null, new: null };
  return state.syntax;
}
