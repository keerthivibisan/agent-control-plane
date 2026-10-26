import { useRef, useState, type KeyboardEvent } from 'react';
import { formatCount } from '../../lib/format';
import { DIFF_COPY as T } from './copy';
import { FilePath } from './DiffFileView';
import { STATUS_ICON, STATUS_TONE } from './icons';
import type { DiffFile } from './parse';

/**
 * The diff's files, each a button that jumps to the file. One tab stop for the whole list (a
 * roving tabindex): ↑/↓ move between files, Home/End go to the first and last, Enter or Space
 * jumps.
 */
export function DiffFileList({
  files,
  onJump,
}: {
  files: readonly DiffFile[];
  onJump: (file: DiffFile) => void;
}) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.min(active, files.length - 1);

  const move = (to: number) => {
    const next = Math.max(0, Math.min(files.length - 1, to));
    setActive(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to =
      e.key === 'ArrowDown'
        ? i + 1
        : e.key === 'ArrowUp'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? files.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    move(to);
  };

  return (
    <nav aria-label={T.filesNav} className="rounded-card border border-line bg-panel">
      <ul className="max-h-56 overflow-y-auto py-1" data-testid="diff-file-list">
        {files.map((f, i) => {
          const Icon = STATUS_ICON[f.status];
          return (
            <li key={f.id}>
              <button
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                tabIndex={i === current ? 0 : -1}
                onFocus={() => setActive(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onClick={() => onJump(f)}
                data-testid="diff-file-link"
                className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover focus-visible:bg-hover"
              >
                <Icon className={`shrink-0 ${STATUS_TONE[f.status]}`} />
                <span className="sr-only">{T.status[f.status]}: </span>
                <FilePath file={f} />
                {f.binary ? (
                  <span className="ml-auto shrink-0 text-caption text-dim">
                    <span className="sr-only"> </span>
                    {T.binaryTag}
                  </span>
                ) : (
                  <span className="ml-auto flex shrink-0 gap-2 font-mono text-caption tabular-nums">
                    <span className="text-success">
                      +{formatCount(f.additions)}
                      <span className="sr-only"> {T.added(f.additions)}</span>
                    </span>
                    <span className="text-danger">
                      −{formatCount(f.deletions)}
                      <span className="sr-only"> {T.removed(f.deletions)}</span>
                    </span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
