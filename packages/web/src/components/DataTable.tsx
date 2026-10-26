import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  /** Column header; on narrow screens also the label in front of each value. */
  label: string;
  /** Optional richer header (e.g. label + InfoTip). Defaults to `label`. */
  header?: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Extra classes for this column's cells (e.g. a max width). */
  className?: string;
}

/**
 * A calm, dense table (GitHub-like): no zebra stripes, a border between rows, a `subtle` header
 * band. Below 1024px (Tailwind `lg`) each row becomes a small card with "Label: value" lines, from the same DOM (CSS only), so there
 * is one row element per item at every width.
 *
 * `rowAttributes` adds `data-*` attributes to a row (e.g. `data-session-id`) for tests and links.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  empty,
  rowAttributes,
  selectedKey,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Accessible name of the table. */
  label: string;
  /** Shown instead of the table when there are no rows (usually an EmptyState). */
  empty?: ReactNode;
  rowAttributes?: (row: T) => Record<`data-${string}`, string>;
  selectedKey?: string | null;
}) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;
  return (
    <table aria-label={label} className="block w-full border-collapse text-left lg:table">
      <thead className="hidden lg:table-header-group">
        <tr className="border-b border-line bg-subtle">
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={`h-10 px-3 py-2 text-caption font-semibold whitespace-nowrap text-dim first:pl-5 last:pr-5 ${c.align === 'right' ? 'text-right' : ''}`}
            >
              {c.header ?? c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="flex flex-col gap-2 max-lg:p-2 lg:table-row-group">
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <tr
              key={key}
              {...rowAttributes?.(row)}
              data-selected={selectedKey === key ? 'true' : undefined}
              className={`block rounded-control border border-line px-3 py-2 lg:table-row lg:rounded-none lg:border-0 lg:border-b lg:border-line-muted lg:px-0 lg:py-0 lg:transition-colors lg:last:border-b-0 ${
                selectedKey === key ? 'bg-accent-soft' : 'lg:hover:bg-hover'
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.label}
                  className={`flex items-baseline justify-between gap-x-3 py-1 before:min-w-0 max-lg:flex-wrap max-lg:[&>*]:ml-auto max-lg:[&>*]:min-w-0 before:text-caption before:text-dim before:content-[attr(data-label)] lg:table-cell lg:px-3 lg:py-2.5 lg:align-middle lg:before:content-none lg:first:pl-5 lg:last:pr-5 ${
                    c.align === 'right' ? 'lg:text-right' : ''
                  } ${c.className ?? ''}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
