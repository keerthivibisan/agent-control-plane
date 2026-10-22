import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { formatCount } from '../../lib/format';
import { Button } from '../Button';
import { DIFF_COPY as T } from './copy';
import { BinaryIcon, ChevronIcon, STATUS_ICON, STATUS_TONE, UnfoldIcon } from './icons';
import { hunkRows, splitRows, type UnifiedRow } from './layout';
import { fileLineCount, type DiffFile, type DiffHunk, type DiffLine } from './parse';
import { lineSegments } from './segments';
import { useSyntax, type FileSyntax } from './useSyntax';
import type { DiffViewMode } from './view-mode';
import { hunkWordChanges, type Range } from './word-diff';

/** One file of a diff: its header (the collapse toggle) and its lines, unified or side by side. */

/** Which side of the change a line is on: the old file (removed lines) or the new one. */
export type DiffSide = 'old' | 'new';

/**
 * Optional hooks into the lines for a page that comments on them (v0.3.0 D-A, the review page).
 * Without them the viewer draws exactly as before.
 */
export interface DiffLineSlots {
  /** A control drawn at the start of a line's code (the "+" comment button), per side. */
  gutter?: (line: DiffLine, side: DiffSide) => ReactNode;
  /** What is shown under a line for one side (its comments, an open comment box), or null. */
  below?: (line: DiffLine, side: DiffSide) => ReactNode;
  /** A line in a range being commented on: marked with an accent bar. */
  selected?: (line: DiffLine, side: DiffSide) => boolean;
  /** Lines that must stay visible: a fold that holds one opens by itself (a comment on it). */
  pinned?: (line: DiffLine) => boolean;
}

/** The sides a line is on: a removed line the old, an added line the new, unchanged both. */
function sidesOf(line: DiffLine): DiffSide[] {
  return line.kind === 'del' ? ['old'] : line.kind === 'add' ? ['new'] : ['old', 'new'];
}

/** In unified view one control serves a line: unchanged and added lines comment on the new side. */
function unifiedSide(line: DiffLine): DiffSide {
  return line.kind === 'del' ? 'old' : 'new';
}

const SELECTED = 'shadow-[inset_3px_0_0_var(--color-accent)]';

const ROW_BG: Record<DiffLine['kind'], string> = {
  add: 'bg-[var(--diff-add-bg)]',
  del: 'bg-[var(--diff-del-bg)]',
  context: '',
};
const MARK_BG: Record<DiffLine['kind'], string> = {
  add: 'bg-[var(--diff-add-word)]',
  del: 'bg-[var(--diff-del-word)]',
  context: '',
};
const SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '−', context: ' ' };
const SIGN_COLOR: Record<DiffLine['kind'], string> = {
  add: 'text-[var(--diff-add-sign)]',
  del: 'text-[var(--diff-del-sign)]',
  context: '',
};
const SR_KIND: Record<DiffLine['kind'], string | null> = {
  add: T.lineAdded,
  del: T.lineRemoved,
  context: null,
};

const NUM_CELL =
  'w-[1%] px-2 text-right align-top whitespace-nowrap tabular-nums select-none text-[var(--diff-number)]';
const CODE_CELL =
  'pr-3 align-top whitespace-pre-wrap [overflow-wrap:anywhere] text-[var(--shiki-foreground)]';

function tokensFor(syntax: FileSyntax, line: DiffLine) {
  if (line.kind === 'add') return line.newIndex === null ? undefined : syntax.new?.[line.newIndex];
  return line.oldIndex === null ? undefined : syntax.old?.[line.oldIndex];
}

