import type { SessionSummaryDto } from '@acp/core/api';
import { PageHeader, Panel } from '../../components/Panel';
import { Pager, useCursorStack } from '../../components/Pager';
import { QueryView } from '../../components/QueryView';
import { SessionTable } from '../../components/SessionTable';
import { paths, schemas } from '../../lib/api';
import { shortId } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { navigate } from '../../lib/router';
import {
  explorerHref,
  readExplorerParams,
  toSessionFilters,
  type ExplorerParams,
} from './explorer-params';
import { ConcurrencyTimeline } from './ConcurrencyTimeline';
import { Filters } from './Filters';
import { SessionGraph } from './SessionGraph';

const PAGE_SIZE = 50;

function ViewTabs({ params }: { params: ExplorerParams }) {
  const view = params.view ?? 'graph';
  const tab = (v: 'graph' | 'timeline', label: string) => (
    <a
      href={explorerHref({ ...params, view: v })}
      aria-current={view === v ? 'page' : undefined}
      className={`rounded px-1.5 text-[11px] no-underline ${view === v ? 'bg-sunken font-semibold text-ink' : 'text-dim'}`}
    >
      {label}
    </a>
  );
  return (
    <>
      {tab('graph', 'tree graph')}
      {tab('timeline', 'concurrency timeline')}
    </>
  );
}

function SelectedView({
  params,
  sessions,
}: {
  params: ExplorerParams;
  sessions: readonly SessionSummaryDto[];
}) {
  if (params.view === 'timeline') {
    return <ConcurrencyTimeline sessions={sessions} />;
  }
  if (!params.root) {
    return (
      <p className="text-dim italic">
        Pick a session&apos;s <strong>graph</strong> button to see its subagent and continuation
        tree.
      </p>
    );
  }
  // Remount per root so collapse state never leaks between trees.
  return <SessionGraph key={params.root} sessionId={params.root} />;
}

function SessionList({ params }: { params: ExplorerParams }) {
  const pager = useCursorStack();
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const projectNames = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const page = useApiQuery(
    paths.sessions({ ...toSessionFilters(params), cursor: pager.cursor, limit: PAGE_SIZE }),
    schemas.sessionPage,
  );
  return (
    <QueryView query={page} loading="Loading sessions…">
      {(p) => (
        <div className="flex flex-col gap-3">
          <Panel
            title="Sessions"
            actions={
              <Pager
                pageNumber={pager.pageNumber}
                nextCursor={p.page.nextCursor}
                onNext={pager.next}
                onPrev={pager.prev}
                onFirst={pager.first}
                fetching={page.fetching}
              />
            }
          >
            <SessionTable
              sessions={p.items}
              projectNames={projectNames}
              selectedId={params.root ?? null}
              onSelect={(id) => navigate(explorerHref({ ...params, root: id, view: 'graph' }))}
            />
          </Panel>
          <Panel
            title={
              params.view !== 'timeline' && params.root
                ? `Tree of ${shortId(params.root)}`
                : 'Relationships and concurrency'
            }
            actions={<ViewTabs params={params} />}
          >
            <SelectedView params={params} sessions={p.items} />
          </Panel>
        </div>
      )}
    </QueryView>
  );
}

/** `#/sessions`: filterable session list, tree graph for a selected root, concurrency timeline. */
export function SessionExplorer({ search }: { search: URLSearchParams }) {
  const params = readExplorerParams(search);
  const filterKey = JSON.stringify(toSessionFilters(params));
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Session Explorer">
        <span className="text-[11px] text-dim">
          Usage columns are direct usage; a session&apos;s aggregate (with subagents) is in the
          graph and on its detail page.
        </span>
      </PageHeader>
      <Filters key={`${params.model ?? ''}|${params.q ?? ''}`} params={params} />
      <SessionList key={filterKey} params={params} />
    </div>
  );
}
