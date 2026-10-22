import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  DIFF_COPY,
  DiffFileView,
  initiallyShown,
  missingPaths,
  parseDiff,
  useSplitFits,
  useViewMode,
  VIEW_MODE_KEY,
  type DiffFile,
  type DiffLine,
  type DiffLineSlots,
  type DiffSide,
  type DiffViewMode,
} from '../../components/diff';
import '../../components/diff/diff.css';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { Segmented } from '../../components/Segmented';
import type { ApiError } from '../../lib/api';
import type { ReviewChoice, ReviewChoiceId } from './choices';
import { REVIEW_PAGE_COPY as T } from './copy';
import { buildFileTree, treeOrder } from './file-tree';
import { FileTree } from './FileTree';
import { AddCommentIcon, HideTreeIcon, KeyboardIcon, ShowTreeIcon } from './icons';
import { shortcutFor } from './keyboard';
import { CommentCard, CommentForm, readableRef } from './LineComments';
import {
  usePendingReview,
  type CommentSide,
  type PendingComment,
  type ReviewScope,
} from './pending-review';
import { ReviewPopover } from './ReviewPopover';
import { useStickyOffsets } from './sticky';
import { useViewed } from './viewed';

/**
 * GitHub's "Files changed" (v0.3.0 D-A; the ticket's Files changed tab since C-D): a sticky bar
 * (the totals, Unified / Side by side, how many files are viewed, Collapse all, the keys, Review
 * changes or "Read only"), the file tree on the left, and on the right each file as a box
 * with a sticky header (path, +/−, Viewed) over its lines. A "+" on a line opens a comment box
 * under it (shift-click a second "+" for a range); comments join the pending review, kept in
 * this browser until Review changes sends them through an existing owner decision. `readOnly`
 * (merged or closed work, ADR-0026 §5) keeps the files, the tree and Viewed, and drops every
 * comment and review control. The diff text is the server's, read when shown and never stored
 * (ADR-0009).
 */

const VIEWS: readonly { value: DiffViewMode; label: string }[] = [
  { value: 'unified', label: DIFF_COPY.views.unified },
  { value: 'split', label: DIFF_COPY.views.split },
];

/** A comment being written: on `endLine` (from `line`), with the side and the text so far. */
interface Draft {
  path: string;
  side: CommentSide;
  /** Where the range started: the line first clicked. */
  anchor: number;
  line: number;
  endLine: number;
  text: string;
}

/** The line number on one side; null where the line isn't on that side. */
function lineNo(line: DiffLine, side: DiffSide): number | null {
  return side === 'old'
    ? line.kind === 'add'
      ? null
      : line.oldNo
    : line.kind === 'del'
      ? null
      : line.newNo;
}

const lineKey = (side: DiffSide, no: number) => `${side}:${no}`;

/** Every `side:line` a comment can sit on in a file. */
function anchorsOf(file: DiffFile): Set<string> {
  const out = new Set<string>();
  for (const h of file.hunks) {
    for (const l of h.lines) {
      for (const side of ['old', 'new'] as const) {
        const no = lineNo(l, side);
        if (no !== null) out.add(lineKey(side, no));
      }
    }
  }
  return out;
}

/** The first changed line's "+": a file's tab stop until another line takes focus. */
function firstKey(file: DiffFile): string | null {
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.kind === 'del' && l.oldNo !== null) return lineKey('old', l.oldNo);
      if (l.kind === 'add' && l.newNo !== null) return lineKey('new', l.newNo);
    }
  }
  const first = file.hunks[0]?.lines[0];
  return first !== undefined && first.newNo !== null ? lineKey('new', first.newNo) : null;
}

/** Whether the owner ever chose a view in this browser; without a choice this page is split. */
function hasStoredViewMode(): boolean {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) !== null;
  } catch {
    return false;
  }
}

function wideAtStart(): boolean {
  try {
    return window.matchMedia('(min-width: 1024px)').matches;
  } catch {
    return true;
  }
}

