import type { SessionStatus } from '@acp/core';
import type { SessionSummaryDto } from '@acp/core/api';
import { useMemo } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { SESSIONS_COPY, STATUS_COPY } from '../../lib/copy';
import { formatDuration, formatExactTime } from '../../lib/format';
import { href } from '../../lib/router';
import { buildGantt } from './gantt';
import { sessionName } from './session-bits';

const COPY = SESSIONS_COPY.timeline;

/** Status colors from the theme (index.css); the legend names each status in words too. */
const BAR: Record<SessionStatus, string> = {
  active: 'bg-status-active',
  idle: 'bg-status-idle',
  stale: 'bg-status-stale/70',
  ended: 'bg-status-ended/70',
  unknown: 'bg-status-unknown/60',
};

const tickFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** One bar per session on this page, to show which ones ran at the same time. */
export function ConcurrencyTimeline({ sessions }: { sessions: readonly SessionSummaryDto[] }) {
  const model = useMemo(() => buildGantt(sessions), [sessions]);
  if (!model) return <p className="text-dim">{COPY.empty}</p>;
  const statuses = [...new Set(model.rows.map((r) => r.session.status.value))];
  return (
    <div className="flex flex-col gap-3" data-testid="gantt">
      <p className="text-dim">
        {COPY.description} {COPY.peak(model.peakConcurrency)}
      </p>
      <div
        role="list"
        aria-label={COPY.label}
        className="grid grid-cols-[minmax(8rem,16rem)_1fr] gap-x-4"
      >
        <div aria-hidden="true" />
        <div
          aria-hidden="true"
          className="relative mb-1 h-5 border-b border-line text-caption text-dim"
        >
          {model.ticks.map((t, i) => (
            <span
              key={t.pct}
              className={`absolute top-0 whitespace-nowrap ${
                i === 0
                  ? ''
                  : i === model.ticks.length - 1
                    ? '-translate-x-full'
                    : '-translate-x-1/2'
              }`}
              style={{ left: `${t.pct}%` }}
            >
              {tickFormat.format(new Date(t.ms))}
            </span>
          ))}
        </div>
        {model.rows.map((r) => {
          const s = r.session;
          const span = r.noEvents
            ? `${formatExactTime(s.firstSeenAt)} · ${COPY.noActivity}`
            : `${formatExactTime(s.firstSeenAt)} → ${formatExactTime(
                new Date(r.endMs).toISOString(),
              )} (${formatDuration(r.endMs - r.startMs)})`;
          return (
            <div key={s.id} role="listitem" className="contents">
              <a
                href={href.session(s.id)}
                className="truncate py-1.5 text-ink no-underline hover:text-accent"
                title={sessionName(s)}
              >
                {sessionName(s)}
              </a>
              <div className="relative h-8 border-b border-line/60">
                {/* Faint guides under each time label, so a bar can be read against the axis. */}
                {model.ticks.map((t) => (
                  <span
                    key={t.pct}
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-line/70"
                    style={{ left: `${t.pct}%` }}
                  />
                ))}
                <div
                  className="absolute top-2.5 h-3"
                  style={{
                    left: `${r.leftPct}%`,
                    width: r.noEvents ? '0.75rem' : `max(${r.widthPct}%, 6px)`,
                  }}
                >
                  <Tooltip
                    content={`${sessionName(s)} · ${STATUS_COPY[s.status.value].word} · ${span}`}
                    className={`block h-full w-full rounded-full ${
                      r.noEvents ? 'border-2 border-status-unknown bg-panel' : BAR[s.status.value]
                    }`}
                  >
                    <span className="sr-only" data-testid={`bar-${s.id}`}>
                      {span}
                    </span>
                  </Tooltip>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <ul
        className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption text-dim"
        aria-label={SESSIONS_COPY.relate.legendLabel}
      >
        {statuses.map((st) => (
          <li key={st} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block h-2 w-5 rounded-full ${BAR[st]}`} />
            {STATUS_COPY[st].word}
          </li>
        ))}
      </ul>
    </div>
  );
}
