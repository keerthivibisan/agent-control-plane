import { describe, expect, it } from 'vitest';
import type { EventOf, SessionKey } from '@acp/core';
import { at, key, sessionInput, setupStore, T0, tokens, usageEvent } from './fixtures.js';

function toolCalled(
  dedupKey: string,
  k: SessionKey,
  toolUseId: string,
  toolName: string,
): EventOf<'tool.called'> {
  return {
    schemaVersion: 1,
    provider: k.provider,
    dedupKey,
    sourceEventId: null,
    providerSessionId: k.providerSessionId,
    providerAgentId: k.providerAgentId,
    occurredAt: T0,
    observedAt: T0,
    provenance: 'observed',
    source: {
      channel: 'transcript',
      providerVersion: null,
      path: null,
      byteOffset: null,
      hookEvent: null,
    },
    eventType: 'tool.called',
    payload: { toolUseId, toolName, messageId: null },
  };
}

describe('usage.listSharedSightings', () => {
  function observe(
    store: ReturnType<typeof setupStore>,
    dedup: string,
    k: SessionKey,
    sessionId: string,
    messageId: string,
  ) {
    const { id } = store.repos.events.insertIfNew({
      event: usageEvent(dedup, k, messageId, tokens(1, 2), at(1)),
      sessionId,
      projectId: null,
    });
    store.repos.usage.insertObservation({
      eventId: id,
      provider: 'claude-code',
      messageId,
      sessionId,
      occurredAt: at(1),
      requestId: null,
      model: 'm',
      tokens: tokens(1, 2),
    });
  }

  it('returns only messages seen in two or more sessions, from all of those sessions', () => {
    const store = setupStore();
    const a = store.repos.sessions.upsert(sessionInput(key('a'))).id;
    const b = store.repos.sessions.upsert(sessionInput(key('b'))).id;
    const c = store.repos.sessions.upsert(sessionInput(key('c'))).id;
    observe(store, 'a-shared', key('a'), a, 'shared');
    observe(store, 'b-shared', key('b'), b, 'shared');
    observe(store, 'a-only', key('a'), a, 'a-only');
    observe(store, 'c-other', key('c'), c, 'c-only');

    const rows = store.repos.usage.listSharedSightings([a]);
    expect(rows.map((r) => [r.messageId, r.session.providerSessionId])).toEqual([
      ['shared', 'a'],
      ['shared', 'b'],
    ]);
    expect(store.repos.usage.listSharedSightings([c])).toEqual([]);
    expect(store.repos.usage.listSharedSightings([])).toEqual([]);
  });
});

describe('events.listToolCalls', () => {
  it('lists tool.called events by session, optionally narrowed to tool-use ids', () => {
    const store = setupStore();
    const a = store.repos.sessions.upsert(sessionInput(key('a'))).id;
    const b = store.repos.sessions.upsert(sessionInput(key('b'))).id;
    const { repos } = store;
    repos.events.insertIfNew({
      event: toolCalled('t1', key('a'), 'tu-1', 'Agent'),
      sessionId: a,
      projectId: null,
    });
    repos.events.insertIfNew({
      event: toolCalled('t2', key('a'), 'tu-2', 'Read'),
      sessionId: a,
      projectId: null,
    });
    repos.events.insertIfNew({
      event: toolCalled('t3', key('b'), 'tu-3', 'Task'),
      sessionId: b,
      projectId: null,
    });
    repos.events.insertIfNew({
      event: usageEvent('u1', key('a'), 'm', tokens(1, 1)),
      sessionId: a,
      projectId: null,
    });

    expect(repos.events.listToolCalls([a]).map((r) => [r.toolUseId, r.toolName])).toEqual([
      ['tu-1', 'Agent'],
      ['tu-2', 'Read'],
    ]);
    expect(repos.events.listToolCalls([a, b], ['tu-3']).map((r) => r.sessionId)).toEqual([b]);
    expect(repos.events.listToolCalls([])).toEqual([]);
  });
});