export function FilesChanged({
  scope,
  commit,
  diff,
  truncated,
  listed,
  choices,
  send,
  sending,
  sendError,
  ticketHref,
  readOnly = false,
}: {
  scope: ReviewScope;
  /** The change's (or branch tip's) commit: viewed files and comments are kept per commit. */
  commit: string | null;
  diff: string;
  truncated: boolean;
  /** The server's list of changed paths, to name the files a cut diff misses. */
  listed: readonly string[];
  choices: readonly ReviewChoice[];
  send: (choice: ReviewChoiceId, text: string) => Promise<boolean>;
  sending: boolean;
  sendError: ApiError | null;
  /** Where "Open Comments" goes after a review is sent. */
  ticketHref: string;
  /** Merged or closed: files, tree and Viewed only; no comments, no Review changes. */
  readOnly?: boolean;
}) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const ordered = useMemo(() => treeOrder(buildFileTree(parsed.files)), [parsed]);
  const order = useMemo(() => {
    const at = new Map(ordered.map((f, i) => [f.path, i]));
    return (path: string) => at.get(path) ?? ordered.length;
  }, [ordered]);
  const { viewed, toggle: toggleViewed } = useViewed(scope, commit);
  const pending = usePendingReview(scope);
  // Read only: pending comments kept for this change stay in the browser, unseen and unsent.
  const review = readOnly ? { comments: [], summary: '' } : pending.review;

  // Unified or side by side: the owner's saved choice (shared with every diff in the app), side
  // by side until they choose; unified where there isn't room.
  const [filesEl, setFilesEl] = useState<HTMLDivElement | null>(null);
  const fits = useSplitFits(filesEl);
  const [saved, setMode] = useViewMode();
  const [choseHere, setChoseHere] = useState(false);
  const chosen: DiffViewMode = choseHere || hasStoredViewMode() ? saved : 'split';
  const mode: DiffViewMode = fits ? chosen : 'unified';
  const views = fits
    ? VIEWS
    : VIEWS.map((v) =>
        v.value === 'split' ? { ...v, disabled: true, reason: DIFF_COPY.noRoom } : v,
      );

  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [shownExtra, setShownExtra] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [active, setActive] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [current, setCurrent] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(wideAtStart);
  const [sent, setSent] = useState<ReviewChoiceId | null>(null);
  const { rootRef, barRef, style } = useStickyOffsets();

  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const headers = useRef(new Map<string, HTMLButtonElement>());
  const lineButtons = useRef(new Map<string, HTMLButtonElement>());

  const byPath = useMemo(() => {
    const m = new Map<string, PendingComment[]>();
    for (const c of review.comments) m.set(c.path, [...(m.get(c.path) ?? []), c]);
    return m;
  }, [review.comments]);
  const counts = useMemo(
    () => new Map([...byPath.entries()].map(([p, list]) => [p, list.length])),
    [byPath],
  );
  // Comments that can't be shown under a line: their file or line is no longer in this diff.
  const offDiff = useMemo(() => {
    const files = new Map(parsed.files.map((f) => [f.path, anchorsOf(f)]));
    return review.comments.filter((c) => {
      const anchors = files.get(c.path);
      return anchors === undefined || !anchors.has(lineKey(c.side, c.endLine));
    });
  }, [parsed, review.comments]);

  const initial = useMemo(() => initiallyShown(parsed.files), [parsed]);
  const isShown = (f: DiffFile) => initial.has(f.id) || shownExtra.has(f.id) || byPath.has(f.path);
  const isOpen = (f: DiffFile) => overrides.get(f.id) ?? !viewed.has(f.path);
  const setOpen = (f: DiffFile, open: boolean | null) =>
    setOverrides((m) => {
      const next = new Map(m);
      if (open === null) next.delete(f.id);
      else next.set(f.id, open);
      return next;
    });
  const allClosed = ordered.length > 0 && ordered.every((f) => !isOpen(f));
  const viewedCount = ordered.filter((f) => viewed.has(f.path)).length;
  const heldBack = ordered.filter((f) => !isShown(f)).length;
  const missing = truncated ? missingPaths(parsed.files, listed) : [];
  const commentMax = Math.min(...choices.map((c) => c.max));

  /** Viewed collapses the file; not viewed opens it again (GitHub's checkbox). */
  const markViewed = (f: DiffFile) => {
    toggleViewed(f.path);
    setOpen(f, null);
  };

  const jump = useCallback((f: DiffFile, expand: boolean) => {
    if (expand) setOverrides((m) => new Map(m).set(f.id, true));
    setCurrent(f.path);
    wrappers.current.get(f.path)?.scrollIntoView?.({ block: 'start' });
    headers.current.get(f.path)?.focus({ preventScroll: true });
  }, []);

  const focusLine = (path: string, side: CommentSide, no: number) => {
    // After the box closes and the row redraws.
    window.setTimeout(() => lineButtons.current.get(`${path}\n${side}\n${no}`)?.focus(), 0);
  };

  const openDraft = (path: string, side: CommentSide, no: number, range: boolean) => {
    setSent(null);
    setEditing(null);
    setDraft((d) =>
      range && d !== null && d.path === path && d.side === side
        ? { ...d, line: Math.min(d.anchor, no), endLine: Math.max(d.anchor, no) }
        : { path, side, anchor: no, line: no, endLine: no, text: d?.text ?? '' },
    );
  };

  const onLineKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step =
      e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowUp'
          ? -1
          : e.key === 'Home'
            ? -Infinity
            : e.key === 'End'
              ? Infinity
              : 0;
    if (step === 0) return;
    const wrapper = e.currentTarget.closest('[data-review-file]');
    if (wrapper === null) return;
    const all = [...wrapper.querySelectorAll<HTMLButtonElement>('[data-line-button]')];
    const i = all.indexOf(e.currentTarget);
    const to = Number.isFinite(step) ? i + step : step < 0 ? 0 : all.length - 1;
    const next = all[Math.max(0, Math.min(all.length - 1, to))];
    if (next === undefined || next === e.currentTarget) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView?.({ block: 'nearest' });
  };

  const slotsFor = (f: DiffFile): DiffLineSlots | undefined => {
    if (readOnly) return undefined;
    const list = byPath.get(f.path) ?? [];
    const activeKey = active.get(`${mode}:${f.id}`) ?? firstKey(f);
    const draftHere = draft !== null && draft.path === f.path ? draft : null;
    return {
      gutter: (line, side) => {
        const no = lineNo(line, side);
        if (no === null) return null;
        const key = lineKey(side, no);
        return (
          <button
            type="button"
            ref={(el) => {
              const k = `${f.path}\n${side}\n${no}`;
              if (el === null) lineButtons.current.delete(k);
              else lineButtons.current.set(k, el);
            }}
            tabIndex={key === activeKey ? 0 : -1}
            aria-label={T.addComment(`${f.path} ${readableRef({ line: no, endLine: no, side })}`)}
            title={T.formHint}
            data-line-button=""
            data-side={side}
            data-line={no}
            onFocus={() => setActive((m) => new Map(m).set(`${mode}:${f.id}`, key))}
            onKeyDown={onLineKey}
            onClick={(e) => openDraft(f.path, side, no, e.shiftKey)}
            className="absolute top-px -left-[1.125rem] z-[1] inline-flex size-[1.125rem] items-center justify-center rounded-[4px] bg-accent-fill text-accent-fill-ink opacity-0 shadow-card transition-opacity duration-100 group-hover/line:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
          >
            <AddCommentIcon size={12} strokeWidth={2.5} />
          </button>
        );
      },
      below: (line, side) => {
        const no = lineNo(line, side);
        if (no === null) return null;
        const here = list.filter((c) => c.side === side && c.endLine === no);
        const form =
          draftHere !== null && draftHere.side === side && draftHere.endLine === no ? (
            <CommentForm
              key={`${draftHere.line}-${draftHere.endLine}`}
              label={`${f.path} ${readableRef(draftHere)}`}
              initial={draftHere.text}
              submitLabel={T.add}
              max={commentMax}
              onTextChange={(text) => setDraft((d) => (d === null ? d : { ...d, text }))}
              onCancel={() => {
                setDraft(null);
                focusLine(f.path, side, no);
              }}
              onSubmit={(body) => {
                pending.add({
                  path: f.path,
                  side,
                  line: draftHere.line,
                  endLine: draftHere.endLine,
                  body,
                  commit,
                });
                setDraft(null);
                focusLine(f.path, side, no);
              }}
            />
          ) : null;
        if (here.length === 0 && form === null) return null;
        return (
          <>
            {here.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                commit={commit}
                max={commentMax}
                editing={editing === c.id}
                onEdit={() => setEditing(c.id)}
                onCancelEdit={() => setEditing(null)}
                onSave={(body) => {
                  pending.edit(c.id, body);
                  setEditing(null);
                }}
                onDelete={() => {
                  pending.remove(c.id);
                  focusLine(f.path, side, no);
                }}
              />
            ))}
            {form}
          </>
        );
      },
      selected: (line, side) => {
        if (draftHere === null || draftHere.side !== side) return false;
        const no = lineNo(line, side);
        return no !== null && no >= draftHere.line && no <= draftHere.endLine;
      },
      pinned: (line) =>
        list.some((c) => lineNo(line, c.side) === c.endLine) ||
        (draftHere !== null && lineNo(line, draftHere.side) === draftHere.endLine),
    };
  };

  // The keys (keyboard.ts). The file in play: the one holding focus, else the last one jumped
  // to, else the one at the top of the window.
  const fileInPlay = useCallback((): number => {
    const holder = document.activeElement?.closest<HTMLElement>('[data-review-file]');
    const path = holder?.dataset['reviewFile'] ?? current;
    if (path !== null && path !== undefined) return ordered.findIndex((f) => f.path === path);
    const top = barRef.current?.getBoundingClientRect().bottom ?? 0;
    return ordered.findIndex(
      (f) => (wrappers.current.get(f.path)?.getBoundingClientRect().bottom ?? 0) > top + 1,
    );
  }, [current, ordered, barRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = shortcutFor(e);
      if (shortcut === null || ordered.length === 0) return;
      const at = fileInPlay();
      if (shortcut === 'next' || shortcut === 'previous') {
        e.preventDefault();
        const from =
          document.activeElement?.closest('[data-review-file]') !== null || current !== null
            ? at
            : -1;
        const to =
          shortcut === 'next' ? Math.min(from + 1, ordered.length - 1) : Math.max(from - 1, 0);
        const f = ordered[to];
        if (f !== undefined) jump(f, false);
        return;
      }
      const f = ordered[Math.max(at, 0)];
      if (f === undefined) return;
      if (shortcut === 'comment' && readOnly) return;
      if (shortcut === 'viewed') {
        e.preventDefault();
        toggleViewed(f.path);
        setOverrides((m) => {
          const next = new Map(m);
          next.delete(f.id);
          return next;
        });
        setCurrent(f.path);
        return;
      }
      // `c`: on a focused line, open its comment box; else go to the file's first line.
      e.preventDefault();
      const el = document.activeElement;
      if (el instanceof HTMLButtonElement && el.hasAttribute('data-line-button')) {
        el.click();
        return;
      }
      const first = wrappers.current
        .get(f.path)
        ?.querySelector<HTMLButtonElement>('[data-line-button][tabindex="0"]');
      if (first) first.focus();
      else jump(f, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ordered, fileInPlay, jump, toggleViewed, current, readOnly]);

  const onSend = async (choice: ReviewChoiceId, text: string) => {
    const ok = await send(choice, text);
    if (ok) {
      pending.clear();
      setDraft(null);
      setEditing(null);
      setSent(choice);
    }
    return ok;
  };

  const summary = T.summary(ordered.length, parsed.additions, parsed.deletions);
  const treeId = `review-tree-${scope.runId}`;

  return (
    <div
      ref={rootRef}
      style={style as CSSProperties}
      className="acp-diff flex flex-col gap-4"
      data-testid="review-files"
      data-view={mode}
      data-narrow={fits ? undefined : ''}
    >
      <div
        ref={barRef}
        role="region"
        aria-label={T.bar}
        className="sticky top-[var(--review-top)] z-[15] -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-canvas px-4 py-2 sm:-mx-6 sm:px-6 wide:-mx-8 wide:px-8"
        data-testid="review-bar"
      >
        <Button
          size="sm"
          variant="quiet"
          aria-expanded={treeOpen}
          aria-controls={treeId}
          aria-label={treeOpen ? T.hideTree : T.showTree}
          title={treeOpen ? T.hideTree : T.showTree}
          onClick={() => setTreeOpen((o) => !o)}
        >
          {treeOpen ? <HideTreeIcon /> : <ShowTreeIcon />}
        </Button>
        <p
          className="flex items-center gap-2 font-medium tabular-nums"
          data-testid="review-summary-line"
        >
          <span aria-hidden="true">{summary.files}</span>
          <span aria-hidden="true" className="font-mono text-caption text-success">
            {summary.added}
          </span>
          <span aria-hidden="true" className="font-mono text-caption text-danger">
            {summary.removed}
          </span>
          <span className="sr-only">{summary.sr}</span>
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label={DIFF_COPY.viewLabel}
            hideLabel
            size="sm"
            options={views}
            value={mode}
            onChange={(v) => {
              setChoseHere(true);
              setMode(v);
            }}
          />
          <span
            className="text-caption text-dim tabular-nums"
            aria-label={T.viewedLabel(viewedCount, ordered.length)}
            data-testid="review-viewed-count"
          >
            {T.viewed(viewedCount, ordered.length)}
          </span>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setOverrides(new Map(ordered.map((f) => [f.id, allClosed] as const)))}
            data-testid="review-collapse-all"
          >
            {allClosed ? T.expandAll : T.collapseAll}
          </Button>
          <Popover
            label={T.shortcuts}
            align="end"
            trigger={
              <Button size="sm" variant="quiet" aria-label={T.shortcuts} title={T.shortcuts}>
                <KeyboardIcon />
              </Button>
            }
          >
            <h2 className="mb-2 text-caption font-semibold">{T.shortcuts}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-caption">
              {T.shortcutList
                .filter(([key]) => !readOnly || key !== 'c')
                .map(([key, what]) => (
                  <div key={key} className="contents">
                    <dt>
                      <kbd className="rounded-[4px] border border-line bg-sunken px-1.5 font-mono">
                        {key}
                      </kbd>
                    </dt>
                    <dd className="text-ink">{what}</dd>
                  </div>
                ))}
            </dl>
            <p className="mt-2 text-caption text-dim">{T.shortcutsNote}</p>
          </Popover>
          {readOnly ? (
            <span data-testid="files-read-only">
              <Badge tone="done" title={T.readOnlyTip}>
                {T.readOnly}
              </Badge>
            </span>
          ) : (
            <ReviewPopover
              review={review}
              choices={choices}
              compileOptions={{ commit, order }}
              onSummary={pending.setSummary}
              onSend={onSend}
              pending={sending}
              error={sendError}
            />
          )}
        </div>
      </div>

      {sent !== null ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-card border border-success/30 bg-success-soft px-4 py-2.5 text-ink"
          data-testid="review-sent"
        >
          {T.sent[sent]}
          <a href={ticketHref} className="font-medium text-accent hover:underline">
            {T.sentLink}
          </a>
        </p>
      ) : null}
      {truncated ? (
        <p
          role="note"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption"
          data-testid="review-truncated"
        >
          {DIFF_COPY.truncated}
        </p>
      ) : null}
      {heldBack > 0 ? (
        <p
          role="note"
          className="rounded-control border border-line bg-sunken px-3 py-2 text-caption"
          data-testid="review-large"
        >
          {DIFF_COPY.large(ordered.length - heldBack, ordered.length)}
        </p>
      ) : null}
      {offDiff.length > 0 ? (
        <section
          aria-label={T.offLine(offDiff.length)}
          className="flex flex-col gap-2 rounded-card border border-warning/30 bg-warning-soft p-3"
          data-testid="review-off-diff"
        >
          <p className="text-caption font-medium">{T.offLine(offDiff.length)}</p>
          {offDiff.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              commit={commit}
              max={commentMax}
              showPath
              editing={editing === c.id}
              onEdit={() => setEditing(c.id)}
              onCancelEdit={() => setEditing(null)}
              onSave={(body) => {
                pending.edit(c.id, body);
                setEditing(null);
              }}
              onDelete={() => pending.remove(c.id)}
            />
          ))}
        </section>
      ) : null}

      {ordered.length === 0 ? (
        <p className="text-dim">{DIFF_COPY.empty}</p>
      ) : (
        <div
          className={`grid grid-cols-1 items-start gap-4 ${
            treeOpen
              ? 'lg:grid-cols-[17rem_minmax(0,1fr)] wide:grid-cols-[19rem_minmax(0,1fr)]'
              : ''
          }`}
        >
          {treeOpen ? (
            <aside className="flex max-h-72 min-h-0 flex-col lg:sticky lg:top-[calc(var(--diff-sticky-top)+0.75rem)] lg:max-h-[calc(100vh-var(--diff-sticky-top)-1.5rem)]">
              <FileTree
                id={treeId}
                files={ordered}
                viewed={viewed}
                comments={counts}
                current={current}
                onJump={(f) => jump(f, true)}
              />
            </aside>
          ) : null}
          <div ref={setFilesEl} className="flex min-w-0 flex-col gap-3">
            {ordered.map((f) => {
              const isViewed = viewed.has(f.path);
              return (
                <div
                  key={f.id}
                  ref={(el) => {
                    if (el === null) wrappers.current.delete(f.path);
                    else wrappers.current.set(f.path, el);
                  }}
                  data-review-file={f.path}
                  style={{ scrollMarginTop: 'calc(var(--diff-sticky-top) + 0.75rem)' }}
                  onFocusCapture={() => setCurrent(f.path)}
                >
                  <DiffFileView
                    file={f}
                    mode={mode}
                    open={isOpen(f)}
                    shown={isShown(f)}
                    onToggle={() => setOpen(f, !isOpen(f))}
                    onShow={() => setShownExtra((s) => new Set(s).add(f.id))}
                    headerRef={(el) => {
                      if (el === null) headers.current.delete(f.path);
                      else headers.current.set(f.path, el);
                    }}
                    slots={slotsFor(f)}
                    stickyHeader
                    headerEnd={
                      <label
                        className={`ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-control border px-2 py-0.5 text-caption font-medium select-none ${
                          isViewed
                            ? 'border-accent/40 bg-accent-soft text-ink'
                            : 'border-line bg-control text-ink hover:bg-control-hover'
                        }`}
                        data-testid="review-viewed"
                      >
                        <input
                          type="checkbox"
                          checked={isViewed}
                          onChange={() => markViewed(f)}
                          aria-label={T.viewedBoxLabel(f.path)}
                          className="accent-accent"
                        />
                        {T.viewedBox}
                      </label>
                    }
                  />
                </div>
              );
            })}
            {missing.length > 0 ? (
              <div
                role="note"
                className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption"
                data-testid="review-missing"
              >
                <p className="font-medium">{DIFF_COPY.missingTitle(missing.length)}</p>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono break-all">
                  {missing.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
