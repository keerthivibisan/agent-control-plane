import type { ReactNode } from 'react';

/**
 * Superseded by ./Card. Restyled with the new tokens so the existing screens look calm until
 * phase 2 replaces their uses; the markup (and thus every test selector) is unchanged.
 */
export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-card border border-line bg-panel shadow-card ${className}`}>
      <header className="flex items-center gap-2 px-4 pt-3">
        <h2 className="text-title font-semibold">{title}</h2>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-4 pt-3">{children}</div>
    </section>
  );
}

/** Superseded by ./PageHeader (which requires a one-line description). */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-page font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}
