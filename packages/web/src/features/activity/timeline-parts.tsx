import type { ReactNode } from 'react';

/*
 * The parts of a GitHub-like thread, shared by the ticket's Comments and Conversation tabs: a
 * vertical line with a round marker per row and the row's box or event line beside it.
 */

/** A round marker on the line, behind an item: an icon or an avatar, decorative. */
export function Marker({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'avatar' | 'accent' | 'success' | 'done';
}) {
  const tones = {
    neutral: 'border-line bg-subtle text-dim',
    avatar: 'border-line bg-panel text-ink',
    accent: 'border-accent/40 bg-accent-soft text-accent',
    success: 'border-success/40 bg-success-soft text-success',
    done: 'border-done/40 bg-done-soft text-done',
  } as const;
  return (
    <span
      aria-hidden="true"
      className={`absolute top-0 left-0 flex size-8 items-center justify-center rounded-full border ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** One row: the marker on the line, then the item. */
export function Row({
  badge,
  children,
  testId,
  author,
  event = false,
  id,
  data,
}: {
  badge: ReactNode;
  children: ReactNode;
  testId?: string;
  author?: string;
  /** A small event line (run started, a plan, a merge) instead of a comment box. */
  event?: boolean;
  id?: string;
  /** More `data-*` attributes for tests and styles. */
  data?: Record<`data-${string}`, string>;
}) {
  return (
    <li
      id={id}
      className={`relative min-w-0 scroll-mt-24 pl-12 ${event ? 'flex min-h-8 flex-col justify-center' : ''}`}
      data-testid={testId}
      data-author={author}
      {...data}
    >
      {badge}
      {children}
    </li>
  );
}

/** The thread's list with its vertical line behind the markers. */
export function Thread({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ol
      aria-label={label}
      className="relative flex flex-col gap-5 before:absolute before:top-4 before:bottom-4 before:left-4 before:border-l-2 before:border-line-muted"
    >
      {children}
    </ol>
  );
}

/** A comment box's header row: who, what, when, and actions at the end. */
export function BoxHeader({
  children,
  strong = false,
}: {
  children: ReactNode;
  /** The owner's own comment: a stronger edge, as GitHub draws yours. */
  strong?: boolean;
}) {
  return (
    <header
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-caption text-dim ${
        strong ? 'border-line-strong bg-panel' : 'border-line bg-subtle'
      }`}
    >
      {children}
    </header>
  );
}
