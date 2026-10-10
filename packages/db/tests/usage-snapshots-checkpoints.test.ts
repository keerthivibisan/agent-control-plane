import { describe, expect, it } from 'vitest';
import type { Checkpoint } from '@acp/core';
import { DbError, StoredValueError } from '../src/index.js';
import {
  at,
  key,
  sessionInput,
  setupStore,
  snapshotEvent,
  T0,
  tokens,
  usageEvent,
  type TestStore,
} from './fixtures.js';

function withUsageEvents(store: TestStore) {
  const { repos } = store;
  const main = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
  const fork = repos.sessions.upsert(sessionInput(key('sess-fork'))).id;
  /** Inserts a usage.reported event and returns its id (observations reference events). */
  const ev = (dedup: string, k: ReturnType<typeof key>, sessionId: string) =>
    repos.events.insertIfNew({
      event: usageEvent(dedup, k, 'msg-1', tokens(3, 10)),
      sessionId,
      projectId: null,
    }).id;
  return { main, fork, ev };
}

describe('usage repository (B4)', () => {
  it('stores observations as received and lists them by message across sessions', () => {
    const store = setupStore();
    const { repos } = store;
    const { main, fork, ev } = withUsageEvents(store);
    const e1 = ev('a', key('sess-1'), main);
    const e2 = ev('b', key('sess-1'), main);
    const e3 = ev('c', key('sess-fork'), fork);

    // Streaming growth: same message, growing output; a fork copy in another session.
    expect(
      repos.usage.insertObservation({
        eventId: e2,
        provider: 'claude-code',
        messageId: 'msg-1',
        sessionId: main,
        occurredAt: at(1),
        requestId: 'req-1',
        model: 'claude-opus-4-1',
        tokens: tokens(3, 120, 500, 20_000),
      }),
    ).toBe(true);
    repos.usage.insertObservation({
      eventId: e1,
      provider: 'claude-code',
      messageId: 'msg-1',
      sessionId: main,
      occurredAt: at(1),
      requestId: 'req-1',
      model: 'claude-opus-4-1',
      tokens: tokens(3, 10, 500, 20_000),
    });
    repos.usage.insertObservation({
      eventId: e3,
      provider: 'claude-code',
      messageId: 'msg-1',
      sessionId: fork,
      occurredAt: null,
      requestId: null,
      model: null,
      tokens: tokens(null, null),
    });
    // One observation per event.
    expect(
      repos.usage.insertObservation({
        eventId: e1,
        provider: 'claude-code',
        messageId: 'msg-1',
        sessionId: main,
        occurredAt: at(1),
        requestId: null,
        model: null,
        tokens: tokens(1, 1),
      }),
    ).toBe(false);

    const observations = repos.usage.listObservationsByMessage('claude-code', 'msg-1');
    // occurredAt ascending, nulls last, then event id.
    expect(observations.map((o) => o.eventId)).toEqual([e1, e2, e3]);
    expect(observations[1]).toEqual({
      eventId: e2,
      provider: 'claude-code',
      messageId: 'msg-1',
      sessionId: main,
      sessionKey: key('sess-1'),
      occurredAt: at(1),
      requestId: 'req-1',
      model: 'claude-opus-4-1',
      tokens: tokens(3, 120, 500, 20_000),
    });
    // Null categories stay null (unavailable), never 0.
    expect(observations[2]?.tokens).toEqual(tokens(null, null, null, null));
    expect(observations[2]?.sessionKey).toEqual(key('sess-fork'));
    expect(repos.usage.listObservationsByMessage('claude-code', 'other')).toEqual([]);
  });

  it('upserts one record per (provider, messageId) with a stable id', () => {
    const store = setupStore();
    const { repos } = store;
    const { main, fork, ev } = withUsageEvents(store);
    const e1 = ev('a', key('sess-1'), main);
    const base = {
      provider: 'claude-code' as const,
      messageId: 'msg-1',
      occurredAt: at(1),
      requestId: 'req-1',
      model: 'claude-opus-4-1',
    };
    const created = repos.usage.upsertRecord({
      ...base,
      sessionId: fork,
      selectedEventId: e1,
      tokens: tokens(3, 10, null, 5),
      observationCount: 1,
      conflict: false,
    });
    expect(created.created).toBe(true);
    // Recomputed after more observations: re-attributed to the original session.
    const updated = repos.usage.upsertRecord({
      ...base,
      sessionId: main,
      selectedEventId: e1,
      tokens: tokens(3, 120, null, 5),
      observationCount: 3,
      conflict: true,
    });
    expect(updated).toEqual({ id: created.id, created: false });
    expect(repos.usage.getRecord('claude-code', 'msg-1')).toEqual({
      id: created.id,
      ...base,
      sessionId: main,
      selectedEventId: e1,
      tokens: tokens(3, 120, null, 5),
      observationCount: 3,
      conflict: true,
      source: 'transcript',
      provenance: 'observed',
      updatedAt: '2026-10-10T12:00:01.000Z',
    });
    expect(repos.usage.listRecordsForSession(main).map((r) => r.messageId)).toEqual(['msg-1']);
    expect(repos.usage.listRecordsForSession(fork)).toEqual([]);
    expect(repos.usage.deleteRecord('claude-code', 'msg-1')).toBe(true);
    expect(repos.usage.getRecord('claude-code', 'msg-1')).toBeUndefined();
  });

  it('validates token counts and observation counts', () => {
    const store = setupStore();
    const { repos } = store;
    const { main, ev } = withUsageEvents(store);
    const e1 = ev('a', key('sess-1'), main);
    expect(() =>
      repos.usage.insertObservation({
        eventId: e1,
        provider: 'claude-code',
        messageId: 'msg-1',
        sessionId: main,
        occurredAt: null,
        requestId: null,
        model: null,
        tokens: tokens(-1, 2),
      }),
    ).toThrow(DbError);
    expect(() =>
      repos.usage.upsertRecord({
        provider: 'claude-code',
        messageId: 'm',
        sessionId: main,
        selectedEventId: null,
        occurredAt: null,
        requestId: null,
        model: null,
        tokens: tokens(1, 1),
        observationCount: 0,
        conflict: false,
      }),
    ).toThrow(DbError);
  });
});

