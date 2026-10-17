import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE: Record<PillTone, { frame: string; dot: string }> = {
  neutral: { frame: 'border-line bg-sunken text-dim', dot: 'bg-status-stale' },
  accent: { frame: 'border-accent/20 bg-accent-soft text-accent', dot: 'bg-accent' },
  success: { frame: 'border-success/20 bg-success/10 text-success', dot: 'bg-status-active' },
  warning: { frame: 'border-warning/25 bg-warning-soft text-warning', dot: 'bg-status-idle' },
  danger: { frame: 'border-danger/25 bg-danger-soft text-danger', dot: 'bg-danger' },
};

/**
 * A small rounded label (DESIGN.md, "Pills"): a state word with a dot. The tone carries meaning
 * only (status colors), and the word is always there, so color is never the only signal.
 */
export function Pill({
  tone = 'neutral',
  children,
  dot = true,
  testId,
  title,
}: {
  tone?: PillTone;
  children: ReactNode;
  dot?: boolean;
  testId?: string;
  title?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      title={title}
      className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-caption font-medium whitespace-nowrap ${t.frame}`}
    >
      {dot ? (
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${t.dot}`} />
      ) : null}
      {children}
    </span>
  );
}

/**
 * A quiet tag: a label, a count, a type ("Bug", "api"). Squarer than a Pill and without a dot,
 * because it names a thing rather than a state.
 */
export function Badge({
  tone = 'neutral',
  children,
  testId,
  title,
  mono = false,
}: {
  tone?: PillTone;
  children: ReactNode;
  testId?: string;
  title?: string;
  /** Monospace, for keys and ids (`WEB-12`). */
  mono?: boolean;
}) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      title={title}
      className={`inline-flex h-5 items-center rounded-[0.3125rem] border px-1.5 text-caption font-medium whitespace-nowrap tabular-nums ${mono ? 'font-mono' : ''} ${TONE[tone].frame}`}
    >
      {children}
    </span>
  );
}
