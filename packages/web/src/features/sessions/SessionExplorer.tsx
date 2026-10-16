import { ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { SessionsIcon } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { useCursorStack } from '../../components/Pager';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { EMPTY, PAGES, SESSIONS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import {
  explorerHref,
  hasFilters,
  readExplorerParams,
  toSessionFilters,
  type ExplorerParams,
} from './explorer-params';
import { Filters } from './Filters';
import { HowSessionsRelate } from './HowSessionsRelate';
import { PageButtons } from './PageButtons';
import { SessionList } from './SessionList';

const PAGE_SIZE = 50;

function NoSessions({ params, scope }: { params: ExplorerParams; scope: string | undefined }) {
  if (hasFilters(params, scope)) {
    return (
      <EmptyState
        title={EMPTY.sessionsFiltered.title}
        text={EMPTY.sessionsFiltered.text}
        action={
          <ButtonLink href={explorerHref({ projectId: scope })} variant="secondary">
            {SESSIONS_COPY.filters.clear}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<SessionsIcon size={22} />}
      title={EMPTY.sessions.title}
      text={scope === undefined ? EMPTY.sessions.text : EMPTY.sessions.textInProject}
      action={
        <ButtonLink href={href.setup()} variant="primary">
          {SESSIONS_COPY.table.addProject}
        </ButtonLink>
      }
    />
  );
}

function SessionsBody({ params, scope }: { params: ExplorerParams; scope: string | undefined }) {
  const pager = useCursorStack();
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const projectNames = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const page = useApiQuery(
    paths.sessions({ ...toSessionFilters(params), cursor: pager.cursor, limit: PAGE_SIZE }),
    schemas.sessionPage,
  );
  return (
    <QueryView query={page} loading={SESSIONS_COPY.table.loading}>
      {(p) => (
        <div className="flex flex-col gap-6">
          <Card padded={p.items.length === 0}>
            <SessionList
              sessions={p.items}
              projectNames={projectNames}
              empty={<NoSessions params={params} scope={scope} />}
            />
            {pager.pageNumber > 1 || p.page.nextCursor !== null ? (
              <div className="flex justify-end border-t border-line px-4 py-3">
                <PageButtons
                  pageNumber={pager.pageNumber}
                  nextCursor={p.page.nextCursor}
                  onNext={pager.next}
                  onPrev={pager.prev}
                  fetching={page.fetching}
                />
              </div>
            ) : null}
          </Card>
          {p.items.length > 0 ? <HowSessionsRelate params={params} sessions={p.items} /> : null}
        </div>
      )}
    </QueryView>
  );
}

/**
 * `#/p/:projectId/sessions`: the project's sessions, filters, and how they relate. Without
 * `projectId` (tests, an older address) it lists every project's sessions with a Project filter.
 */
export function SessionExplorer({
  search,
  projectId,
}: {
  search: URLSearchParams;
  /** The project in the address: no Project filter, and the copy says "this project". */
  projectId?: string;
}) {
  const params = readExplorerParams(search);
  // Remount the list (and its page stack) whenever the filters change.
  const filterKey = JSON.stringify(toSessionFilters(params));
  return (
    <div>
      <PageHeader
        title={PAGES.sessions.title}
        description={
          projectId === undefined ? PAGES.sessions.description : PAGES.sessions.inProject
        }
      />
      <div className="flex flex-col gap-6">
        <Filters key={params.q ?? ''} params={params} scopeProjectId={projectId} />
        <SessionsBody key={filterKey} params={params} scope={projectId} />
      </div>
    </div>
  );
}
