import { ButtonLink } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { AllProjectsPage } from '../features/all-projects/AllProjectsPage';
import { BoardPage } from '../features/board/BoardPage';
import { ControlPanel } from '../features/control/ControlPanel';
import { HarnessPage } from '../features/harness/HarnessPage';
import { NewProjectWizard } from '../features/project-setup/NewProjectWizard';
import { ProjectSettings } from '../features/project-setup/ProjectSettings';
import { SessionDetail } from '../features/session-detail/SessionDetail';
import { SessionExplorer } from '../features/sessions/SessionExplorer';
import { SkillsPage } from '../features/skills/SkillsPage';
import { TicketPage } from '../features/ticket/TicketPage';
import { TokensPage } from '../features/tokens/TokensPage';
import { WorkflowPage } from '../features/workflow/WorkflowPage';
import { EMPTY, SHELL_COPY } from '../lib/copy';
import { ApiProvider, useQueryStore } from '../lib/query';
import type { QueryStore } from '../lib/query-store';
import { href, useRoute, type Route } from '../lib/router';
import { browserEventSource, useEventStream, type EventSourceFactory } from '../lib/useEventStream';
import { HealthScreen } from './HealthScreen';
import { isProjectPageAvailable } from './project-pages';
import { LegacyRedirect } from './Redirect';
import { Shell } from './Shell';

function NotFound() {
  return (
    <EmptyState
      title={EMPTY.notFound.title}
      text={EMPTY.notFound.text}
      action={
        <ButtonLink href={href.projects()} variant="primary">
          {SHELL_COPY.notFound.action}
        </ButtonLink>
      }
    />
  );
}

/** The project's filter is the address: the page's own `projectId` parameter is overwritten. */
function scopedParams(params: URLSearchParams, projectId: string): URLSearchParams {
  const out = new URLSearchParams(params);
  out.set('projectId', projectId);
  return out;
}

/**
 * One project page (`#/p/:projectId/<page>`). A page that isn't built yet is "not found" until its
 * WP adds its case here and flips `available` in PROJECT_PAGES (./project-pages.ts).
 */
function ProjectScreen({ route }: { route: Extract<Route, { name: 'project' }> }) {
  if (!isProjectPageAvailable(route.page)) return <NotFound />;
  const { projectId } = route;
  switch (route.page) {
    case 'board':
      return <BoardPage key={projectId} projectId={projectId} />;
    case 'tokens':
      return <TokensPage key={projectId} projectId={projectId} search={route.params} />;
    case 'sessions':
      return <SessionExplorer search={scopedParams(route.params, projectId)} />;
    case 'settings':
      return <ProjectSettings key={projectId} id={projectId} />;
    case 'skills':
      return (
        <SkillsPage
          key={projectId}
          projectId={projectId}
          item={route.item}
          tab={route.params.get('tab') === 'agents' ? 'agents' : 'skills'}
        />
      );
    case 'harness':
      return <HarnessPage key={projectId} projectId={projectId} />;
    case 'workflow':
      return <WorkflowPage key={projectId} projectId={projectId} />;
  }
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'project':
      return <ProjectScreen route={route} />;
    case 'ticket':
      return <TicketPage key={route.id} id={route.id} />;
    case 'run':
      // Phase 3 runs without a ticket keep their page (chat, approvals, review) until
      // "Quick ticket" replaces ad-hoc runs; `runId` null is the start page.
      return <ControlPanel key={route.runId ?? ''} runId={route.runId} />;
    case 'projects':
      return <AllProjectsPage />;
    case 'project-new':
      return <NewProjectWizard />;
    case 'health':
      return <HealthScreen tab={route.tab} />;
    case 'session':
      return <SessionDetail key={route.id} id={route.id} />;
    case 'legacy':
      return <LegacyRedirect legacy={route.legacy} />;
    case 'not-found':
      return <NotFound />;
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
