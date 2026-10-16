import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash routes (no router dependency), project first (docs/redesign/README.md §3):
 *
 * - `#/p/:projectId/<page>` for the seven project pages, `#/p/:projectId/skills/:name` for one
 *   skill, `#/p/:projectId/tickets/:ticketId` for a ticket, and `#/p/:projectId/runs/:runId` for a
 *   Phase 3 run that has no ticket (`runs/new` starts one; kept until "Quick ticket" lands);
 * - global pages: `#/projects` (All projects), `#/projects/new`, `#/health` and
 *   `#/health/connection` (Data health), `#/sessions/:id` (one session);
 * - every older address parses to a `legacy` route, which the app redirects to its new home
 *   (src/app/redirects.ts), so links in commit messages and notes keep working.
 */

/** The project pages, in sidebar order. Which of them exist yet is `PROJECT_PAGES` (app shell). */
export const PROJECT_PAGE_IDS = [
  'board',
  'workflow',
  'skills',
  'harness',
  'tokens',
  'sessions',
  'settings',
] as const;
export type ProjectPageId = (typeof PROJECT_PAGE_IDS)[number];

export type HealthTab = 'overview' | 'connection';

/** Addresses from before the redesign. Each one redirects (see src/app/redirects.ts). */
export type LegacyRoute =
  | { kind: 'home' }
  | { kind: 'board'; projectId: string | null }
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'project-settings'; projectId: string }
  | { kind: 'usage'; params: URLSearchParams }
  | { kind: 'sessions'; params: URLSearchParams }
  | { kind: 'setup' }
  /** `runId` null is `#/control`; `'new'` is the Phase 3 start page. */
  | { kind: 'control'; runId: string | null };

export type Route =
  | {
      name: 'project';
      projectId: string;
      page: ProjectPageId;
      /** The skill name on `skills/:name`; null everywhere else. */
      item: string | null;
      params: URLSearchParams;
    }
  | { name: 'ticket'; projectId: string; id: string }
  /** A Phase 3 control-panel run without a ticket; `runId` null is the start page. */
  | { name: 'run'; projectId: string; runId: string | null }
  | { name: 'projects' }
  | { name: 'project-new' }
  | { name: 'health'; tab: HealthTab }
  | { name: 'session'; id: string }
  | { name: 'legacy'; legacy: LegacyRoute }
  | { name: 'not-found'; hash: string };

/** The Phase 3 start page's id in `#/control/new` and `#/p/:id/runs/new`. Run ids are UUIDs. */
export const NEW_RUN = 'new';

