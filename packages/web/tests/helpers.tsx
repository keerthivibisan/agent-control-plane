import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createApiClient, type FetchLike } from '../src/lib/api';
import { ApiProvider } from '../src/lib/query';
import { QueryStore } from '../src/lib/query-store';
import { capabilities, health } from './fixtures/dto';

export type RouteTable = Record<string, unknown>;

export interface FakeServer {
  fetch: FetchLike;
  calls: { method: string; path: string; body: unknown }[];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * An in-memory API: exact-path lookups into `routes`. A value that is a function is called with the
 * request body (for POST). Unknown paths answer 404 with an ErrorDto, like the real server.
 */
export function fakeServer(routes: RouteTable, { withDefaults = true } = {}): FakeServer {
  const table: RouteTable = withDefaults
    ? {
        '/api/health': health(),
        '/api/capabilities': capabilities(),
        '/api/projects': [],
        ...routes,
      }
    : routes;
  const calls: FakeServer['calls'] = [];
  const fetch: FetchLike = (input, init) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path: input, body });
    const key = method === 'GET' ? input : `${method} ${input}`;
    if (!(key in table)) {
      return Promise.resolve(
        json(404, { error: { code: 'not_found', message: `no route ${key}`, requestId: 'req-t' } }),
      );
    }
    const value = table[key];
    if (value instanceof Response) return Promise.resolve(value);
    if (typeof value === 'function')
      return Promise.resolve((value as (b: unknown) => Response)(body));
    return Promise.resolve(json(200, value));
  };
  return { fetch, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
  return json(status, body);
}

export function renderWithApi(ui: ReactNode, server: FakeServer) {
  const store = new QueryStore(createApiClient(server.fetch));
  return { store, ...render(<ApiProvider store={store}>{ui}</ApiProvider>) };
}
