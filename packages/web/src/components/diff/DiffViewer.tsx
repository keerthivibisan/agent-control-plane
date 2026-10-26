import { useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import { Segmented } from '../Segmented';
import { DIFF_COPY as T } from './copy';
import { DiffFileList } from './DiffFileList';
import { DiffFileView } from './DiffFileView';
import { CollapseAllIcon, ExpandAllIcon } from './icons';
import { initiallyShown, missingPaths } from './layout';
import { fileLineCount, parseDiff, type DiffFile, type ParsedDiff } from './parse';
import { useSplitFits, useViewMode, type DiffViewMode } from './view-mode';
import './diff.css';

const VIEWS: readonly { value: DiffViewMode; label: string }[] = [
  { value: 'unified', label: T.views.unified },
  { value: 'split', label: T.views.split },
];

/**
 * The shared diff viewer (ADR-0025 §6): the files with their +/− counts (each jumps to its file),
 * unified or side-by-side lines with line numbers, word-level changes, syntax colors loaded on
 * demand, unchanged runs folded, per-file and all-files collapse, and the large-diff guard. The
 * diff text is the server's (`git diff -M`), read when shown and never stored (ADR-0009); when the
 * server cut it at its size limit (`truncated`), it says so, and `files` (the server's own list of
 * changed paths) names the files after the cut.
 */
export function DiffViewer({
  diff,
  truncated,
  files: listed,
  testId = 'diff-viewer',
}: {
  diff: string;
  truncated: boolean;
  /** Every changed path, from the server's file list, to name the files a cut diff misses. */
  files?: readonly string[] | undefined;
  testId?: string;
}) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const [chosen, setMode] = useViewMode();
  // Too narrow for side by side (a side panel, a phone): unified here, while the owner's saved
  // choice stays for wider places.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const fits = useSplitFits(root);
  const mode: DiffViewMode = fits ? chosen : 'unified';
  const views = fits
    ? VIEWS
    : VIEWS.map((v) => (v.value === 'split' ? { ...v, disabled: true, reason: T.noRoom } : v));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [shownState, setShownState] = useState<{ diff: ParsedDiff; ids: ReadonlySet<string> }>(
    () => ({ diff: parsed, ids: initiallyShown(parsed.files) }),
  );
  // A new diff (the change moved on) starts over with its own guard.
  const shown: ReadonlySet<string> =
    shownState.diff === parsed ? shownState.ids : initiallyShown(parsed.files);
  const headers = useRef(new Map<string, HTMLButtonElement>());

  const files = parsed.files;
  const missing = truncated ? missingPaths(files, listed) : [];
  const withLines = files.filter((f) => fileLineCount(f) > 0);
  const heldBack = withLines.filter((f) => !shown.has(f.id)).length;
  const allCollapsed = files.length > 0 && files.every((f) => collapsed.has(f.id));

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const show = (id: string) => setShownState({ diff: parsed, ids: new Set(shown).add(id) });
  const jump = (file: DiffFile) => {
    if (collapsed.has(file.id)) toggle(file.id);
    const header = headers.current.get(file.id);
    header?.scrollIntoView({ block: 'start' });
    header?.focus({ preventScroll: true });
  };

  if (files.length === 0) {
    return (
      <div className="acp-diff flex flex-col gap-2" data-testid={testId}>
        <p className="text-dim">{T.empty}</p>
        {truncated ? <TruncatedNote /> : null}
      </div>
    );
  }

  return (
    <div
      ref={setRoot}
      className="acp-diff flex flex-col gap-3"
      data-testid={testId}
      data-view={mode}
      data-narrow={fits ? undefined : ''}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-caption text-dim tabular-nums" data-testid="diff-summary">
          {T.summary(files.length, parsed.additions, parsed.deletions)}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label={T.viewLabel}
            hideLabel
            size="sm"
            options={views}
            value={mode}
            onChange={setMode}
          />
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(files.map((f) => f.id)))}
            data-testid="diff-collapse-all"
          >
            {allCollapsed ? <ExpandAllIcon /> : <CollapseAllIcon />}
            {allCollapsed ? T.expandAll : T.collapseAll}
          </Button>
        </div>
      </div>
      {truncated ? <TruncatedNote /> : null}
      {heldBack > 0 ? (
        <p
          role="note"
          className="rounded-control border border-line bg-sunken px-3 py-2 text-caption"
          data-testid="diff-large"
        >
          {T.large(files.length - heldBack, files.length)}
        </p>
      ) : null}
      {files.length > 1 ? <DiffFileList files={files} onJump={jump} /> : null}
      <div className="flex flex-col gap-3">
        {files.map((f) => (
          <DiffFileView
            key={f.id}
            file={f}
            mode={mode}
            open={!collapsed.has(f.id)}
            shown={shown.has(f.id)}
            onToggle={() => toggle(f.id)}
            onShow={() => show(f.id)}
            headerRef={(el) => {
              if (el === null) headers.current.delete(f.id);
              else headers.current.set(f.id, el);
            }}
          />
        ))}
      </div>
      {missing.length > 0 ? (
        <div
          role="note"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption"
          data-testid="diff-missing"
        >
          <p className="font-medium">{T.missingTitle(missing.length)}</p>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono break-all">
            {missing.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TruncatedNote() {
  return (
    <p
      role="note"
      className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption"
      data-testid="diff-truncated"
    >
      {T.truncated}
    </p>
  );
}
