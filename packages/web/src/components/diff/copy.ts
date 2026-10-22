import { formatCount } from '../../lib/format';
import type { DiffFileStatus } from './parse';

/**
 * The diff viewer's words. They live with the viewer (it is a shared component used by several
 * features) rather than in a feature's section of `lib/copy.ts`.
 */
const lines = (n: number) => `${formatCount(n)} ${n === 1 ? 'line' : 'lines'}`;
const files = (n: number) => `${formatCount(n)} ${n === 1 ? 'file' : 'files'}`;

export const DIFF_COPY = {
  empty: 'No line-by-line changes to show.',
  summary: (fileCount: number, added: number, removed: number) =>
    `${files(fileCount)} · ${formatCount(added)} added · ${formatCount(removed)} removed`,
  filesNav: 'Files in this diff: go to a file',
  viewLabel: 'Show the changes',
  views: { unified: 'Unified', split: 'Side by side' },
  collapseAll: 'Collapse all',
  expandAll: 'Expand all',
  status: {
    added: 'New',
    deleted: 'Deleted',
    modified: 'Changed',
    renamed: 'Renamed',
    copied: 'Copied',
  } satisfies Record<DiffFileStatus, string>,
  binary: 'Binary file: no line-by-line changes to show.',
  binaryTag: 'Binary',
  similarity: (n: number) => `${formatCount(n)}% similar`,
  modeChanged: (from: string, to: string) => `File mode ${from} → ${to}`,
  noLineChanges: 'No line changes (only the name or mode changed).',
  added: (n: number) => `${lines(n)} added`,
  removed: (n: number) => `${lines(n)} removed`,
  hiddenLines: (n: number) => `Show ${formatCount(n)} hidden ${n === 1 ? 'line' : 'lines'}`,
  hiddenLinesLabel: (n: number) => `Show ${lines(n)} of unchanged code hidden here`,
  lineAdded: 'Added line',
  lineRemoved: 'Removed line',
  noNewline: 'No newline at end of file',
  oldColumn: 'Before',
  newColumn: 'After',
  oldNumber: 'Line before',
  newNumber: 'Line after',
  large: (shown: number, total: number) =>
    `This diff is large: ${formatCount(shown)} of ${files(total)} are shown. Use “Show this file” for the others.`,
  heldBack: (n: number) => `${lines(n)} not shown, to keep the page fast.`,
  showFile: 'Show this file',
  truncated: 'The server cut this diff at its size limit: only its start is shown.',
  cutFile: 'The diff stops here: the server cut it at its size limit.',
  cutTag: 'Cut',
  missingTitle: (n: number) => `${files(n)} not in this diff (after the cut)`,
} as const;
