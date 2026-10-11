import type { ProjectDto, SessionSummaryDto } from '@acp/core/api';
import { ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ProjectsIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { Tooltip } from '../../components/Tooltip';
import { paths, schemas } from '../../lib/api';
import { EMPTY, PAGES, PROJECTS_PAGE } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';

/** The API's page-size cap; one page of running sessions is enough to count them per project. */
const RUNNING_LIMIT = 200;

/**
 * Running sessions per project, or `null` when the count isn't known: still loading, failed, or
 * more than one page (a partial count would understate it).
 */
export function runningByProject(
  page: { items: readonly SessionSummaryDto[]; page: { nextCursor: string | null } } | undefined,
): ReadonlyMap<string, number> | null {
  if (page === undefined || page.page.nextCursor !== null) return null;
  const counts = new Map<string, number>();
  for (const s of page.items) {
    if (s.projectId !== null) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);
  }
  return counts;
}

/** A long folder path, cut at the start of the line with the full path in a tooltip. */
export function FolderPath({ path }: { path: string }) {
  return (
    <Tooltip content={path} className="block min-w-0">
      <span className="block max-w-[28rem] truncate font-mono text-caption text-dim" dir="ltr">
        {path}
      </span>
    </Tooltip>
  );
}

function columns(running: ReadonlyMap<string, number> | null): Column<ProjectDto>[] {
  const c = PROJECTS_PAGE.columns;
  const cols: Column<ProjectDto>[] = [
    {
      key: 'name',
      label: c.project,
      cell: (p) => (
        <a href={href.project(p.id)} className="font-medium">
          {p.name}
        </a>
      ),
    },
    {
      key: 'folder',
      label: c.folder,
      className: 'min-w-0 lg:max-w-[28rem]',
      cell: (p) => <FolderPath path={p.rootPath} />,
    },
    {
      key: 'sessions',
      label: c.sessions,
      align: 'right',
      cell: (p) => <span className="tabular-nums">{PROJECTS_PAGE.sessions(p.sessionCount)}</span>,
    },
  ];
  if (running !== null) {
    cols.push({
      key: 'running',
      label: c.running,
      align: 'right',
      cell: (p) => {
        const n = running.get(p.id) ?? 0;
        return (
          <span className={`tabular-nums ${n === 0 ? 'text-dim' : ''}`} data-running={n}>
            {PROJECTS_PAGE.running(n)}
          </span>
        );
      },
    });
  }
  cols.push({
    key: 'last',
    label: c.lastActivity,
    cell: (p) => <RelativeTime iso={p.lastEventAt} fallback={PROJECTS_PAGE.noActivity} />,
  });
  return cols;
}

/** `#/projects`: every registered project folder. */
export function ProjectsList() {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const active = useApiQuery(
    paths.sessions({ status: 'active', limit: RUNNING_LIMIT }),
    schemas.sessionPage,
  );
  const running = runningByProject(active.error ? undefined : active.data);
  const add = (
    <ButtonLink href={href.setup()} variant="primary">
      {PROJECTS_PAGE.add}
    </ButtonLink>
  );
  return (
    <div>
      <PageHeader
        title={PAGES.projects.title}
        description={PAGES.projects.description}
        actions={add}
      />
      <QueryView query={projects}>
        {(list) =>
          list.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ProjectsIcon size={22} />}
                title={EMPTY.projects.title}
                text={EMPTY.projects.text}
                action={add}
              />
            </Card>
          ) : (
            <Card padded={false}>
              <div className="overflow-x-auto px-1 pb-1">
                <DataTable
                  label={PROJECTS_PAGE.tableLabel}
                  columns={columns(running)}
                  rows={list}
                  rowKey={(p) => p.id}
                  rowAttributes={(p) => ({ 'data-project-id': p.id })}
                />
              </div>
            </Card>
          )
        }
      </QueryView>
    </div>
  );
}
