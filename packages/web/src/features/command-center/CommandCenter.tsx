import { SessionStatusSchema } from '@acp/core';
import type { OverviewDto, SessionSummaryDto } from '@acp/core/api';
import { EventList } from '../../components/EventList';
import { PageHeader, Panel } from '../../components/Panel';
import { QueryView } from '../../components/QueryView';
import { SessionName, SessionTable } from '../../components/SessionTable';
import { StatusPill } from '../../components/StatusPill';
import { Time } from '../../components/Time';
import { UsageTotals } from '../../components/UsageTotals';
import { paths, schemas } from '../../lib/api';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { CandidateRoots } from './CandidateRoots';
import { CapabilitiesPanel, HooksStatus } from './CapabilitiesPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { LatestSnapshots } from './LatestSnapshots';
import { RegisterProjectForm } from './RegisterProjectForm';

function Stat({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <>
      <div className="text-[11px] text-dim">{label}</div>
      <div className="font-mono text-xl tabular-nums">{formatCount(value)}</div>
    </>
  );
  return to ? (
    <a
      href={to}
      className="block rounded border border-line bg-panel px-3 py-2 text-ink no-underline hover:bg-sunken"
    >
      {body}
    </a>
  ) : (
    <div className="rounded border border-line bg-panel px-3 py-2">{body}</div>
  );
}

function StatusCounts({ counts }: { counts: OverviewDto['sessionsByStatus'] }) {
  return (
    <div className="rounded border border-line bg-panel px-3 py-2" data-testid="sessions-by-status">
      <div className="mb-1 text-[11px] text-dim">Sessions by status (derived)</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SessionStatusSchema.options.map((s) => (
          <a
            key={s}
            href={href.sessions({ status: s })}
            className="flex items-center gap-1.5 text-ink no-underline"
            data-status-count={s}
          >
            <StatusPill status={s} />
            <span className="font-mono tabular-nums">{formatCount(counts[s])}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function NeedsAttention({ sessions }: { sessions: readonly SessionSummaryDto[] }) {
  const caps = useApiQuery(paths.capabilities(), schemas.capabilities);
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-dim italic">No session is waiting for input.</p>
        {caps.data && !caps.data.hooks.receivedAny ? <HooksStatus hooks={caps.data.hooks} /> : null}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5" data-testid="needs-attention">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-start gap-2">
          <SessionName session={s} />
          <span className="ml-auto flex shrink-0 flex-col items-end gap-0.5">
            <StatusPill status={s.status} />
            <span className="text-[11px] text-dim">
              notified <Time iso={s.lastAttentionAt} fallback="(time unknown)" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function NoProjects({ candidateRootCount }: { candidateRootCount: number }) {
  return (
    <Panel title="Get started: register a project">
      <div className="flex flex-col gap-3">
        <p>
          Sessions are ingested only for <strong>registered project roots</strong>: a session
          belongs to the project whose root contains the directory it was started in. Nothing
          outside a registered root is read. Register a repository root by absolute path
          {candidateRootCount > 0 ? ', or pick one of the discovered roots below' : ''}.
        </p>
        <RegisterProjectForm />
        <div>
          <h3 className="mb-1 text-xs font-semibold text-dim">
            Discovered roots ({formatCount(candidateRootCount)})
          </h3>
          <CandidateRoots />
        </div>
      </div>
    </Panel>
  );
}

/** `#/`: what is happening right now, from GET /api/overview. */
export function CommandCenter() {
  const overview = useApiQuery(paths.overview(), schemas.overview);
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const projectNames = new Map((projects.data ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Command Center" />
      <QueryView query={overview} loading="Loading overview…">
        {(o) => (
          <>
            {o.projectCount === 0 ? <NoProjects candidateRootCount={o.candidateRootCount} /> : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_1fr]">
              <Stat label="Projects" value={o.projectCount} />
              <Stat label="Discovered roots (unregistered)" value={o.candidateRootCount} />
              <StatusCounts counts={o.sessionsByStatus} />
            </div>
            <UsageTotals
              usage={o.totals}
              title="Total usage"
              description="Sum of every session's direct usage, per category (subagent usage is counted once, in the subagent's own session). Categories are priced differently and are not added together. Provider-reported cost is per session and never summed; see the latest provider snapshots below."
            />
            <LatestSnapshots snapshots={o.latestSnapshots} />
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              <Panel title={`Needs attention (${formatCount(o.needsAttention.length)})`}>
                <NeedsAttention sessions={o.needsAttention} />
              </Panel>
              <Panel
                title={`Active sessions (${formatCount(o.activeSessions.length)})`}
                className="xl:col-span-2"
                actions={<a href={href.sessions({ status: 'active' })}>explore</a>}
              >
                <SessionTable sessions={o.activeSessions} projectNames={projectNames} />
              </Panel>
            </div>
            <Panel title="Recent events">
              <EventList events={o.recentEvents} />
            </Panel>
            {o.projectCount > 0 ? (
              <details className="rounded border border-line bg-panel px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold tracking-wide text-dim uppercase">
                  Register another project ({formatCount(o.candidateRootCount)} discovered roots)
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                  <RegisterProjectForm />
                  <CandidateRoots />
                </div>
              </details>
            ) : null}
          </>
        )}
      </QueryView>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <CapabilitiesPanel />
        <DiagnosticsPanel />
      </div>
    </div>
  );
}
