import { describe, expect, it } from 'vitest';
import { createApiClient, paths, schemas } from '../../src/lib/api';
import { QueryStore } from '../../src/lib/query-store';
import { health } from '../fixtures/dto';
import { fakeServer } from '../helpers';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('query store', () => {
  it('fetches on first subscribe and refetches watched keys on invalidate', async () => {
    const server = fakeServer({}, { withDefaults: false });
    let version = 1;
    const fetch = (input: string, init?: RequestInit) => {
      if (input === paths.health()) {
        return Promise.resolve(
          new Response(JSON.stringify(health({ version: `v${version}` })), { status: 200 }),
        );
      }
      return server.fetch(input, init);
    };
    const store = new QueryStore(createApiClient(fetch));
    const unsubscribe = store.subscribe(paths.health(), schemas.health, () => {});
    await flush();
    expect(store.getState<{ version: string }>(paths.health()).data?.version).toBe('v1');

    version = 2;
    store.invalidate((k) => k === paths.health());
    expect(store.getState(paths.health()).fetching).toBe(true);
    await flush();
    expect(store.getState<{ version: string }>(paths.health()).data?.version).toBe('v2');
    unsubscribe();
  });

  it('keeps the last good data and exposes the error when a refetch breaks the contract', async () => {
    let body: unknown = health();
    const store = new QueryStore(
      createApiClient(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
    );
    store.subscribe(paths.health(), schemas.health, () => {});
    await flush();
    body = { status: 'ok' };
    store.invalidateAll();
    await flush();
    const state = store.getState(paths.health());
    expect(state.data).toBeDefined();
    expect(state.error?.kind).toBe('parse');
  });
});
