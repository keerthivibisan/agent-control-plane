import { useId, type ReactNode } from 'react';
import { InfoTip } from './InfoTip';

/**
 * The basic surface: a soft rounded card. With a `title` it becomes a labelled region (so tests and
 * screen readers can find it by name), with an optional one-line description, an info tip on the
 * title, and actions on the right.
 */
export function Card({
  title,
  description,
  tip,
  actions,
  children,
  className = '',
  padded = true,
  testId,
}: {
  title?: string;
  description?: ReactNode;
  tip?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** False for edge-to-edge content (a table or a graph). */
  padded?: boolean;
  testId?: string;
}) {
  const titleId = useId();
  const hasHeader = title !== undefined || actions !== undefined;
  // 8-pt rhythm (DESIGN.md): 24px padding, 16px between the header and the body.
  const body = padded ? `px-6 pb-6 ${hasHeader ? 'pt-4' : 'pt-6'}` : hasHeader ? 'pt-4' : '';
  return (
    <section
      aria-labelledby={title !== undefined ? titleId : undefined}
      data-testid={testId}
      className={`min-w-0 rounded-card border border-line bg-panel shadow-card ${className}`}
    >
      {hasHeader ? (
        <header className="flex flex-wrap items-start gap-x-3 gap-y-1 px-6 pt-5">
          <div className="min-w-0 flex-1">
            {title !== undefined ? (
              <h2 className="flex items-center gap-1 text-title font-semibold tracking-tight">
                <span id={titleId}>{title}</span>
                {tip ? <InfoTip tip={tip} label={title} /> : null}
              </h2>
            ) : null}
            {description ? <p className="mt-0.5 text-dim">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={body}>{children}</div>
    </section>
  );
}
