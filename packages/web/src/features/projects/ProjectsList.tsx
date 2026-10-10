import type { ProjectDto } from '@acp/core/api';
import { ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ProjectsIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { paths, schemas } from '../../lib/api';
import { EMPTY, PAGES } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';

const COLUMNS: readonly Column<ProjectDto>[] = [
  {
    key: 'name',
    label: 'Project',
    cell: (p) => (
      <a href={href.project(p.id)} className="font-medium">
        {p.name}
      </a>
    ),
  },
  {
    key: 'folder',
    label: 'Folder',
    cell: (p) => <span className="font-mono text-caption break-all text-dim">{p.rootPath}</span>,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    align: 'right',
    cell: (p) => (
      <span className="tabular-nums">
        {formatCount(p.sessionCount)} {p.sessionCount === 1 ? 'session' : 'sessions'}
      </span>
    ),
  },
  {
    key: 'last',
    label: 'Last activity',
    cell: (p) => <RelativeTime iso={p.lastEventAt} fallback="No activity yet" />,
  },
];

/** `#/projects`: every registered project folder. */
export function ProjectsList() {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  return (
    <div>
      <PageHeader
        title={PAGES.projects.title}
        description={PAGES.projects.description}
        actions={
          <ButtonLink href={href.setup()} variant="primary">
            Add a project
          </ButtonLink>
        }
      />
      <QueryView query={projects} loading="Loading projects…">
        {(list) => (
          <Card padded={list.length === 0}>
            <DataTable
              label="Projects"
              columns={COLUMNS}
              rows={list}
              rowKey={(p) => p.id}
              rowAttributes={(p) => ({ 'data-project-id': p.id })}
              empty={
                <EmptyState
                  icon={<ProjectsIcon size={22} />}
                  title={EMPTY.projects.title}
                  text={EMPTY.projects.text}
                  action={
                    <ButtonLink href={href.setup()} variant="primary">
                      Add a project
                    </ButtonLink>
                  }
                />
              }
            />
          </Card>
        )}
      </QueryView>
    </div>
  );
}
