import type { ReactNode } from 'react';

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
    <section className={`rounded border border-line bg-panel ${className}`}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <h2 className="text-xs font-semibold tracking-wide text-dim uppercase">{title}</h2>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="text-dim">{children}</div>;
}
