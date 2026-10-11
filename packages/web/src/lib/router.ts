import { useMemo, useSyncExternalStore } from 'react';

/**
 * Hash routes (no router dependency): `#/`, `#/sessions`, `#/sessions/:id`, `#/projects`,
 * `#/projects/:id`, `#/usage` (the "Tokens" page), `#/setup`, `#/health` (the "Data health" page),
 * `#/control` and `#/control/:runId` (the control panel).
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
