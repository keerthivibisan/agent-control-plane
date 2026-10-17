import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { QueryView } from '../../components/QueryView';
import { RelativeTime } from '../../components/RelativeTime';
import { controlPaths, controlSchemas, paths, schemas } from '../../lib/api';
import { CONTROL_COPY, RUN_STATUS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { StatusWord } from './bits';

const C = CONTROL_COPY.runs;

/** Earlier and ongoing runs (GET /api/runs), newest change first. */
export function RunList() {
  const runs = useApiQuery(controlPaths.runs(), controlSchemas.runs);
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name;
  return (
    <Card title={C.title} description={C.description} testId="run-list">
      <QueryView query={runs} loading={C.loading}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState compact title={C.empty.title} text={C.empty.text} />
          ) : (
            <ul className="-mx-2 flex flex-col">
              {[...list]
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
                .map((r) => (
                  <li
                    key={r.id}
                    className="relative rounded-control px-2 py-2.5 transition-colors hover:bg-hover"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <a
                        href={href.run(r)}
                        className="min-w-0 flex-1 truncate font-medium text-ink no-underline after:absolute after:inset-0 hover:underline"
                      >
                        {r.title}
                      </a>
                      <StatusWord
                        status={RUN_STATUS_COPY[r.status]}
                        value={r.status}
                        withTip={false}
                      />
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-dim">
                      {projectName(r.projectId) ? <span>{projectName(r.projectId)}</span> : null}
                      <span>{CONTROL_COPY.facts.agents(r.agentCount)}</span>
                      {r.pendingApprovals > 0 ? (
                        <span className="font-medium text-warning">
                          {CONTROL_COPY.facts.approvals(r.pendingApprovals)}
                        </span>
                      ) : null}
                      <RelativeTime iso={r.updatedAt} />
                    </div>
                  </li>
                ))}
            </ul>
          )
        }
      </QueryView>
    </Card>
  );
}
