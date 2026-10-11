import { Button } from '../../components/Button';
import { SESSIONS_COPY } from '../../lib/copy';

const COPY = SESSIONS_COPY.pager;

/**
 * Previous / next page for a cursor-paged list (state from `useCursorStack`). Shown only when there
 * is more than one page. A calmer local variant of components/Pager.
 */
export function PageButtons({
  pageNumber,
  nextCursor,
  onNext,
  onPrev,
  fetching = false,
}: {
  pageNumber: number;
  nextCursor: string | null;
  onNext: (cursor: string) => void;
  onPrev: () => void;
  fetching?: boolean;
}) {
  if (pageNumber === 1 && nextCursor === null) return null;
  return (
    <nav aria-label={COPY.label} className="flex items-center gap-2 text-dim">
      {fetching ? <span className="text-caption">{COPY.updating}</span> : null}
      <Button variant="secondary" onClick={onPrev} disabled={pageNumber === 1}>
        {COPY.previous}
      </Button>
      <span className="text-caption tabular-nums">{COPY.page(pageNumber)}</span>
      <Button
        variant="secondary"
        onClick={() => {
          if (nextCursor) onNext(nextCursor);
        }}
        disabled={nextCursor === null}
      >
        {COPY.next}
      </Button>
    </nav>
  );
}
