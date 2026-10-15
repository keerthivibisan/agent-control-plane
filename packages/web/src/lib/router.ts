import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash routes (no router dependency): `#/`, `#/sessions`, `#/sessions/:id`, `#/projects`,
 * `#/projects/:id`, `#/usage` (the "Tokens" page), `#/setup`, `#/health` (the "Data health" page),
 * `#/control` and `#/control/:runId` (the control panel), `#/board` and `#/board/:projectId` (the
 * Phase 4 board; without an id it opens the last used project), `#/tickets/:id` (the ticket page).
 */
export type Route =
  | { name: 'home' }
  | { name: 'projects' }
  | { name: 'setup' }
  | { name: 'health' }
  | { name: 'sessions'; params: URLSearchParams }
  | { name: 'session'; id: string }
  | { name: 'project'; id: string }
  | { name: 'usage'; params: URLSearchParams }
  | { name: 'control'; runId: string | null }
  | { name: 'board'; projectId: string | null }
  // Phase 4 (P4-F): the new project wizard and a project's settings.
  | { name: 'project-new' }
  | { name: 'project-settings'; id: string }
  // Phase 4 (P4-G): the ticket page.
  | { name: 'ticket'; id: string }
  | { name: 'not-found'; hash: string };

function decode(segment: string): string | null {
  try {
    const v = decodeURIComponent(segment);
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', query = ''] = raw.split('?', 2);
  const path = pathPart === '' ? '/' : pathPart;
  const params = new URLSearchParams(query);
  const segments = path.split('/').filter((s) => s.length > 0);

  if (segments.length === 0) return { name: 'home' };
  const [head, id, ...rest] = segments;
  // Phase 4 (P4-F): `#/projects/new` and `#/projects/:id/settings`.
  if (head === 'projects' && id === 'new' && rest.length === 0) return { name: 'project-new' };
  if (head === 'projects' && id !== undefined && rest.length === 1 && rest[0] === 'settings') {
    const decoded = decode(id);
    if (decoded) return { name: 'project-settings', id: decoded };
  }
  if (rest.length > 0) return { name: 'not-found', hash };
  if (head === 'sessions' && id === undefined) return { name: 'sessions', params };
  if (head === 'usage' && id === undefined) return { name: 'usage', params };
  if (head === 'projects' && id === undefined) return { name: 'projects' };
  if (head === 'setup' && id === undefined) return { name: 'setup' };
  if (head === 'health' && id === undefined) return { name: 'health' };
  if (head === 'control' && id === undefined) return { name: 'control', runId: null };
  if (head === 'control' && id !== undefined) {
    const decoded = decode(id);
    if (decoded) return { name: 'control', runId: decoded };
  }
  if (head === 'board' && id === undefined) return { name: 'board', projectId: null };
  if (head === 'board' && id !== undefined) {
    const decoded = decode(id);
    if (decoded) return { name: 'board', projectId: decoded };
  }
  // Phase 4 (P4-G): `#/tickets/:id`.
  if (head === 'tickets' && id !== undefined) {
    const decoded = decode(id);
    if (decoded) return { name: 'ticket', id: decoded };
  }
  if (head === 'sessions' && id !== undefined) {
    const decoded = decode(id);
    if (decoded) return { name: 'session', id: decoded };
  }
  if (head === 'projects' && id !== undefined) {
    const decoded = decode(id);
    if (decoded) return { name: 'project', id: decoded };
  }
  return { name: 'not-found', hash };
}

function withParams(path: string, params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const qs = search.toString();
  return qs ? `#${path}?${qs}` : `#${path}`;
}

export const href = {
  home: () => '#/',
  sessions: (params: Record<string, string | null | undefined> = {}) =>
    withParams('/sessions', params),
  session: (id: string) => `#/sessions/${encodeURIComponent(id)}`,
  projects: () => '#/projects',
  project: (id: string) => `#/projects/${encodeURIComponent(id)}`,
  setup: () => '#/setup',
  health: () => '#/health',
  usage: (params: Record<string, string | null | undefined> = {}) => withParams('/usage', params),
  control: (runId?: string) =>
    runId === undefined ? '#/control' : `#/control/${encodeURIComponent(runId)}`,
  board: (projectId?: string) =>
    projectId === undefined ? '#/board' : `#/board/${encodeURIComponent(projectId)}`,
  ticket: (id: string) => `#/tickets/${encodeURIComponent(id)}`,
  // Phase 4 (P4-F).
  newProject: () => '#/projects/new',
  projectSettings: (id: string) => `#/projects/${encodeURIComponent(id)}/settings`,
};

export function navigate(hash: string): void {
  window.location.hash = hash.startsWith('#') ? hash.slice(1) : hash;
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
