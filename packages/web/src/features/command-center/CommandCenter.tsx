import type { SessionStatus } from '@acp/core';
import type { OverviewDto } from '@acp/core/api';
import { ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { ProjectsIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { StatCard } from '../../components/StatCard';
import { StatusBadge } from '../../components/StatusBadge';
import { TokenBreakdown } from '../../components/TokenBreakdown';
import { paths, schemas } from '../../lib/api';
import { EMPTY, OVERVIEW_COPY, PAGES, STATUS_COPY } from '../../lib/copy';
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
    <Card title={OVERVIEW_COPY.statusCard.title} description={OVERVIEW_COPY.statusCard.description}>
      <ul
        data-testid="sessions-by-status"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label={OVERVIEW_COPY.statusCard.title}
      >
        {statuses.map((s) => (
          <li key={s} className="min-w-0">
            <a
              href={href.sessions({ status: s })}
              data-status-count={s}
              aria-label={`${STATUS_COPY[s].word}: ${OVERVIEW_COPY.sessions(counts[s])}`}
              className="block rounded-control border border-line px-4 py-3 text-ink no-underline transition-colors hover:border-line-strong hover:bg-sunken"
            >
              <StatusBadge status={s} withTip={false} />
              <div className="mt-1 text-title font-semibold tabular-nums">
                {OVERVIEW_COPY.sessions(counts[s])}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GetStarted({ unadded }: { unadded: number }) {
  return (
    <Card testId="get-started">
      <EmptyState
        icon={<ProjectsIcon size={22} />}
        title={OVERVIEW_COPY.getStarted.title}
        text={
          <>
            {OVERVIEW_COPY.getStarted.text}
            {unadded > 0 ? <> {OVERVIEW_COPY.getStarted.found(unadded)}</> : null}
          </>
        }
        action={
          <ButtonLink href={href.setup()} variant="primary">
            {OVERVIEW_COPY.getStarted.action}
          </ButtonLink>
        }
      />
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
      <Card
        title={OVERVIEW_COPY.running.title}
        tip={STATUS_COPY.active.tip}
        description={OVERVIEW_COPY.running.description}
        actions={
          o.activeSessions.length > 0 ? (
            <a href={href.sessions({ status: 'active' })} className="text-caption">
              {OVERVIEW_COPY.running.link}
            </a>
          ) : undefined
        }
        testId="running-now"
      >
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
        description={OVERVIEW_COPY.waiting.description}
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

function Overview({
  o,
  projectNames,
  hooksReceived,
}: {
  o: OverviewDto;
  projectNames: ReadonlyMap<string, string>;
  hooksReceived: boolean | undefined;
}) {
  if (o.projectCount === 0) return <GetStarted unadded={o.candidateRootCount} />;

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
          href={href.sessions({ status: 'active' })}
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
          href={href.projects()}
        />
      </div>
      <StatusCounts counts={o.sessionsByStatus} />
      <Card
        title={OVERVIEW_COPY.tokens.title}
        description={OVERVIEW_COPY.tokens.description}
        actions={
          <a href={href.usage()} className="text-caption">
            {OVERVIEW_COPY.tokens.link}
          </a>
        }
        testId="tokens-used"
      >
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

/** `#/`: what your Claude Code sessions are doing right now, from GET /api/overview. */
export function CommandCenter() {
  const overview = useApiQuery(paths.overview(), schemas.overview);
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const caps = useApiQuery(paths.capabilities(), schemas.capabilities);
  const projectNames = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  return (
    <div>
      <PageHeader title={PAGES.overview.title} description={PAGES.overview.description} />
      {/* Project names and the hooks hint come from these; their failures are shown, not hidden. */}
      {[projects.error, caps.error].map((error) =>
        error ? (
          <div key={error.path} className="mb-4">
            <ErrorNotice error={error} />
          </div>
        ) : null,
      )}
      <QueryView query={overview}>
        {(o) => (
          <Overview
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
    </div>
  );
}
