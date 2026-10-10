import type { SessionStatus } from '@acp/core';
import type { SessionSummaryDto } from '@acp/core/api';
import { useMemo } from 'react';
import { StatusPill } from '../../components/StatusPill';
import { formatDuration, formatTime, sessionLabel, shortId } from '../../lib/format';
import { href } from '../../lib/router';
import { buildGantt } from './gantt';

const BAR: Record<SessionStatus, string> = {
  active: 'bg-emerald-500/70',
  idle: 'bg-sky-500/60',
  stale: 'bg-amber-500/60',
  ended: 'bg-slate-400/70',
  unknown: 'bg-slate-300/60 dark:bg-slate-600/60',
};

/** Gantt bars of the sessions on the current explorer page, to show which ran at the same time. */
export function ConcurrencyTimeline({ sessions }: { sessions: readonly SessionSummaryDto[] }) {
  const model = useMemo(() => buildGantt(sessions), [sessions]);
  if (!model) return <p className="text-dim italic">No sessions on this page.</p>;
  return (
    <div className="flex flex-col gap-1 text-[11px]" data-testid="gantt">
      <p className="text-dim">
        Bars span first seen → last event (observed activity, not a runtime claim). Peak overlap on
        this page: <span className="font-mono text-ink">{model.peakConcurrency}</span> session
        {model.peakConcurrency === 1 ? '' : 's'}.
      </p>
      <div className="grid grid-cols-[14rem_1fr] gap-x-2">
        <div />
        <div className="relative h-4 border-b border-line text-dim">
          {model.ticks.map((t) => (
            <span
              key={t.pct}
              className="absolute -translate-x-1/2 font-mono whitespace-nowrap first:translate-x-0 last:-translate-x-full"
              style={{ left: `${t.pct}%` }}
            >
              {formatTime(new Date(t.ms).toISOString()).slice(5, 16)}
            </span>
          ))}
        </div>
        {model.rows.map((r) => (
          <div key={r.session.id} className="contents">
            <div className="flex min-w-0 items-center gap-1 py-0.5">
              <a href={href.session(r.session.id)} className="truncate" title={r.session.id}>
                {sessionLabel(r.session)}
              </a>
              <span className="shrink-0 font-mono text-dim">{shortId(r.session.id)}</span>
            </div>
            <div className="relative h-5 border-b border-line/40">
              <div
                className={`absolute top-1 h-3 rounded-sm ${BAR[r.session.status.value]} ${r.noEvents ? 'border border-dashed border-dim bg-transparent' : ''}`}
                style={{ left: `${r.leftPct}%`, width: `max(${r.widthPct}%, 3px)` }}
                title={`${sessionLabel(r.session)} · ${formatTime(r.session.firstSeenAt)} → ${
                  r.noEvents ? 'no events' : formatTime(new Date(r.endMs).toISOString())
                } (${formatDuration(r.endMs - r.startMs)})`}
                data-testid={`bar-${r.session.id}`}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {(['active', 'idle', 'stale', 'ended', 'unknown'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-4 rounded-sm ${BAR[s]}`} />
            <StatusPill status={s} />
          </span>
        ))}
      </div>
    </div>
  );
}
