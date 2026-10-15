import { ButtonLink } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { BoardPage } from '../features/board/BoardPage';
import { CommandCenter } from '../features/command-center/CommandCenter';
import { ControlPanel } from '../features/control/ControlPanel';
import { DataHealthPage } from '../features/health/DataHealthPage';
import { ProjectPage } from '../features/project/ProjectPage';
import { ProjectsList } from '../features/projects/ProjectsList';
import { SessionDetail } from '../features/session-detail/SessionDetail';
import { SessionExplorer } from '../features/sessions/SessionExplorer';
import { SetupPage } from '../features/setup/SetupPage';
import { EMPTY, PAGES } from '../lib/copy';
import { ApiProvider, useQueryStore } from '../lib/query';
import type { QueryStore } from '../lib/query-store';
import { href, useRoute, type Route } from '../lib/router';
import { browserEventSource, useEventStream, type EventSourceFactory } from '../lib/useEventStream';
import { UsageAnalytics } from '../features/usage/UsageAnalytics';
import { Shell } from './Shell';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <CommandCenter />;
    case 'sessions':
      return <SessionExplorer search={route.params} />;
    case 'session':
      return <SessionDetail key={route.id} id={route.id} />;
    case 'projects':
      return <ProjectsList />;
    case 'project':
      return <ProjectPage key={route.id} id={route.id} />;
    case 'setup':
      return <SetupPage />;
    case 'health':
      return <DataHealthPage />;
    case 'usage':
      return <UsageAnalytics search={route.params} />;
    case 'control':
      return <ControlPanel key={route.runId ?? ''} runId={route.runId} />;
    case 'board':
      return <BoardPage key={route.projectId ?? ''} projectId={route.projectId} />;
    case 'not-found':
      return (
        <EmptyState
          title={EMPTY.notFound.title}
          text={EMPTY.notFound.text}
          action={
            <ButtonLink href={href.home()} variant="primary">
              Go to {PAGES.overview.title}
            </ButtonLink>
          }
        />
      );
  }
}

function Root({ eventSource }: { eventSource: EventSourceFactory | null }) {
  const route = useRoute();
  const stream = useEventStream(useQueryStore(), eventSource);
  return (
    <Shell route={route} stream={stream}>
      <Screen route={route} />
    </Shell>
  );
}

export function App({
  store,
  eventSource = browserEventSource,
}: {
  store: QueryStore;
  eventSource?: EventSourceFactory | null;
}) {
  return (
    <ApiProvider store={store}>
      <Root eventSource={eventSource} />
    </ApiProvider>
  );
}
