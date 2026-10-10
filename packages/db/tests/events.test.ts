import { describe, expect, it } from 'vitest';
import { DbError, StoredValueError } from '../src/index.js';
import { endedEvent, key, sessionInput, setupStore, tokens, usageEvent } from './fixtures.js';

describe('events repository (B4)', () => {
  it('insertIfNew inserts once per dedupKey and returns the existing id afterwards', () => {
    const { repos } = setupStore();
    const sessionId = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
    const event = endedEvent('cc:hook:sess-1:SessionEnd:abc', key('sess-1'));

    const first = repos.events.insertIfNew({ event, sessionId, projectId: null });
    expect(first).toEqual({ inserted: true, id: 1 });
    const second = repos.events.insertIfNew({ event, sessionId, projectId: null });
    expect(second).toEqual({ inserted: false, id: 1 });

    const other = repos.events.insertIfNew({
      event: endedEvent('cc:hook:sess-1:SessionEnd:def', key('sess-1')),
      sessionId,
      projectId: null,
    });
    expect(other).toEqual({ inserted: true, id: 2 });
    expect(repos.events.maxId()).toBe(2);
  });

  it('round-trips the full NormalizedEvent through the schema', () => {
    const { repos } = setupStore();
    const sessionId = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
    const event = usageEvent(
      'cc:tx:sess-1:main:u1#usage',
      key('sess-1'),
      'msg-1',
      tokens(3, 120, null, 20),
    );
    const { id } = repos.events.insertIfNew({ event, sessionId, projectId: null });
    expect(repos.events.getById(id)).toEqual({ id, sessionId, projectId: null, event });
    expect(repos.events.getByDedupKey(event.dedupKey)?.id).toBe(id);
    expect(repos.events.getById(999)).toBeUndefined();
  });

  it('strips unknown payload fields before storing (no conversation content)', () => {
    const { repos } = setupStore();
    const event = {
      ...endedEvent('k', key('sess-1')),
      payload: { reason: 'exit', prompt: 'secret text' },
    };
    const { id } = repos.events.insertIfNew({ event, sessionId: null, projectId: null });
    expect(repos.events.getById(id)?.event.payload).toEqual({ reason: 'exit' });
  });

  it('rejects an invalid event and an invalid stored payload', () => {
    const { db, repos } = setupStore();
    const bad = { ...endedEvent('k', key('s')), dedupKey: '' };
    expect(() =>
      repos.events.insertIfNew({ event: bad, sessionId: null, projectId: null }),
    ).toThrow(DbError);
    const { id } = repos.events.insertIfNew({
      event: endedEvent('k2', key('s')),
      sessionId: null,
      projectId: null,
    });
    db.connection.prepare(`UPDATE events SET payload = '{"reason": 42}' WHERE id = ?`).run(id);
    expect(() => repos.events.getById(id)).toThrow(StoredValueError);
  });

  it('pages recent events newest first with a stable id cursor', () => {
    const { repos } = setupStore();
    const a = repos.sessions.upsert(sessionInput(key('a'))).id;
    const b = repos.sessions.upsert(sessionInput(key('b'))).id;
    for (let i = 1; i <= 5; i++) {
      repos.events.insertIfNew({
        event: endedEvent(`k${i}`, key(i % 2 ? 'a' : 'b')),
        sessionId: i % 2 ? a : b,
        projectId: null,
      });
    }
    const page1 = repos.events.listRecent({ limit: 2 });
    expect(page1.items.map((e) => e.id)).toEqual([5, 4]);
    expect(page1.nextBeforeId).toBe(4);
    // A new event arriving between pages does not shift the next page.
    repos.events.insertIfNew({ event: endedEvent('k6', key('a')), sessionId: a, projectId: null });
    const page2 = repos.events.listRecent({ limit: 2, beforeId: 4 });
    expect(page2.items.map((e) => e.id)).toEqual([3, 2]);
    const page3 = repos.events.listRecent({ limit: 2, beforeId: 2 });
    expect(page3.items.map((e) => e.id)).toEqual([1]);
    expect(page3.nextBeforeId).toBeNull();

    expect(repos.events.listRecent({ sessionId: a }).items.map((e) => e.id)).toEqual([6, 5, 3, 1]);
    expect(repos.events.listAfter(4, 10).map((e) => e.id)).toEqual([5, 6]);
    expect(() => repos.events.listRecent({ limit: 0 })).toThrow(DbError);
    expect(() => repos.events.listRecent({ limit: 501 })).toThrow(DbError);
  });

  it('reports maxId null on an empty table', () => {
    const { repos } = setupStore();
    expect(repos.events.maxId()).toBeNull();
    expect(repos.events.listRecent()).toEqual({ items: [], nextBeforeId: null });
  });
});
