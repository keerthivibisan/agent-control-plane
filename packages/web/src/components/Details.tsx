import type { ReactNode } from 'react';
import { ChevronRightIcon } from './icons';

/**
 * Collapsed-by-default section for technical detail (ids, sources, provenance, raw events). Native
 * <details>, so it opens with the keyboard and needs no state.
 */
export function Details({
  summary = 'Technical details',
  children,
  defaultOpen = false,
  testId,
}: {
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className="group rounded-card border border-line bg-panel"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-card px-4 py-2.5 text-dim select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon size={16} className="transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="border-t border-line px-4 py-3">{children}</div>
    </details>
  );
}
