import type { ReactNode } from 'react';
import { InboxIcon } from './icons';

/**
 * A friendly "nothing here yet" block (DESIGN.md, "Empty state"): the icon on a small bordered
 * tile, a short title, one sentence, and at most one action.
 */
export function EmptyState({
  title,
  text,
  icon,
  action,
  compact = false,
  testId,
}: {
  title: string;
  text?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  /** Smaller, for use inside a card next to other content. */
  compact?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col items-center text-center ${compact ? 'gap-1 py-4' : 'gap-1.5 py-12'}`}
    >
      {compact ? (
        <span
          aria-hidden="true"
          className="mb-1.5 flex size-8 items-center justify-center rounded-control border border-line bg-sunken text-dim"
        >
          {icon ?? <InboxIcon size={16} />}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="relative mb-3 flex size-11 items-center justify-center rounded-card border border-line bg-panel text-dim shadow-[0_1px_2px_rgb(0_0_0/0.05),0_0_0_4px_var(--color-sunken)]"
        >
          {icon ?? <InboxIcon size={20} />}
        </span>
      )}
      <p className={compact ? 'font-medium' : 'text-title font-semibold'}>{title}</p>
      {text ? <p className="max-w-md text-dim">{text}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
