import type { SessionStatus } from '@acp/core';
import type { OverviewDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SectionHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { StatCard } from '../../components/StatCard';
import { StatusBadge } from '../../components/StatusBadge';
import { TokenBreakdown } from '../../components/TokenBreakdown';
import { paths, schemas } from '../../lib/api';
import { ALL_PROJECTS_COPY, EMPTY, OVERVIEW_COPY, STATUS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { ActivityFeed } from './ActivityFeed';
import { CostBySession } from './CostBySession';
import { sessionName, SessionRows } from './SessionRows';

/** The four everyday statuses always show; "Unknown" only when some session has it. */
const MAIN_STATUSES: readonly SessionStatus[] = ['active', 'idle', 'stale', 'ended'];

function StatusCounts({ counts }: { counts: OverviewDto['sessionsByStatus'] }) {
  const statuses = counts.unknown > 0 ? [...MAIN_STATUSES, 'unknown' as const] : MAIN_STATUSES;
  return (
    <Card title={OVERVIEW_COPY.statusCard.title} tip={OVERVIEW_COPY.statusCard.description}>
      <ul
        data-testid="sessions-by-status"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label={OVERVIEW_COPY.statusCard.title}
      >
        {statuses.map((s) => (
          <li
            key={s}
            data-status-count={s}
            aria-label={`${STATUS_COPY[s].word}: ${OVERVIEW_COPY.sessions(counts[s])}`}
            className="min-w-0 rounded-control border border-line bg-sunken/40 px-4 py-3"
          >
            <StatusBadge status={s} withTip={false} />
            <div className="mt-1 text-title font-semibold tabular-nums">
              {OVERVIEW_COPY.sessions(counts[s])}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Lists({
  o,
  projectNames,
  hooksReceived,
}: {
  o: OverviewDto;
  projectNames: ReadonlyMap<string, string>;
  /**
   * Undefined while capabilities load, and in demo mode (sample data never accepts hooks): no
   * "set up live updates" hint unless it would help.
   */
  hooksReceived: boolean | undefined;
}) {
  const noHooks = hooksReceived === false;
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <Card title={OVERVIEW_COPY.running.title} tip={STATUS_COPY.active.tip} testId="running-now">
        {o.activeSessions.length === 0 ? (
          <EmptyState compact title={EMPTY.running.title} text={EMPTY.running.text} />
        ) : (
          <SessionRows
            sessions={o.activeSessions}
            projectNames={projectNames}
            label={OVERVIEW_COPY.running.title}
          />
        )}
      </Card>
      <Card
        title={OVERVIEW_COPY.waiting.title}
        tip={OVERVIEW_COPY.waiting.description}
        testId="waiting-for-you"
      >
        {o.needsAttention.length > 0 ? (
          <SessionRows
            sessions={o.needsAttention}
            projectNames={projectNames}
            label={OVERVIEW_COPY.waiting.title}
            testId="needs-attention"
            timeOf={(s) => (
              <>
                {OVERVIEW_COPY.waiting.asked} <RelativeTime iso={s.lastAttentionAt} />
              </>
            )}
          />
        ) : noHooks ? (
          <EmptyState
            compact
            testId="hooks-off"
            title={OVERVIEW_COPY.waiting.noHooksTitle}
            text={OVERVIEW_COPY.waiting.noHooksText}
            action={<a href={href.setup()}>{OVERVIEW_COPY.waiting.noHooksAction}</a>}
          />
        ) : (
          <EmptyState compact title={EMPTY.attention.title} text={EMPTY.attention.text} />
        )}
      </Card>
    </div>
  );
}

function Summary({
  o,
  projectNames,
  hooksReceived,
}: {
  o: OverviewDto;
  projectNames: ReadonlyMap<string, string>;
  hooksReceived: boolean | undefined;
}) {
  // Names the overview already has, so activity lines can say which session acted.
  const sessionNames = new Map<string, string>();
  for (const s of o.latestSnapshots) if (s.title !== null) sessionNames.set(s.sessionId, s.title);
  for (const s of [...o.activeSessions, ...o.needsAttention])
    sessionNames.set(s.id, sessionName(s));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          testId="stat-running"
          label={OVERVIEW_COPY.stats.running.label}
          tip={OVERVIEW_COPY.stats.running.tip}
          value={OVERVIEW_COPY.sessions(o.sessionsByStatus.active)}
        />
        <StatCard
          testId="stat-need-you"
          label={OVERVIEW_COPY.stats.needYou.label}
          tip={OVERVIEW_COPY.stats.needYou.tip}
          value={OVERVIEW_COPY.sessions(o.needsAttention.length)}
          sublabel={
            hooksReceived === false && o.needsAttention.length === 0
              ? OVERVIEW_COPY.waiting.noHooksTitle
              : undefined
          }
        />
        <StatCard
          testId="stat-projects"
          label={OVERVIEW_COPY.stats.projects.label}
          tip={OVERVIEW_COPY.stats.projects.tip}
          value={OVERVIEW_COPY.folders(o.projectCount)}
        />
      </div>
      <StatusCounts counts={o.sessionsByStatus} />
      <Card title={OVERVIEW_COPY.tokens.title} tip={OVERVIEW_COPY.tokens.description} testId="tokens-used">
        <TokenBreakdown usage={o.totals} label={OVERVIEW_COPY.tokens.title} />
      </Card>
      <Lists o={o} projectNames={projectNames} hooksReceived={hooksReceived} />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <CostBySession snapshots={o.latestSnapshots} />
        <ActivityFeed events={o.recentEvents} sessionNames={sessionNames} />
      </div>
    </div>
  );
}

/**
 * The cross-project part of All projects (it replaces the Overview page, docs/redesign/README.md
 * §3): Claude Code sessions in every project, from GET /api/overview.
 */
export function AcrossProjects() {
  const overview = useApiQuery(paths.overview(), schemas.overview);
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const caps = useApiQuery(paths.capabilities(), schemas.capabilities);
  const projectNames = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  return (
    <section aria-labelledby="across-projects" data-testid="across-projects">
      <SectionHeader
        id="across-projects"
        title={ALL_PROJECTS_COPY.across.title}
        tip={ALL_PROJECTS_COPY.across.tip}
      />
      {/* The hooks hint comes from capabilities; its failure is shown, not hidden. */}
      {caps.error ? (
        <div className="mb-4">
          <ErrorNotice error={caps.error} />
        </div>
      ) : null}
      <QueryView query={overview}>
        {(o) => (
          <Summary
            o={o}
            projectNames={projectNames}
            hooksReceived={
              caps.data === undefined || caps.data.mode === 'demo'
                ? undefined
                : caps.data.hooks.receivedAny
            }
          />
        )}
      </QueryView>
    </section>
  );
}