/** A line's text with its syntax colors and word-change tints. */
function Code({
  line,
  syntax,
  ranges,
}: {
  line: DiffLine;
  syntax: FileSyntax;
  ranges: readonly Range[] | undefined;
}) {
  const segments = lineSegments(line.text, tokensFor(syntax, line), ranges);
  const sr = SR_KIND[line.kind];
  return (
    <div className="min-h-5">
      {sr !== null ? <span className="sr-only">{sr}: </span> : null}
      {segments.map((s, i) => (
        <span
          key={i}
          data-word-change={s.changed ? '' : undefined}
          className={s.changed ? `rounded-[2px] ${MARK_BG[line.kind]}` : undefined}
          style={{
            color: s.color,
            fontStyle: s.italic === true ? 'italic' : undefined,
            fontWeight: s.bold === true ? 600 : undefined,
          }}
        >
          {s.content}
        </span>
      ))}
      {line.noNewlineAtEnd ? (
        <span className="ml-2 font-sans text-micro text-[var(--diff-number)] italic">
          {T.noNewline}
        </span>
      ) : null}
    </div>
  );
}

function Sign({ kind }: { kind: DiffLine['kind'] }) {
  return (
    <td aria-hidden="true" className={`w-4 pl-1 align-top select-none ${SIGN_COLOR[kind]}`}>
      {SIGN[kind]}
    </td>
  );
}

function HunkHeader({ hunk, colSpan }: { hunk: DiffHunk; colSpan: number }) {
  const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);
  return (
    <tr className="bg-[var(--diff-hunk-bg)]" data-testid="diff-hunk">
      <td colSpan={colSpan} className="px-3 py-0.5 text-[var(--diff-number)]">
        @@ -{range(hunk.oldStart, hunk.oldLines)} +{range(hunk.newStart, hunk.newLines)} @@
        {hunk.section.length > 0 ? <span className="ml-2">{hunk.section}</span> : null}
      </td>
    </tr>
  );
}

function FoldRow({
  count,
  colSpan,
  onShow,
}: {
  count: number;
  colSpan: number;
  onShow: () => void;
}) {
  return (
    <tr className="bg-[var(--diff-hunk-bg)]/60">
      <td colSpan={colSpan} className="px-2 py-0.5">
        <button
          type="button"
          onClick={onShow}
          aria-label={T.hiddenLinesLabel(count)}
          data-testid="diff-expand"
          className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 font-sans text-caption text-accent hover:bg-hover"
        >
          <UnfoldIcon size={13} />
          {T.hiddenLines(count)}
        </button>
      </td>
    </tr>
  );
}

