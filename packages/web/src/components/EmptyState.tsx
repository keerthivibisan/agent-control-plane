import type { ReactNode } from 'react';
import { InboxIcon } from './icons';

/**
 * A friendly "nothing here yet" block (DESIGN.md, "Empty state"): a small illustration (the icon
 * on soft accent rings), a short title, one sentence, and at most one action. Supersedes
 * `EmptyState` in ./Panel.
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
      className={`flex flex-col items-center text-center ${compact ? 'gap-1.5 py-4' : 'gap-2 py-12'}`}
    >
      {compact ? (
        <span className="mb-1 flex size-9 items-center justify-center rounded-full bg-sunken text-dim">
          {icon ?? <InboxIcon size={18} />}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="mb-3 flex size-20 items-center justify-center rounded-full bg-accent-soft/60 ring-8 ring-accent-soft/30"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl border border-line bg-panel text-accent shadow-raised">
            {icon ?? <InboxIcon size={22} />}
          </span>
        </span>
      )}
      <p className={compact ? 'font-medium' : 'text-title font-semibold tracking-tight'}>{title}</p>
      {text ? <p className="max-w-md text-dim">{text}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
