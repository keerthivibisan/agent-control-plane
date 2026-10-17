import { useState } from 'react';

/**
 * Keyset pagination state: a stack of cursors (the API's `page.nextCursor` values). Remount the
 * owner (React `key`) to reset it when the query changes.
 */
export function useCursorStack() {
  const [stack, setStack] = useState<readonly string[]>([]);
  return {
    cursor: stack[stack.length - 1],
    pageNumber: stack.length + 1,
    next: (c: string) => setStack((s) => [...s, c]),
    prev: () => setStack((s) => s.slice(0, -1)),
    first: () => setStack([]),
  };
}

export function Pager({
  pageNumber,
  nextCursor,
  onNext,
  onPrev,
  onFirst,
  fetching,
}: {
  pageNumber: number;
  nextCursor: string | null;
  onNext: (cursor: string) => void;
  onPrev: () => void;
  onFirst: () => void;
  fetching?: boolean;
}) {
  const btn =
    'inline-flex h-6 items-center rounded-control border border-line bg-panel px-2 text-caption text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-panel';
  return (
    <div
      className="flex items-center gap-1.5 text-caption text-dim"
      role="navigation"
      aria-label="Pages"
    >
      <button type="button" className={btn} onClick={onFirst} disabled={pageNumber === 1}>
        first
      </button>
      <button type="button" className={btn} onClick={onPrev} disabled={pageNumber === 1}>
        previous
      </button>
      <span className="px-1 tabular-nums">page {pageNumber}</span>
      <button
        type="button"
        className={btn}
        onClick={() => {
          if (nextCursor) onNext(nextCursor);
        }}
        disabled={nextCursor === null}
      >
        next
      </button>
      {fetching ? <span className="italic">updating…</span> : null}
    </div>
  );
}
