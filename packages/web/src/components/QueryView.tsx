import type { ReactNode } from 'react';
import type { QueryState } from '../lib/query-store';
import { ErrorNotice } from './ErrorNotice';

/**
 * Renders a query's loading / error / data states. When a refetch fails, the error is shown above
 * the last good data instead of replacing or hiding it.
 */
export function QueryView<T>({
  query,
  children,
  loading = 'Loading…',
}: {
  query: QueryState<T>;
  children: (data: T) => ReactNode;
  loading?: string;
}) {
  if (query.data === undefined) {
    if (query.error) return <ErrorNotice error={query.error} />;
    return <p className="text-dim italic">{loading}</p>;
  }
  return (
    <>
      {query.error ? (
        <div className="mb-2">
          <ErrorNotice error={query.error} />
          <p className="mt-1 text-[11px] text-dim">Showing the last successfully loaded data.</p>
        </div>
      ) : null}
      {children(query.data)}
    </>
  );
}
