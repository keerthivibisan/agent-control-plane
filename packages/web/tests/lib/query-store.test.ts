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

  // U-V: notices come in bursts; an aborted request still runs on the server, and a run's review
  // can't run twice at once (two staging calls collide on the worktree's index).
  function heldFetch() {
    const pending: ((r: Response) => void)[] = [];
    const fetch = () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      });
    const answer = async (version: string) => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no request in flight');
      next(new Response(JSON.stringify(health({ version })), { status: 200 }));
      await flush();
    };
    return { pending, fetch, answer };
  }

  it('never has two requests for one key in flight: a burst of notices is one more fetch', async () => {
    const { pending, fetch, answer } = heldFetch();
    const store = new QueryStore(createApiClient(fetch));
    const version = () => store.getState<{ version: string }>(paths.health()).data?.version;
    store.subscribe(paths.health(), schemas.health, () => {});
    expect(pending).toHaveLength(1);

    // Three notices while the first request runs: no new request yet.
    store.invalidateAll();
    store.invalidateAll();
    store.invalidateAll();
    expect(pending).toHaveLength(1);

    // The first answer shows, and exactly one refetch follows it.
    await answer('v1');
    expect(version()).toBe('v1');
    expect(store.getState(paths.health()).fetching).toBe(true);
    expect(pending).toHaveLength(1);
    await answer('v2');
    expect(version()).toBe('v2');
    expect(store.getState(paths.health()).fetching).toBe(false);
    expect(pending).toHaveLength(0);
  });

  it('forgets a key invalidated mid-request once nothing watches it', async () => {
    const { pending, fetch, answer } = heldFetch();
    const store = new QueryStore(createApiClient(fetch));
    const unsubscribe = store.subscribe(paths.health(), schemas.health, () => {});
    unsubscribe();
    store.invalidateAll();
    expect(pending).toHaveLength(1);
    await answer('v1');
    expect(pending).toHaveLength(0);
    // Forgotten: the next subscriber starts from scratch.
    expect(store.getState(paths.health()).data).toBeUndefined();
  });
});
