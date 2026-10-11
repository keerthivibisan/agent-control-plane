import { Button } from '../../components/Button';
import { PROJECT_PAGE } from '../../lib/copy';

/**
 * Previous / next for keyset pages, in the redesign's button style. A local variant of the older
 * `components/Pager` (same props), proposed to replace its look in the shared component.
 */
export function SessionsPager({
  pageNumber,
  nextCursor,
  onNext,
  onPrev,
  onFirst,
  fetching = false,
}: {
  pageNumber: number;
  nextCursor: string | null;
  onNext: (cursor: string) => void;
  onPrev: () => void;
  onFirst: () => void;
  fetching?: boolean;
}) {
  const p = PROJECT_PAGE.pager;
  return (
    <nav aria-label={p.label} className="flex flex-wrap items-center gap-2 text-dim">
      {pageNumber > 2 ? (
        <Button variant="quiet" onClick={onFirst}>
          {p.first}
        </Button>
      ) : null}
      <Button onClick={onPrev} disabled={pageNumber === 1}>
        {p.previous}
      </Button>
      <span className="tabular-nums" aria-live="polite">
        {fetching ? p.updating : p.page(pageNumber)}
      </span>
      <Button
        onClick={() => {
          if (nextCursor) onNext(nextCursor);
        }}
        disabled={nextCursor === null}
      >
        {p.next}
      </Button>
    </nav>
  );
}
