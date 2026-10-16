import type { ProjectTokensDto } from '@acp/core/api';
import { StatCard } from '../../components/StatCard';
import { TOKENS_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { Figure, NEW_WORK_TYPES, Share, TOTAL_TYPES } from './figures';

/** The exact count under a compact headline number, when the compact form hides digits. */
function exact(value: number | null): string | null {
  if (value === null || formatCount(value, 'compact') === formatCount(value)) return null;
  return TOKENS_COPY.tiles.tokens(value);
}

/**
 * The page's five headline tiles (docs/redesign/README.md §4.5): sessions, agent runs, new work,
 * total processed and the cache reuse share. Figures come from `tokenHeadline()` on the server;
 * none is computed here. There is no cost tile: provider-reported cost is per session and never
 * summed, so it lives in the session table.
 */
export function TokenTiles({ data }: { data: ProjectTokensDto }) {
  const t = TOKENS_COPY.tiles;
  const { headline, totals } = data;
  const newWorkExact = exact(headline.newWork);
  const totalExact = exact(headline.totalProcessed);
  return (
    <div
      role="group"
      aria-label={t.label}
      data-testid="token-tiles"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
    >
      <StatCard
        label={t.sessions}
        tip={t.sessionsTip}
        testId="tile-sessions"
        value={<span className="tabular-nums">{formatCount(data.sessions.total)}</span>}
        sublabel={t.sessionsWithUsage(data.sessions.withUsage)}
      />
      <StatCard
        label={t.runs}
        tip={t.runsTip}
        testId="tile-runs"
        value={<span className="tabular-nums">{formatCount(data.runs)}</span>}
        sublabel={t.runsTickets(data.ticketsWithRuns)}
      />
      <StatCard
        label={t.newWork}
        tip={t.newWorkTip}
        testId="tile-new-work"
        value={<Figure value={headline.newWork} usage={totals} types={NEW_WORK_TYPES} />}
        sublabel={newWorkExact ? `${newWorkExact} · ${t.newWorkSub}` : t.newWorkSub}
      />
      <StatCard
        label={t.total}
        tip={t.totalTip}
        testId="tile-total"
        value={<Figure value={headline.totalProcessed} usage={totals} types={TOTAL_TYPES} />}
        sublabel={totalExact ? `${totalExact} · ${t.totalSub}` : t.totalSub}
      />
      <StatCard
        label={t.share}
        tip={t.shareTip}
        testId="tile-share"
        value={<Share headline={headline} />}
        sublabel={<span data-testid="share-why">{t.shareWhy}</span>}
      />
    </div>
  );
}
