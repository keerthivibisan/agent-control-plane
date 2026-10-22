import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'done';

/*
 * GitHub's labels (DESIGN.md v3, "Pills and tags"): a rounded pill with a colored border and
 * colored text. A Pill (a state) also has the soft fill and a dot; a Badge (a tag) is outline only.
 */
const TONE: Record<PillTone, { border: string; fill: string; dot: string }> = {
  neutral: { border: 'border-line text-dim', fill: 'bg-subtle', dot: 'bg-status-stale' },
  accent: { border: 'border-accent/50 text-accent', fill: 'bg-accent-soft', dot: 'bg-accent' },
  success: {
    border: 'border-success/50 text-success',
    fill: 'bg-success-soft',
    dot: 'bg-status-active',
  },
  warning: {
    border: 'border-warning/50 text-warning',
    fill: 'bg-warning-soft',
    dot: 'bg-status-idle',
  },
  danger: { border: 'border-danger/50 text-danger', fill: 'bg-danger-soft', dot: 'bg-danger' },
  done: { border: 'border-done/50 text-done', fill: 'bg-done-soft', dot: 'bg-done' },
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
      className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-caption font-medium whitespace-nowrap ${t.border} ${t.fill}`}
    >
      {dot ? (
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${t.dot}`} />
      ) : null}
      {children}
    </span>
  );
}

/**
 * A quiet tag: a label, a count, a type ("Bug", "api"). Like GitHub's labels: a pill outlined in
 * its tone, without a fill or a dot, because it names a thing rather than a state.
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
      className={`inline-flex h-5 items-center rounded-full border px-2 text-caption font-medium whitespace-nowrap tabular-nums ${mono ? 'font-mono' : ''} ${TONE[tone].border}`}
    >
      {children}
    </span>
  );
}
