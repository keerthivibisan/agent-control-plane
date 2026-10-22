import { tabFromHash } from '../features/ticket/ticket-tabs';
import { SHELL_COPY } from '../lib/copy';
import { href, type Route } from '../lib/router';
import { PROJECT_PAGES, isProjectPageAvailable, type ProjectPageDef } from './project-pages';

/** The sidebar page a route belongs to (a ticket or a run belongs to the board). */
export function activePage(route: Route): ProjectPageDef['id'] | null {
  if (route.name === 'project') return route.page;
  if (route.name === 'ticket' || route.name === 'run' || route.name === 'review') return 'board';
  if (route.name === 'session') return 'sessions';
  return null;
}

/** One step of the top bar's trail after the project: a link, or the page you are on. */
export interface Crumb {
  label: string;
  /** Null for the page you are on. */
  to: string | null;
}

/**
 * The trail after the project switcher: the project page you are on (a ticket or a run is under
 * Board, one session under Sessions). A ticket adds its key once known (`Board / WEB-21`), as the
 * page you are on. Global pages (All projects, Data health, New project) have none: they don't
 * belong to the project the switcher shows.
 */
export function crumbsFor(
  route: Route,
  projectId: string | null,
  ticketKey: string | null = null,
): Crumb[] {
  const label = (id: ProjectPageDef['id']) =>
    PROJECT_PAGES.find((p) => p.id === id)?.label ?? SHELL_COPY.nav.pages[id];
  if (route.name === 'project') {
    if (!isProjectPageAvailable(route.page)) return [];
    if (route.item !== null) {
      return [
        { label: label(route.page), to: href.projectPage(route.projectId, route.page) },
        { label: route.item, to: null },
      ];
    }
    return [{ label: label(route.page), to: null }];
  }
  if (route.name === 'ticket' || route.name === 'review') {
    const board = { label: label('board'), to: href.board(route.projectId) };
    return ticketKey === null ? [board] : [board, { label: ticketKey, to: null }];
  }
  if (route.name === 'run') {
    return [{ label: label('board'), to: href.board(route.projectId) }];
  }
  if (route.name === 'session' && projectId !== null) {
    return [{ label: label('sessions'), to: href.projectPage(projectId, 'sessions') }];
  }
  return [];
}

/** What changes the page, for the page transition: not the query, not the selected item. */
export function pageKey(route: Route): string {
  switch (route.name) {
    case 'project':
      return `project:${route.projectId}:${route.page}`;
    case 'ticket':
      return `ticket:${route.id}`;
    case 'run':
      return `run:${route.runId ?? ''}`;
    case 'review':
      return `review:${route.ticketId}:${route.agentRunId ?? 'branch'}:${route.runId ?? ''}`;
    case 'health':
      return `health:${route.tab}`;
    case 'session':
      return `session:${route.id}`;
    case 'legacy':
      return 'legacy';
    case 'not-found':
      return `not-found:${route.hash}`;
    default:
      return route.name;
  }
}

/** The ticket a route shows (its page, or an old review page address), for the trail's key. */
export function routeTicketId(route: Route): string | null {
  if (route.name === 'ticket') return route.id;
  if (route.name === 'review') return route.ticketId;
  return null;
}

/**
 * Pages that use the whole width instead of the content column: the ticket's Files changed tab
 * (C-D), like GitHub's, so the file tree and a side-by-side diff have room. `hash` is the address,
 * whose `tab` the ticket route leaves to the page.
 */
export function fullWidth(route: Route, hash: string): boolean {
  return route.name === 'ticket' && tabFromHash(hash) === 'files';
}