describe('snapshots repository (B4)', () => {
  it('stores snapshots, returns the latest, and labels cost as estimated', () => {
    const { repos } = setupStore();
    const sessionId = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
    const insert = (dedup: string, occurredAt: string | null, cost: number | null) => {
      const event = snapshotEvent(dedup, key('sess-1'), occurredAt, cost);
      const { id } = repos.events.insertIfNew({ event, sessionId, projectId: null });
      return {
        id,
        inserted: repos.snapshots.insert({
          eventId: id,
          provider: 'claude-code',
          sessionId,
          occurredAt,
          observedAt: event.observedAt,
          snapshot: event.payload,
        }),
      };
    };
    const older = insert('s1', at(1), 0.5);
    const newer = insert('s2', at(5), 1.25);
    const undated = insert('s3', null, null);
    expect([older.inserted, newer.inserted, undated.inserted]).toEqual([true, true, true]);

    const latest = repos.snapshots.latestForSession(sessionId);
    expect(latest).toEqual({
      eventId: newer.id,
      provider: 'claude-code',
      sessionId,
      occurredAt: at(5),
      observedAt: '2026-10-10T09:00:00.000Z',
      scope: 'unknown',
      byModel: { 'claude-opus-4-1': { input: 10, output: 20, cacheCreation: null, cacheRead: 5 } },
      reportedCostUsd: { provenance: 'estimated', value: 1.25 },
    });
    const all = repos.snapshots.listForSession(sessionId);
    expect(all.map((s) => s.eventId)).toEqual([undated.id, older.id, newer.id]);
    expect(all[0]?.reportedCostUsd).toEqual({
      provenance: 'unavailable',
      value: null,
      reason: 'not reported by provider',
    });
  });

  it('validates the by_model JSON on read', () => {
    const { db, repos } = setupStore();
    const sessionId = repos.sessions.upsert(sessionInput(key('sess-1'))).id;
    const event = snapshotEvent('s1', key('sess-1'), T0, 1);
    const { id } = repos.events.insertIfNew({ event, sessionId, projectId: null });
    repos.snapshots.insert({
      eventId: id,
      provider: 'claude-code',
      sessionId,
      occurredAt: T0,
      observedAt: T0,
      snapshot: event.payload,
    });
    db.connection.prepare(`UPDATE usage_snapshots SET by_model = '{"m": {"input": -5}}'`).run();
    expect(() => repos.snapshots.latestForSession(sessionId)).toThrow(StoredValueError);
  });
});

describe('checkpoints repository (B4)', () => {
  const cp: Checkpoint = {
    sourcePath: '/home/user/.claude/projects/-repo/sess-1.jsonl',
    fileIdentity: '16777220:123456',
    sizeBytes: 4096,
    mtimeMs: 1760083200123.5,
    byteOffset: 4000,
    headHash: 'a'.repeat(64),
    parseErrors: 0,
  };

  it('implements CheckpointStore: get, set (upsert), list, remove', () => {
    const { repos } = setupStore();
    expect(repos.checkpoints.get(cp.sourcePath)).toBeUndefined();
    repos.checkpoints.set(cp);
    expect(repos.checkpoints.get(cp.sourcePath)).toEqual(cp);
    const advanced = { ...cp, sizeBytes: 8192, byteOffset: 8000, parseErrors: 1 };
    repos.checkpoints.set(advanced);
    expect(repos.checkpoints.get(cp.sourcePath)).toEqual(advanced);
    expect(repos.checkpoints.list()).toEqual([
      { ...advanced, updatedAt: '2026-10-10T12:00:01.000Z' },
    ]);
    expect(repos.checkpoints.remove(cp.sourcePath)).toBe(true);
    expect(repos.checkpoints.list()).toEqual([]);
  });

  it('rejects invalid positions', () => {
    const { repos } = setupStore();
    expect(() => repos.checkpoints.set({ ...cp, byteOffset: -1 })).toThrow(DbError);
    expect(() => repos.checkpoints.set({ ...cp, sizeBytes: 1.5 })).toThrow(DbError);
    expect(() => repos.checkpoints.set({ ...cp, sourcePath: '' })).toThrow(DbError);
  });
});
