import type { ReactNode } from 'react';

/**
 * Top of every page: the title, one line saying what the page shows, and optional actions.
 * Supersedes `PageHeader` in ./Panel (phase 2 moves the screens over).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  /** Small context line above the title (e.g. a link back to a list). */
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="mb-1 text-caption text-dim">{eyebrow}</div> : null}
        <h1 className="text-page font-semibold tracking-tight break-words">{title}</h1>
        <p className="mt-1 max-w-3xl text-dim">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
