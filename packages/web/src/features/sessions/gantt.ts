import type { SessionSummaryDto } from '@acp/core/api';

export interface GanttRow {
  session: SessionSummaryDto;
  startMs: number;
  endMs: number;
  /** No event observed yet: the bar is a point at `firstSeenAt`. */
  noEvents: boolean;
  leftPct: number;
  widthPct: number;
}

export interface GanttModel {
  rows: GanttRow[];
  startMs: number;
  endMs: number;
  ticks: { pct: number; ms: number }[];
  /** Most sessions whose observed spans overlap at one instant. */
  peakConcurrency: number;
}

const MIN_SPAN_MS = 60_000;

/**
 * Concurrency timeline: one bar per session from `firstSeenAt` to `lastEventAt` (observed activity
 * span, not a claimed runtime). Sessions with no events get a point at `firstSeenAt`.
 */
export function buildGantt(
  sessions: readonly SessionSummaryDto[],
  tickCount = 5,
): GanttModel | null {
  const spans = sessions
    .map((s) => {
      const start = Date.parse(s.firstSeenAt);
      const last = s.lastEventAt === null ? start : Date.parse(s.lastEventAt);
      return { session: s, start, end: Math.max(start, last), noEvents: s.lastEventAt === null };
    })
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end))
    .sort((a, b) => a.start - b.start || a.session.id.localeCompare(b.session.id));
  if (spans.length === 0) return null;

  const startMs = Math.min(...spans.map((s) => s.start));
  const rawEnd = Math.max(...spans.map((s) => s.end));
  const endMs = Math.max(rawEnd, startMs + MIN_SPAN_MS);
  const range = endMs - startMs;

  const rows = spans.map((s) => ({
    session: s.session,
    startMs: s.start,
    endMs: s.end,
    noEvents: s.noEvents,
    leftPct: ((s.start - startMs) / range) * 100,
    widthPct: ((s.end - s.start) / range) * 100,
  }));

  // Sweep: +1 at each start, -1 after each end (inclusive spans, so ends sort after starts).
  const points = spans.flatMap((s) => [
    { t: s.start, d: 1 },
    { t: s.end, d: -1 },
  ]);
  points.sort((a, b) => a.t - b.t || b.d - a.d);
  let open = 0;
  let peakConcurrency = 0;
  for (const p of points) {
    open += p.d;
    peakConcurrency = Math.max(peakConcurrency, open);
  }

  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const pct = (i / (tickCount - 1)) * 100;
    return { pct, ms: startMs + (range * pct) / 100 };
  });

  return { rows, startMs, endMs, ticks, peakConcurrency };
}
