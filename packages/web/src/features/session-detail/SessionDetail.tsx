import type { SessionDetailDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { ButtonLink } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { ShortId } from '../../components/ShortId';
import { StatusBadge } from '../../components/StatusBadge';
import { paths, schemas } from '../../lib/api';
import { PAGES, SESSION_DETAIL_COPY, SESSIONS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { relationshipsHref } from '../sessions/explorer-params';
import { sessionName } from '../sessions/session-bits';
import { ActivityFeed } from './ActivityFeed';
import { CostCard } from './CostCard';
import { FamilyCard, RelatedSessionsCard } from './RelatedCards';
import { TechnicalDetails } from './TechnicalDetails';
import { TokensCard } from './TokensCard';

const COPY = SESSION_DETAIL_COPY;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** The facts strip under the title: status, project, times, model(s), id. */
function Facts({ s }: { s: SessionDetailDto }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const projectName = projects.data?.find((p) => p.id === s.projectId)?.name;
  return (
    <dl
      className="mb-6 flex flex-wrap gap-x-10 gap-y-4 rounded-card border border-line bg-panel px-5 py-4 shadow-card"
      data-testid="session-facts"
    >
      <Fact label={COPY.status}>
        <StatusBadge status={s.status} />
      </Fact>
      <Fact label={COPY.project}>
        {s.projectId ? (
          <a href={href.project(s.projectId)}>{projectName ?? s.projectId}</a>
        ) : (
          <span className="text-dim">{COPY.noProject}</span>
        )}
      </Fact>
      <Fact label={COPY.started}>
        <RelativeTime iso={s.firstSeenAt} />
      </Fact>
      <Fact label={COPY.lastActivity}>
        <RelativeTime iso={s.lastEventAt} fallback={SESSIONS_COPY.table.noActivity} />
      </Fact>
      <Fact label={COPY.models}>
        {s.models.length > 0 ? (
          <span className="font-mono text-caption break-all">{s.models.join(', ')}</span>
        ) : (
          <span className="text-unavailable">{COPY.noModel}</span>
        )}
      </Fact>
      <Fact label={COPY.id}>
        <ShortId id={s.id} label="session id" />
      </Fact>
    </dl>
  );
}

function Loaded({ s }: { s: SessionDetailDto }) {
  // One request feeds the helper list and the names of related sessions.
  const tree = useApiQuery(paths.sessionTree(s.id), schemas.sessionTree);
  return (
    <div>
      <PageHeader
        eyebrow={<a href={href.sessions()}>← {COPY.back}</a>}
        title={sessionName(s)}
        description={PAGES.session.description}
        actions={<ButtonLink href={relationshipsHref(s.id)}>{COPY.seeRelations}</ButtonLink>}
      />
      <Facts s={s} />
      <div className="flex flex-col gap-6">
        <TokensCard s={s} />
        <CostCard snapshot={s.latestSnapshot} />
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <FamilyCard s={s} tree={tree} />
          </div>
          <RelatedSessionsCard s={s} tree={tree.data} />
        </div>
        <ActivityFeed sessionId={s.id} />
        <TechnicalDetails s={s} />
      </div>
    </div>
  );
}

/** `#/sessions/:id`: what happened in one session. Keyed by id in App, so no state leaks. */
export function SessionDetail({ id }: { id: string }) {
  const query = useApiQuery(paths.session(id), schemas.session);
  return (
    <QueryView query={query} loading={COPY.loading}>
      {(s) => <Loaded s={s} />}
    </QueryView>
  );
}
