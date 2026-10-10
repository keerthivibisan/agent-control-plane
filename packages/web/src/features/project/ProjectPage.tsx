import type { ProjectDto } from '@acp/core/api';
import { Pager, useCursorStack } from '../../components/Pager';
import { PageHeader, Panel } from '../../components/Panel';
import { QueryView } from '../../components/QueryView';
import { SessionTable } from '../../components/SessionTable';
import { Time } from '../../components/Time';
import { UsageTotals } from '../../components/UsageTotals';
import { paths, schemas } from '../../lib/api';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { usageHref } from '../usage/usage-params';
import { explorerHref } from '../sessions/explorer-params';

function Metadata({ project }: { project: ProjectDto }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[11px] text-dim">{label}</dt>
      <dd className="font-mono text-xs break-all">{value}</dd>
    </div>
  );
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {row('Root path (registered)', project.rootPath)}
      {row('Sessions associated', project.sessionCount)}
      {row('Last event', <Time iso={project.lastEventAt} fallback="no events" />)}
      {row('Registered', <Time iso={project.createdAt} />)}
      {row('Updated', <Time iso={project.updatedAt} />)}
      {row('Id', project.id)}
    </dl>
  );
}

function ProjectUsage({ id }: { id: string }) {
  const query = useApiQuery(
    paths.usageSummary({ groupBy: 'session', projectId: id }),
    schemas.usageSummary,
  );
  return (
    <QueryView query={query} loading="Loading usage…">
      {(s) => (
        <UsageTotals
          usage={s.totals}
          title="Project usage (sum of DIRECT usage)"
          description="Sums each session's own usage records; a subagent's usage is counted once, under its own session."
          testId="project-usage"
        />
      )}
    </QueryView>
  );
}

function ProjectSessions({ id }: { id: string }) {
  const pager = useCursorStack();
  const page = useApiQuery(paths.projectSessions(id, pager.cursor), schemas.sessionPage);
  return (
    <Panel
      title="Sessions"
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
      <QueryView query={page} loading="Loading sessions…">
        {(p) => <SessionTable sessions={p.items} />}
      </QueryView>
    </Panel>
  );
}

/** `#/projects/:id`. Keyed by id in App so pagination never leaks between projects. */
export function ProjectPage({ id }: { id: string }) {
  const project = useApiQuery(paths.project(id), schemas.project);
  return (
    <QueryView query={project} loading="Loading project…">
      {(p) => (
        <div className="flex flex-col gap-3">
          <PageHeader title={p.name}>
            <a className="text-xs" href={explorerHref({ projectId: p.id })}>
              open in Session Explorer
            </a>
            <a className="text-xs" href={usageHref({ groupBy: 'session', projectId: p.id })}>
              usage analytics
            </a>
            <a className="text-xs" href={href.home()}>
              Command Center
            </a>
          </PageHeader>
          <Panel title="Project">
            <Metadata project={p} />
          </Panel>
          <ProjectUsage id={p.id} />
          <ProjectSessions id={p.id} />
        </div>
      )}
    </QueryView>
  );
}
