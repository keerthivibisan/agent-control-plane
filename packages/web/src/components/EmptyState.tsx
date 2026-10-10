import type { ReactNode } from 'react';
import { InboxIcon } from './icons';

/**
 * A friendly "nothing here yet" block: icon, short title, one sentence, optional action.
 * Supersedes `EmptyState` in ./Panel.
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
      className={`flex flex-col items-center text-center ${compact ? 'gap-1.5 py-4' : 'gap-2 py-10'}`}
    >
      <span
        className={`flex items-center justify-center rounded-full bg-sunken text-dim ${compact ? 'size-9' : 'size-12'}`}
      >
        {icon ?? <InboxIcon size={compact ? 18 : 22} />}
      </span>
      <p className="font-medium">{title}</p>
      {text ? <p className="max-w-md text-dim">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
