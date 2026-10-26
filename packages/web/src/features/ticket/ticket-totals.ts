import type { TicketTotalsDto } from '@acp/core/api';
import { TICKET_TOTALS_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';

/*
 * Pure rules for the ticket badge (v0.3.0 T-A): how long the ticket took (or has been running),
 * and its tokens as the Tokens page counts them. No cost: provider-reported costs are never added
 * up (ADR-0014). Unavailable usage stays unavailable, never 0.
 */

const MIN = 60_000;

/** "45s", "14m", "1h 12m", "3h", "2d 4h": short enough for a badge. */
export function formatSpan(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < MIN) return `${Math.floor(safe / 1000)}s`;
  const m = Math.floor(safe / MIN);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

export type BadgeTime =
  /** Done or closed: from the first run's start to the finish. */
  | { kind: 'took'; ms: number }
  /** Open with a run still live (working or waiting for the owner): ticks. */
  | { kind: 'running'; ms: number }
  /** Open with no live run (stopped, not finished): ticks too. */
  | { kind: 'open'; ms: number };

/**
 * The badge's time, or null before the first run (the badge is hidden then). While the ticket is
 * open it is the server's elapsed time, kept current with this browser's clock (never less than
 * the server said, so a clock behind the server's never makes it go back).
 */
export function badgeTime(
  t: Pick<TicketTotalsDto, 'startedAt' | 'finishedAt' | 'elapsedMs' | 'runs'>,
  nowMs: number,
): BadgeTime | null {
  if (t.startedAt === null || t.elapsedMs === null) return null;
  if (t.finishedAt !== null) return { kind: 'took', ms: t.elapsedMs };
  const started = Date.parse(t.startedAt);
  const ms = Number.isNaN(started) ? t.elapsedMs : Math.max(t.elapsedMs, nowMs - started);
  return { kind: t.runs.some((r) => r.endedAt === null) ? 'running' : 'open', ms };
}

export function badgeTimeText(time: BadgeTime): string {
  const d = formatSpan(time.ms);
  const T = TICKET_TOTALS_COPY;
  return time.kind === 'took' ? T.took(d) : time.kind === 'running' ? T.running(d) : T.open(d);
}

/** "1.2M tokens" from the Tokens page's total processed; null when no record reported it. */
export function badgeTokensText(t: Pick<TicketTotalsDto, 'headline'>): string | null {
  const n = t.headline.totalProcessed;
  return n === null ? null : TICKET_TOTALS_COPY.tokens(formatCount(n, 'compact'));
}

/** The badge's accessible name: one sentence with both facts. */
export function badgeLabel(time: BadgeTime, t: Pick<TicketTotalsDto, 'headline'>): string {
  const T = TICKET_TOTALS_COPY;
  const n = t.headline.totalProcessed;
  return T.label(
    badgeTimeText(time),
    n === null ? T.tokensUnavailable : T.tokensSentence(formatCount(n)),
  );
}

/** Some records did not report a token type: its number is a lower bound ("partial"). */
export function isPartial(t: Pick<TicketTotalsDto, 'usage'>): boolean {
  const u = t.usage.recordsWithUnavailable;
  return u.input + u.output + u.cacheCreation + u.cacheRead > 0;
}
