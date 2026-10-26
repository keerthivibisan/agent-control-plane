import { useId, useMemo, useState } from 'react';
import { DIFF_COPY, STATUS_ICON, STATUS_TONE, type DiffFile } from '../../components/diff';
import { inputClass } from '../../components/Input';
import { formatCount } from '../../lib/format';
import { REVIEW_PAGE_COPY as T } from './copy';
import { buildFileTree, filterFiles, type TreeNode } from './file-tree';
import { ChevronIcon, CommentIcon, FolderIcon, FolderOpenIcon, ViewedIcon } from './icons';

/**
 * The changed files as a tree beside the diff (v0.3.0 D-A), like GitHub's: a filter box, folders
 * that fold, each file with its status icon, +/− counts, a check once viewed and its pending
 * comments. A click scrolls to the file. A navigation of buttons (Tab moves through them), with
 * the file in view marked `aria-current`.
 */
export function FileTree({
  id,
  files,
  viewed,
  comments,
  current,
  onJump,
}: {
  id: string;
  files: readonly DiffFile[];
  viewed: ReadonlySet<string>;
  /** Pending comments per path. */
  comments: ReadonlyMap<string, number>;
  /** The path of the file in view, if known. */
  current: string | null;
  onJump: (file: DiffFile) => void;
}) {
  const filterId = useId();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const shown = useMemo(() => filterFiles(files, query), [files, query]);
  const tree = useMemo(() => buildFileTree(shown), [shown]);
  const filtering = query.trim().length > 0;

  const toggle = (path: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (nodes: readonly TreeNode[], depth: number) => (
    <ul className="flex flex-col">
      {nodes.map((n) => {
        const indent = { paddingLeft: `${depth * 0.75 + 0.5}rem` };
        if (n.kind === 'folder') {
          // A filter shows every match: folders stay open while it is on.
          const open = filtering || !closed.has(n.path);
          return (
            <li key={`d:${n.path}`}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(n.path)}
                style={indent}
                className="flex w-full items-center gap-1.5 rounded-control py-1 pr-2 text-left text-caption text-ink hover:bg-hover"
                data-testid="review-tree-folder"
              >
                <ChevronIcon
                  size={13}
                  className={`shrink-0 text-dim transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                />
                {open ? (
                  <FolderOpenIcon size={15} className="shrink-0 text-dim" />
                ) : (
                  <FolderIcon size={15} className="shrink-0 text-dim" />
                )}
                <span className="min-w-0 truncate">{n.name}</span>
              </button>
              {open ? renderNodes(n.children, depth + 1) : null}
            </li>
          );
        }
        const f = n.file;
        const Icon = STATUS_ICON[f.status];
        const isViewed = viewed.has(f.path);
        const count = comments.get(f.path) ?? 0;
        const here = current === f.path;
        return (
          <li key={`f:${f.id}`}>
            <button
              type="button"
              onClick={() => onJump(f)}
              aria-current={here ? 'true' : undefined}
              title={f.path}
              style={indent}
              className={`flex w-full items-center gap-1.5 rounded-control py-1 pr-2 text-left text-caption hover:bg-hover ${
                here ? 'bg-hover font-semibold text-ink' : 'text-ink'
              } ${isViewed ? 'text-dim' : ''}`}
              data-testid="review-tree-file"
              data-path={f.path}
              data-viewed={isViewed ? '' : undefined}
            >
              <Icon className={`shrink-0 ${STATUS_TONE[f.status]}`} />
              <span className="sr-only">{DIFF_COPY.status[f.status]}: </span>
              <span className="min-w-0 flex-1 truncate font-mono">{n.name}</span>
              {count > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-dim">
                  <CommentIcon size={12} />
                  {formatCount(count)}
                  <span className="sr-only">, {T.commentCount(count)}</span>
                </span>
              ) : null}
              {isViewed ? (
                <span className="shrink-0 text-success">
                  <ViewedIcon size={13} />
                  <span className="sr-only">, {T.viewedMark}</span>
                </span>
              ) : null}
              {f.binary ? null : (
                <span className="flex shrink-0 gap-1 font-mono text-micro tabular-nums">
                  <span className="text-success">
                    +{formatCount(f.additions)}
                    <span className="sr-only"> {DIFF_COPY.added(f.additions)}</span>
                  </span>
                  <span className="text-danger">
                    −{formatCount(f.deletions)}
                    <span className="sr-only"> {DIFF_COPY.removed(f.deletions)}</span>
                  </span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav
      id={id}
      aria-label={T.tree}
      className="flex min-h-0 flex-col gap-2"
      data-testid="review-tree"
    >
      <label htmlFor={filterId} className="sr-only">
        {T.filter}
      </label>
      <input
        id={filterId}
        type="search"
        value={query}
        placeholder={T.filterPlaceholder}
        onChange={(e) => setQuery(e.target.value)}
        className={inputClass('h-8 text-caption')}
        data-testid="review-tree-filter"
      />
      {filtering ? (
        <p className="px-1 text-caption text-dim" role="status">
          {shown.length === 0 ? T.filterEmpty : T.filterCount(shown.length, files.length)}
        </p>
      ) : null}
      <div className="min-h-0 overflow-y-auto">{renderNodes(tree, 0)}</div>
    </nav>
  );
}
