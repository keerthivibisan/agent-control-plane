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

function NoSessions({ params }: { params: ExplorerParams }) {
  if (hasFilters(params)) {
    return (
      <EmptyState
        title={EMPTY.sessionsFiltered.title}
        text={EMPTY.sessionsFiltered.text}
        action={
          <ButtonLink href={explorerHref({})} variant="secondary">
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
      text={EMPTY.sessions.text}
      action={
        <ButtonLink href={href.setup()} variant="primary">
          {SESSIONS_COPY.table.addProject}
        </ButtonLink>
      }
    />
  );
}

function SessionsBody({ params }: { params: ExplorerParams }) {
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
              empty={<NoSessions params={params} />}
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

/** `#/sessions`: every session in your projects, filters, and how they relate. */
export function SessionExplorer({ search }: { search: URLSearchParams }) {
  const params = readExplorerParams(search);
  // Remount the list (and its page stack) whenever the filters change.
  const filterKey = JSON.stringify(toSessionFilters(params));
  return (
    <div>
      <PageHeader title={PAGES.sessions.title} description={PAGES.sessions.description} />
      <div className="flex flex-col gap-6">
        <Filters key={params.q ?? ''} params={params} />
        <SessionsBody key={filterKey} params={params} />
      </div>
    </div>
  );
}
