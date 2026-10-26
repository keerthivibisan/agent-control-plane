import { ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { GridIcon, PlusSmallIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { ALL_PROJECTS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { AcrossProjects } from './AcrossProjects';
import { RUNNING_LIMIT, runningByProject } from './project-bits';
import { ProjectCard } from './ProjectCard';

const C = ALL_PROJECTS_COPY;

/**
 * `#/projects`, the cross-project home (docs/history/redesign/README.md §3): one card per project,
 * New project, and below them what Claude Code sessions do across all projects (the former
 * Overview).
 */
export function AllProjectsPage() {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const active = useApiQuery(
    paths.sessions({ status: 'active', limit: RUNNING_LIMIT }),
    schemas.sessionPage,
  );
  const running = runningByProject(active.error ? undefined : active.data);
  const add = (
    <ButtonLink href={href.newProject()} variant="primary">
      <PlusSmallIcon size={16} />
      {C.newProject}
    </ButtonLink>
  );
  return (
    <div>
      <PageHeader title={C.title} description={C.description} actions={add} />
      <QueryView query={projects}>
        {(list) =>
          list.length === 0 ? (
            <Card testId="get-started">
              <EmptyState
                icon={<GridIcon size={22} />}
                title={C.empty.title}
                text={C.empty.text}
                action={add}
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-10">
              <ul
                aria-label={C.cardsLabel}
                className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3"
              >
                {list.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    runningSessions={running === null ? null : (running.get(p.id) ?? 0)}
                  />
                ))}
              </ul>
              <AcrossProjects />
            </div>
          )
        }
      </QueryView>
    </div>
  );
}