function UnifiedTable({
  file,
  syntax,
  expanded,
  onExpand,
  slots,
}: {
  file: DiffFile;
  syntax: FileSyntax;
  expanded: ReadonlySet<string>;
  onExpand: (id: string) => void;
  slots: DiffLineSlots | undefined;
}) {
  const words = useMemo(() => file.hunks.map(hunkWordChanges), [file]);
  return (
    <table className="w-full table-fixed border-collapse font-mono text-caption leading-5">
      <colgroup>
        <col className="w-11" />
        <col className="w-11" />
        <col className="w-4" />
        <col />
      </colgroup>
      <thead className="sr-only">
        <tr>
          <th scope="col">{T.oldNumber}</th>
          <th scope="col">{T.newNumber}</th>
          <th scope="col" />
          <th scope="col">{file.path}</th>
        </tr>
      </thead>
      <tbody>
        {file.hunks.map((hunk, h) => (
          <Fragment key={h}>
            <HunkHeader hunk={hunk} colSpan={4} />
            {hunkRows(hunk, h, expanded).map((row: UnifiedRow) =>
              row.type === 'fold' ? (
                <FoldRow
                  key={`f${row.id}`}
                  count={row.lines.length}
                  colSpan={4}
                  onShow={() => onExpand(row.id)}
                />
              ) : (
                <Fragment key={`${row.line.oldNo ?? ''}:${row.line.newNo ?? ''}`}>
                  <tr data-kind={row.line.kind} className={ROW_BG[row.line.kind]}>
                    <td className={NUM_CELL}>{row.line.oldNo ?? ''}</td>
                    <td className={NUM_CELL}>{row.line.newNo ?? ''}</td>
                    <Sign kind={row.line.kind} />
                    <td
                      className={`${CODE_CELL} ${slots ? 'group/line relative' : ''} ${
                        slots?.selected?.(row.line, unifiedSide(row.line)) === true ? SELECTED : ''
                      }`}
                    >
                      {slots?.gutter?.(row.line, unifiedSide(row.line))}
                      <Code line={row.line} syntax={syntax} ranges={words[h]?.get(row.line)} />
                    </td>
                  </tr>
                  <BelowRow
                    cells={[sidesOf(row.line).map((side) => slots?.below?.(row.line, side))]}
                    spans={[4]}
                  />
                </Fragment>
              ),
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The row under a line that holds what `below` returns (comments), one cell per side in split
 * view; nothing when every side is empty.
 */
function BelowRow({ cells, spans }: { cells: ReactNode[][]; spans: number[] }) {
  const has = (parts: ReactNode[]) => parts.some((p) => p !== null && p !== undefined);
  if (!cells.some(has)) return null;
  return (
    <tr data-below="">
      {cells.map((parts, i) => (
        <td
          key={i}
          colSpan={spans[i]}
          className={`bg-[var(--diff-bg)] p-0 font-sans text-body ${i > 0 ? 'border-l border-line' : ''}`}
        >
          {has(parts) ? (
            <div className="flex flex-col gap-2 p-2">
              {parts.map((p, j) =>
                p === null || p === undefined ? null : <Fragment key={j}>{p}</Fragment>,
              )}
            </div>
          ) : null}
        </td>
      ))}
    </tr>
  );
}

function SplitCells({
  line,
  syntax,
  ranges,
  side,
  slots,
}: {
  line: DiffLine | null;
  syntax: FileSyntax;
  ranges: readonly Range[] | undefined;
  side: DiffSide;
  slots: DiffLineSlots | undefined;
}): ReactNode {
  if (line === null) {
    return (
      <>
        <td className={`${NUM_CELL} bg-[var(--diff-empty-bg)]`} />
        <td className="bg-[var(--diff-empty-bg)]" />
        <td className="bg-[var(--diff-empty-bg)]" />
      </>
    );
  }
  const no = side === 'new' ? line.newNo : line.oldNo;
  return (
    <>
      <td className={`${NUM_CELL} ${ROW_BG[line.kind]}`}>{no ?? ''}</td>
      <Sign kind={line.kind} />
      <td
        className={`${CODE_CELL} ${ROW_BG[line.kind]} ${slots ? 'group/line relative' : ''} ${
          slots?.selected?.(line, side) === true ? SELECTED : ''
        }`}
      >
        {slots?.gutter?.(line, side)}
        <Code line={line} syntax={syntax} ranges={ranges} />
      </td>
    </>
  );
}

function SplitTable({
  file,
  syntax,
  expanded,
  onExpand,
  slots,
}: {
  file: DiffFile;
  syntax: FileSyntax;
  expanded: ReadonlySet<string>;
  onExpand: (id: string) => void;
  slots: DiffLineSlots | undefined;
}) {
  const words = useMemo(() => file.hunks.map(hunkWordChanges), [file]);
  return (
    <table className="w-full min-w-[36rem] table-fixed border-collapse font-mono text-caption leading-5">
      <colgroup>
        <col className="w-11" />
        <col className="w-4" />
        <col />
        <col className="w-11" />
        <col className="w-4" />
        <col />
      </colgroup>
      <thead className="sr-only">
        <tr>
          <th scope="col">{T.oldNumber}</th>
          <th scope="col" />
          <th scope="col">{T.oldColumn}</th>
          <th scope="col">{T.newNumber}</th>
          <th scope="col" />
          <th scope="col">{T.newColumn}</th>
        </tr>
      </thead>
      <tbody>
        {file.hunks.map((hunk, h) => (
          <Fragment key={h}>
            <HunkHeader hunk={hunk} colSpan={6} />
            {splitRows(hunkRows(hunk, h, expanded)).map((row, i) => {
              if (row.type === 'fold') {
                return (
                  <FoldRow
                    key={`f${row.id}`}
                    count={row.lines.length}
                    colSpan={6}
                    onShow={() => onExpand(row.id)}
                  />
                );
              }
              const context = row.left !== null && row.left === row.right;
              return (
                <Fragment key={i}>
                  <tr
                    data-kind={context ? 'context' : 'change'}
                    className="[&>td:nth-child(4)]:border-l [&>td:nth-child(4)]:border-line"
                  >
                    <SplitCells
                      line={row.left}
                      syntax={syntax}
                      side="old"
                      slots={slots}
                      ranges={context || row.left === null ? undefined : words[h]?.get(row.left)}
                    />
                    <SplitCells
                      line={row.right}
                      syntax={syntax}
                      side="new"
                      slots={slots}
                      ranges={context || row.right === null ? undefined : words[h]?.get(row.right)}
                    />
                  </tr>
                  <BelowRow
                    cells={[
                      [row.left === null ? null : slots?.below?.(row.left, 'old')],
                      [row.right === null ? null : slots?.below?.(row.right, 'new')],
                    ]}
                    spans={[3, 3]}
                  />
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function Counts({ file }: { file: DiffFile }) {
  if (file.binary) return null;
  return (
    <span className="flex shrink-0 gap-2 font-mono text-caption tabular-nums">
      <span className="text-success" title={T.added(file.additions)}>
        +{formatCount(file.additions)}
        <span className="sr-only"> {T.added(file.additions)}</span>
      </span>
      <span className="text-danger" title={T.removed(file.deletions)}>
        −{formatCount(file.deletions)}
        <span className="sr-only"> {T.removed(file.deletions)}</span>
      </span>
    </span>
  );
}

function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <span
      className={`rounded-[5px] border px-1.5 text-micro font-medium ${
        tone === 'warning'
          ? 'border-warning/30 bg-warning-soft text-warning'
          : 'border-line bg-panel text-dim'
      }`}
    >
      {children}
    </span>
  );
}

/** "a → b" for a rename or copy, else the path, with the folder dimmed. */
export function FilePath({ file }: { file: DiffFile }) {
  const moved =
    (file.status === 'renamed' || file.status === 'copied') &&
    file.oldPath !== null &&
    file.oldPath !== file.path;
  const slash = file.path.lastIndexOf('/');
  return (
    <span className="min-w-0 font-mono text-caption [overflow-wrap:anywhere]">
      {moved ? <span className="text-dim">{file.oldPath} → </span> : null}
      {slash >= 0 ? <span className="text-dim">{file.path.slice(0, slash + 1)}</span> : null}
      <span className="font-medium text-ink">{file.path.slice(slash + 1)}</span>
    </span>
  );
}

/** The folds to open: the ones the owner opened, plus any that hold a pinned line. */
function withPinned(
  file: DiffFile,
  expanded: ReadonlySet<string>,
  pinned: ((line: DiffLine) => boolean) | undefined,
): ReadonlySet<string> {
  if (pinned === undefined) return expanded;
  let out: Set<string> | null = null;
  file.hunks.forEach((hunk, h) => {
    for (const row of hunkRows(hunk, h, expanded)) {
      if (row.type === 'fold' && row.lines.some(pinned)) (out ??= new Set(expanded)).add(row.id);
    }
  });
  return out ?? expanded;
}

export function DiffFileView({
  file,
  mode,
  open,
  shown,
  onToggle,
  onShow,
  headerRef,
  slots,
  headerEnd,
  stickyHeader = false,
}: {
  file: DiffFile;
  mode: DiffViewMode;
  open: boolean;
  /** False while the large-diff guard holds the file back. */
  shown: boolean;
  onToggle: () => void;
  onShow: () => void;
  headerRef: (el: HTMLButtonElement | null) => void;
  /** D-A: hooks for commenting on lines; without them the lines are read-only as before. */
  slots?: DiffLineSlots | undefined;
  /** D-A: extra controls at the end of the header row (the review page's Viewed box). */
  headerEnd?: ReactNode;
  /**
   * D-A: the header sticks under the page's own sticky bars while the file scrolls by, at
   * `--diff-sticky-top` (set by the page).
   */
  stickyHeader?: boolean;
}) {
  const [opened, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const expanded = withPinned(file, opened, slots?.pinned);
  const syntax = useSyntax(file, open && shown);
  const Icon = STATUS_ICON[file.status];
  const bodyId = `diff-${file.id}-body`;
  const lineCount = fileLineCount(file);
  const expand = (id: string) => setExpanded((s) => new Set(s).add(id));

  let body: ReactNode;
  if (file.binary) {
    body = (
      <p className="flex items-center gap-2 px-3 py-2 text-caption text-dim">
        <BinaryIcon className="shrink-0" />
        {T.binary}
      </p>
    );
  } else if (file.hunks.length === 0) {
    body = (
      <p className="px-3 py-2 text-caption text-dim">
        {file.oldMode !== null && file.newMode !== null && file.oldMode !== file.newMode
          ? T.modeChanged(file.oldMode, file.newMode)
          : file.cut
            ? T.cutFile
            : T.noLineChanges}
      </p>
    );
  } else if (!shown) {
    body = (
      <div
        className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-caption text-dim"
        data-testid="diff-held-back"
      >
        <span>{T.heldBack(lineCount)}</span>
        <Button size="sm" onClick={onShow}>
          {T.showFile}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        {mode === 'split' ? (
          <SplitTable
            file={file}
            syntax={syntax}
            expanded={expanded}
            onExpand={expand}
            slots={slots}
          />
        ) : (
          <UnifiedTable
            file={file}
            syntax={syntax}
            expanded={expanded}
            onExpand={expand}
            slots={slots}
          />
        )}
        {file.cut ? (
          <p
            role="note"
            className="border-t border-warning/30 bg-warning-soft px-3 py-1.5 text-caption"
          >
            {T.cutFile}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section
      // `overflow-clip` (not hidden) rounds the corners without making the box a scroll container,
      // so a sticky header (D-A) sticks to the page.
      className="scroll-mt-20 overflow-clip rounded-card border border-line bg-[var(--diff-bg)]"
      data-testid="diff-file"
      data-path={file.path}
      data-status={file.status}
      data-open={open}
      data-shown={shown}
      data-syntax={syntax.status}
      id={`diff-${file.id}`}
    >
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 bg-subtle px-2 py-1.5 ${
          open ? 'border-b border-line' : ''
        } ${stickyHeader ? 'sticky top-[var(--diff-sticky-top,0px)] z-[5]' : ''}`}
        data-testid="diff-file-header"
      >
        <button
          ref={headerRef}
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          data-testid="diff-file-toggle"
          className="flex min-w-[min(14rem,100%)] flex-1 items-center gap-1.5 rounded-control px-1 py-0.5 text-left hover:bg-hover"
        >
          <ChevronIcon
            size={14}
            className={`shrink-0 text-dim transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
          <Icon className={`shrink-0 ${STATUS_TONE[file.status]}`} />
          <FilePath file={file} />
          <span className="shrink-0 text-caption text-dim">· {T.status[file.status]}</span>
        </button>
        <span className="ml-auto flex items-center gap-2">
          {file.similarity !== null && file.status !== 'modified' ? (
            <span className="text-caption text-dim">{T.similarity(file.similarity)}</span>
          ) : null}
          {file.binary ? <Tag>{T.binaryTag}</Tag> : null}
          {file.cut ? <Tag tone="warning">{T.cutTag}</Tag> : null}
          <Counts file={file} />
          {headerEnd}
        </span>
      </div>
      <div id={bodyId} hidden={!open} className="overflow-x-auto">
        {open ? body : null}
      </div>
    </section>
  );
}
