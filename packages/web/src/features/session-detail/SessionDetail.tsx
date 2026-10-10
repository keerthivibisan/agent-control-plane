import type { Provenance } from '@acp/core';
import type { SessionDetailDto, UsageSnapshotDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { EstimatedCost } from '../../components/EstimatedCost';
import { EventList } from '../../components/EventList';
import { Pager, useCursorStack } from '../../components/Pager';
import { PageHeader, Panel } from '../../components/Panel';
import { ParentInfo } from '../../components/ParentInfo';
import { ProvenanceBadge } from '../../components/ProvenanceBadge';
import { QueryView } from '../../components/QueryView';
import { StatusPill } from '../../components/StatusPill';
import { Time } from '../../components/Time';
import { TokenCount } from '../../components/TokenCount';
import { UsageComparison } from '../../components/UsageTotals';
import { paths, schemas } from '../../lib/api';
import { sessionLabel, shortId } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { TOKEN_CATEGORIES } from '../../lib/tokens';
import { explorerHref } from '../sessions/explorer-params';

function Row({
  label,
  provenance,
  children,
}: {
  label: string;
  provenance?: Provenance | undefined;
  children: ReactNode;
}) {
  return (
    <tr className="border-b border-line/60 align-top">
      <th className="py-1 pr-3 text-left text-[11px] font-medium whitespace-nowrap text-dim">
        {label}
      </th>
      <td className="min-w-0 py-1 pr-3 font-mono text-xs break-all">{children}</td>
      <td className="py-1">{provenance ? <ProvenanceBadge provenance={provenance} /> : null}</td>
    </tr>
  );
}

const none = <span className="text-dim italic">not reported</span>;

function Metadata({ s }: { s: SessionDetailDto }) {
  return (
    <table className="w-full border-collapse" data-testid="session-metadata">
      <tbody>
        <Row label="Session id">{s.id}</Row>
        <Row label="Provider" provenance="observed">
          {s.provider}
        </Row>
        <Row label="Provider session id" provenance="observed">
          {s.providerSessionId}
        </Row>
        <Row label="Subagent id" provenance="observed">
          {s.providerAgentId ?? <span className="text-dim italic">not a subagent</span>}
        </Row>
        <Row label="Origin">{s.origin}</Row>
        <Row label="Project">
          {s.projectId ? (
            <a href={href.project(s.projectId)}>{s.projectId}</a>
          ) : (
            <span className="text-dim italic">unassigned</span>
          )}
        </Row>
        <Row label="Agent type" provenance="observed">
          {s.agentType ?? none}
        </Row>
        <Row label="Description" provenance="observed">
          {s.description ?? none}
        </Row>
        <Row label="Launch directory" provenance="observed">
          {s.launchCwd ?? none}
        </Row>
        <Row label="Git branch" provenance="observed">
          {s.gitBranch ?? none}
        </Row>
        <Row label="Entrypoint" provenance="observed">
          {s.entrypoint ?? none}
        </Row>
        <Row label="Provider version" provenance="observed">
          {s.providerVersion ?? none}
        </Row>
        <Row label="Models" provenance="observed">
          {s.models.length > 0 ? (
            s.models.join(', ')
          ) : (
            <span className="text-unavailable italic">none observed</span>
          )}
        </Row>
        <Row label="First seen" provenance="observed">
          <Time iso={s.firstSeenAt} />
        </Row>
        <Row label="Last event" provenance="observed">
          <Time iso={s.lastEventAt} fallback="no events" />
        </Row>
        <Row label="Ended" provenance="observed">
          <Time iso={s.endedAt} fallback="no end reported" />
          {s.endReason ? <span className="ml-2 text-dim">({s.endReason})</span> : null}
        </Row>
        <Row label="Needs attention since" provenance="observed">
          <Time iso={s.lastAttentionAt} fallback="no" />
        </Row>
        <Row label="Status" provenance="derived">
          <StatusPill status={s.status} />
        </Row>
        <Row
          label="Parent"
          provenance={s.parent.state === 'known' ? s.parent.provenance : undefined}
        >
          <ParentInfo parent={s.parent} />
        </Row>
      </tbody>
    </table>
  );
}

function Snapshot({ snapshot }: { snapshot: UsageSnapshotDto | null }) {
  if (!snapshot) {
    return (
      <p className="text-dim italic" data-testid="no-snapshot">
        No provider snapshot observed for this session. Cost is unavailable; it is not zero.
      </p>
    );
  }
  const models = Object.entries(snapshot.byModel).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="flex flex-col gap-2" data-testid="snapshot">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          Provider-reported cost: <EstimatedCost cost={snapshot.reportedCostUsd} />
        </span>
        <span className="text-dim">
          scope: <span className="font-mono text-ink">{snapshot.scope}</span>
        </span>
        <span className="text-dim">
          at <Time iso={snapshot.occurredAt} fallback="time unknown" />
        </span>
      </div>
      <p className="text-[11px] text-dim">
        A cumulative snapshot reported by the provider (latest only). It is a running total, never
        added to the usage records above, and its cost is an estimate.
      </p>
      {models.length === 0 ? (
        <p className="text-dim italic">The snapshot lists no per-model tokens.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="text-[11px] text-dim">
              <tr className="border-b border-line">
                <th className="py-1 pr-2 font-medium">Model</th>
                {TOKEN_CATEGORIES.map((c) => (
                  <th key={c.key} className="py-1 pr-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map(([model, tokens]) => (
                <tr key={model} className="border-b border-line/60">
                  <td className="py-1 pr-2 font-mono">{model}</td>
                  {TOKEN_CATEGORIES.map((c) => (
                    <td key={c.key} className="py-1 pr-2 text-right font-mono">
                      <TokenCount value={tokens[c.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SessionEvents({ id }: { id: string }) {
  const pager = useCursorStack();
  const page = useApiQuery(paths.sessionEvents(id, pager.cursor), schemas.eventPage);
  return (
    <Panel
      title="Event timeline (newest first)"
      actions={
        page.data ? (
          <Pager
            pageNumber={pager.pageNumber}
            nextCursor={page.data.page.nextCursor}
            onNext={pager.next}
            onPrev={pager.prev}
            onFirst={pager.first}
            fetching={page.fetching}
          />
        ) : null
      }
    >
      <QueryView query={page} loading="Loading events…">
        {(p) => <EventList events={p.items} showSession={false} />}
      </QueryView>
    </Panel>
  );
}

function Loaded({ s }: { s: SessionDetailDto }) {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={sessionLabel(s)}>
        <StatusPill status={s.status} />
        <span className="font-mono text-[11px] text-dim" title={s.id}>
          {shortId(s.id)}
        </span>
        <a
          className="text-xs"
          href={explorerHref({ root: s.id, view: 'graph' })}
          data-testid="show-in-graph"
        >
          show in graph
        </a>
        {s.origin === 'demo' ? <span className="text-[11px] text-dim">demo data</span> : null}
      </PageHeader>
      <Panel title="Metadata">
        <Metadata s={s} />
        {s.continuationIds.length > 0 ? (
          <p className="mt-2 text-xs" data-testid="continuations">
            Forked into (continuation edges):{' '}
            {s.continuationIds.map((id, i) => (
              <span key={id}>
                {i > 0 ? ', ' : ''}
                <a href={href.session(id)} className="font-mono" title={id}>
                  {shortId(id)}
                </a>
              </span>
            ))}
          </p>
        ) : null}
      </Panel>
      <Panel title="Usage">
        <UsageComparison
          direct={s.directUsage}
          aggregate={s.aggregateUsage}
          ambiguousAttributionCount={s.ambiguousAttributionCount}
        />
      </Panel>
      <Panel title="Latest provider snapshot">
        <Snapshot snapshot={s.latestSnapshot} />
      </Panel>
      <SessionEvents id={s.id} />
    </div>
  );
}

/** `#/sessions/:id`. Keyed by id in App so pagination never leaks between sessions. */
export function SessionDetail({ id }: { id: string }) {
  const query = useApiQuery(paths.session(id), schemas.session);
  return (
    <QueryView query={query} loading="Loading session…">
      {(s) => <Loaded s={s} />}
    </QueryView>
  );
}
