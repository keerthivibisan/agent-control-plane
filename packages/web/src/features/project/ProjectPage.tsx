import type { ProjectDto, SessionSummaryDto } from '@acp/core/api';
import { ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { SessionsIcon } from '../../components/icons';
import { useCursorStack } from '../../components/Pager';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { StatusBadge } from '../../components/StatusBadge';
import { TokenValue } from '../../components/TokenValue';
import { paths, schemas } from '../../lib/api';
import { PAGES, PROJECT_PAGE, PROJECTS_PAGE } from '../../lib/copy';
import { sessionLabel } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { FolderPath } from '../projects/ProjectsList';
import { TokenStats } from '../usage/TokenStats';
import { usageHref } from '../usage/usage-params';
import { SessionsPager } from './SessionsPager';

/** Two short lines with units: what the session sent and got back, then its prompt-cache use. */
function SessionTokens({ s }: { s: SessionSummaryDto }) {
  const t = s.directUsage.tokens;
  return (
    <span className="inline-flex flex-col gap-0.5 lg:items-end">
      <span className="whitespace-nowrap">
        <TokenValue value={t.input} type="input" compact />
        <span className="text-dim"> · </span>
        <TokenValue value={t.output} type="output" compact />
      </span>
      <span className="text-caption whitespace-nowrap text-dim">
        <TokenValue value={t.cacheCreation} type="cacheCreation" compact />
        {' · '}
        <TokenValue value={t.cacheRead} type="cacheRead" compact />
      </span>
    </span>
  );
}

const c = PROJECT_PAGE.sessions.columns;
const SESSION_COLUMNS: readonly Column<SessionSummaryDto>[] = [
  {
    key: 'session',
    label: c.session,
    className: 'min-w-0 lg:max-w-[22rem]',
    cell: (s) => (
      <span className="flex min-w-0 flex-col">
        <a href={href.session(s.id)} className="block truncate font-medium">
          {sessionLabel(s)}
        </a>
        {s.providerAgentId !== null ? (
          <span className="text-caption text-dim">{PROJECT_PAGE.sessions.isHelper}</span>
        ) : null}
      </span>
    ),
  },
  {
    key: 'status',
    label: c.status,
    cell: (s) => <StatusBadge status={s.status} withTip={false} />,
  },
  {
    key: 'helpers',
    label: c.helpers,
    cell: (s) => (
      <span className={s.childCount === 0 ? 'text-dim' : ''}>
        {PROJECT_PAGE.sessions.helpers(s.childCount)}
      </span>
    ),
  },
  {
    key: 'tokens',
    label: c.tokens,
    align: 'right',
    cell: (s) => <SessionTokens s={s} />,
  },
  {
    key: 'last',
    label: c.lastActivity,
    cell: (s) => <RelativeTime iso={s.lastEventAt} fallback={PROJECTS_PAGE.noActivity} />,
  },
];

function ProjectUsage({ id }: { id: string }) {
  const query = useApiQuery(
    paths.usageSummary({ groupBy: 'session', projectId: id }),
    schemas.usageSummary,
  );
  return (
    <section className="flex flex-col gap-3" aria-labelledby="project-tokens-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="project-tokens-title" className="text-title font-semibold">
            {PROJECT_PAGE.tokens.title}
          </h2>
          <p className="text-dim">{PROJECT_PAGE.tokens.description}</p>
        </div>
        <a href={usageHref({ groupBy: 'day', projectId: id })}>{PROJECT_PAGE.seeTokens}</a>
      </div>
      <QueryView query={query}>
        {(s) => (
          <TokenStats usage={s.totals} label={PROJECT_PAGE.tokens.title} testId="project-usage" />
        )}
      </QueryView>
    </section>
  );
}

function ProjectSessions({ id }: { id: string }) {
  const pager = useCursorStack();
  const page = useApiQuery(paths.projectSessions(id, pager.cursor), schemas.sessionPage);
  const showPager =
    page.data !== undefined && (pager.pageNumber > 1 || page.data.page.nextCursor !== null);
  return (
    <Card
      title={PROJECT_PAGE.sessions.title}
      padded={false}
      actions={
        showPager && page.data ? (
          <SessionsPager
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
      <div className="overflow-x-auto px-1 pb-1">
        <QueryView query={page}>
          {(p) => (
            <DataTable
              label={PROJECT_PAGE.sessions.title}
              columns={SESSION_COLUMNS}
              rows={p.items}
              rowKey={(s) => s.id}
              rowAttributes={(s) => ({ 'data-session-id': s.id })}
              empty={
                <EmptyState
                  compact
                  icon={<SessionsIcon size={18} />}
                  title={PROJECT_PAGE.sessions.empty.title}
                  text={PROJECT_PAGE.sessions.empty.text}
                />
              }
            />
          )}
        </QueryView>
      </div>
    </Card>
  );
}

function Header({ project }: { project: ProjectDto }) {
  return (
    <PageHeader
      eyebrow={<a href={href.projects()}>← {PROJECT_PAGE.back}</a>}
      title={project.name}
      description={
        <span className="flex flex-col gap-1">
          <span>{PAGES.project.description}</span>
          <span className="flex flex-wrap items-center gap-x-5 gap-y-1 text-caption">
            <span className="flex min-w-0 items-center gap-1.5">
              <span>{PROJECT_PAGE.folder}</span>
              <FolderPath path={project.rootPath} />
            </span>
            <span className="flex items-center gap-1.5">
              <span>{PROJECT_PAGE.lastActivity}</span>
              <span className="text-ink">
                <RelativeTime iso={project.lastEventAt} fallback={PROJECTS_PAGE.noActivity} />
              </span>
            </span>
          </span>
        </span>
      }
      actions={
        <ButtonLink href={usageHref({ groupBy: 'session', projectId: project.id })}>
          {PROJECT_PAGE.openInTokens}
        </ButtonLink>
      }
    />
  );
}

/** `#/projects/:id`. Keyed by id in App so pagination never leaks between projects. */
export function ProjectPage({ id }: { id: string }) {
  const project = useApiQuery(paths.project(id), schemas.project);
  return (
    <QueryView query={project}>
      {(p) => (
        <div>
          <Header project={p} />
          <div className="flex flex-col gap-8">
            <ProjectUsage id={p.id} />
            <ProjectSessions id={p.id} />
          </div>
        </div>
      )}
    </QueryView>
  );
}