function decode(segment: string | undefined): string | null {
  if (segment === undefined) return null;
  try {
    const v = decodeURIComponent(segment);
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

const isProjectPage = (s: string): s is ProjectPageId =>
  (PROJECT_PAGE_IDS as readonly string[]).includes(s);

function parseProjectRoute(rest: readonly string[], params: URLSearchParams): Route | null {
  const [rawId, page, item, ...extra] = rest;
  const projectId = decode(rawId);
  if (projectId === null || extra.length > 0) return null;
  if (page === undefined) return null;
  if (page === 'tickets') {
    const id = decode(item);
    return id === null ? null : { name: 'ticket', projectId, id };
  }
  if (page === 'runs') {
    const runId = decode(item);
    if (runId === null) return null;
    return { name: 'run', projectId, runId: runId === NEW_RUN ? null : runId };
  }
  if (!isProjectPage(page)) return null;
  if (item === undefined) return { name: 'project', projectId, page, item: null, params };
  // Only Skills has item pages (`skills/:name`, R-D).
  const name = page === 'skills' ? decode(item) : null;
  return name === null ? null : { name: 'project', projectId, page, item: name, params };
}

function parseLegacy(segments: readonly string[], params: URLSearchParams): LegacyRoute | null {
  const [head, rawId, ...rest] = segments;
  const id = decode(rawId);
  if (head === 'projects' && id !== null && rest.length === 1 && rest[0] === 'settings') {
    return { kind: 'project-settings', projectId: id };
  }
  if (rest.length > 0) return null;
  if (rawId === undefined) {
    if (head === 'board') return { kind: 'board', projectId: null };
    if (head === 'usage') return { kind: 'usage', params };
    if (head === 'sessions') return { kind: 'sessions', params };
    if (head === 'setup') return { kind: 'setup' };
    if (head === 'control') return { kind: 'control', runId: null };
    return null;
  }
  if (id === null) return null;
  if (head === 'board') return { kind: 'board', projectId: id };
  if (head === 'tickets') return { kind: 'ticket', ticketId: id };
  if (head === 'projects') return { kind: 'project', projectId: id };
  if (head === 'control') return { kind: 'control', runId: id };
  return null;
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', query = ''] = raw.split('?', 2);
  const params = new URLSearchParams(query);
  const segments = pathPart.split('/').filter((s) => s.length > 0);
  const notFound: Route = { name: 'not-found', hash };

  if (segments.length === 0) return { name: 'legacy', legacy: { kind: 'home' } };
  const [head, second, ...rest] = segments;
  if (head === 'p') return parseProjectRoute([second ?? '', ...rest], params) ?? notFound;
  if (head === 'projects' && second === undefined) return { name: 'projects' };
  if (head === 'projects' && second === 'new' && rest.length === 0) return { name: 'project-new' };
  if (head === 'health' && second === undefined) return { name: 'health', tab: 'overview' };
  if (head === 'health' && second === 'connection' && rest.length === 0) {
    return { name: 'health', tab: 'connection' };
  }
  if (head === 'sessions' && second !== undefined && rest.length === 0) {
    const id = decode(second);
    if (id !== null) return { name: 'session', id };
  }
  const legacy = parseLegacy(segments, params);
  return legacy === null ? notFound : { name: 'legacy', legacy };
}

type Params = Record<string, string | null | undefined>;

function withParams(path: string, params: Params): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const qs = search.toString();
  return qs ? `#${path}?${qs}` : `#${path}`;
}

const enc = encodeURIComponent;

/** `#/p/:projectId/<page>` with optional query parameters. */
function projectPage(projectId: string, page: ProjectPageId, params: Params = {}): string {
  return withParams(`/p/${enc(projectId)}/${page}`, params);
}

/**
 * A page that used to be global and is now per project (Sessions, Tokens): its project filter is
 * the address, so `projectId` moves from the query into the path. Without one, the legacy address
 * redirects to the last used project.
 */
function scoped(page: 'sessions' | 'tokens', legacyPath: string, params: Params): string {
  const { projectId, ...rest } = params;
  return projectId ? projectPage(projectId, page, rest) : withParams(legacyPath, rest);
}

export const href = {
  /** The app's front door: the last used project's board, else All projects. */
  home: () => '#/',
  projects: () => '#/projects',
  newProject: () => '#/projects/new',
  health: () => '#/health',
  /** Setup (hooks and the data root) lives under Data health as "Connection". */
  setup: () => '#/health/connection',
  session: (id: string) => `#/sessions/${enc(id)}`,

  projectPage,
  /** A project's home is its board. */
  project: (id: string) => projectPage(id, 'board'),
  /** Without an id: the last used project's board (`#/` decides). */
  board: (projectId?: string) => (projectId === undefined ? '#/' : projectPage(projectId, 'board')),
  projectSettings: (id: string) => projectPage(id, 'settings'),
  skill: (projectId: string, name: string) => `#/p/${enc(projectId)}/skills/${enc(name)}`,
  ticket: (ticket: { id: string; projectId: string }) =>
    `#/p/${enc(ticket.projectId)}/tickets/${enc(ticket.id)}`,
  /** A Phase 3 run's page (runs without a ticket). */
  run: (run: { id: string; projectId: string }) => `#/p/${enc(run.projectId)}/runs/${enc(run.id)}`,
  sessions: (params: Params = {}) => scoped('sessions', '/sessions', params),
  usage: (params: Params = {}) => scoped('tokens', '/usage', params),
  /**
   * The old control panel. Without a run it opens the board; with one, the run's ticket or (Phase 3
   * runs without a ticket) its run page. Prefer `href.ticket` or `href.run` when you have the ids.
   */
  control: (runId?: string) => (runId === undefined ? '#/control' : `#/control/${enc(runId)}`),
};

/** The project a route belongs to, or null on global pages. */
export function routeProjectId(route: Route): string | null {
  return route.name === 'project' || route.name === 'ticket' || route.name === 'run'
    ? route.projectId
    : null;
}

export function navigate(hash: string): void {
  window.location.hash = hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * Replaces the current address without a new history entry, so Back never bounces into a
 * redirect again, and tells the router (which listens for `hashchange`).
 */
export function replaceHash(hash: string): void {
  window.history.replaceState(window.history.state, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = () => window.location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  return useMemo(() => parseRoute(hash), [hash]);
}
