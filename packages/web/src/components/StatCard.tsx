import type { ReactNode } from 'react';
import { InfoTip } from './InfoTip';

/**
 * One headline number: a big value, its label (with an optional glossary tip) and an optional
 * sublabel for context. Pass the value already formatted with its unit (e.g. a TokenValue), so a
 * bare number never appears on its own. With `href` the card is a link.
 */
export function StatCard({
  label,
  value,
  tip,
  sublabel,
  href,
  testId,
}: {
  label: string;
  value: ReactNode;
  tip?: string;
  sublabel?: ReactNode;
  href?: string;
  testId?: string;
}) {
  const body = (
    <>
      <div className="pr-6 text-dim">{label}</div>
      <div className="mt-1 text-stat font-semibold tracking-tight tabular-nums">{value}</div>
      {sublabel ? <div className="mt-0.5 text-caption text-dim">{sublabel}</div> : null}
    </>
  );
  const frame =
    'block h-full min-w-0 rounded-card border border-line bg-panel px-5 py-4 shadow-card';
  return (
    <div className="relative min-w-0" data-testid={testId}>
      {href ? (
        <a
          href={href}
          className={`${frame} text-ink no-underline transition-colors hover:border-line-strong hover:bg-sunken`}
        >
          {body}
        </a>
      ) : (
        <div className={frame}>{body}</div>
      )}
      {/* Outside the link: a button inside an <a> is invalid and would hijack the click. */}
      {tip ? (
        <span className="absolute top-3.5 right-3.5">
          <InfoTip tip={tip} label={label} />
        </span>
      ) : null}
    </div>
  );
}
