import { describe, expect, it } from 'vitest';
import { createQueries } from '../src/index.js';
import { at, key, sessionInput, setupStore, T0, tokens } from './fixtures.js';

describe('stats and diagnostics queries (B6)', () => {
  it('reports per-project stats, child counts, ambiguity, and diagnostics counts', () => {
    const { db, repos } = setupStore();
    const q = createQueries(db);
    const p1 = repos.projects.insert({ name: 'p1', rootPath: '/p1' }).id;
    const empty = repos.projects.insert({ name: 'p2', rootPath: '/p2' }).id;
    const a = repos.sessions.upsert(
      sessionInput(key('a'), { projectId: p1, lastEventAt: at(3) }),
    ).id;
    const c = repos.sessions.upsert(
      sessionInput(key('a', 'x'), { projectId: p1, lastEventAt: at(5) }),
    ).id;
    const f = repos.sessions.upsert(sessionInput(key('f'), { projectId: p1 })).id;
    const other = repos.sessions.upsert(sessionInput(key('o'))).id;
    const edge = (kind: 'subagent' | 'continuation', parent: string, child: string) =>
      repos.edges.upsert({
        kind,
        parentSessionId: parent,
        childSessionId: child,
        provenance: 'observed',
        evidence: [kind === 'subagent' ? 'subagent-metadata' : 'shared-message-history'],
        observedAt: T0,
      });
    edge('subagent', a, c);
    edge('continuation', a, f);
    edge('subagent', other, c); // different parent: conflict diagnostic
    const rec = (messageId: string, sessionId: string, conflict: boolean, ambiguous: boolean) =>
      repos.usage.upsertRecord({
        provider: 'claude-code',
        messageId,
        sessionId,
        selectedEventId: null,
        occurredAt: T0,
        requestId: null,
        model: null,
        tokens: tokens(1, 1),
        observationCount: 1,
        conflict,
        attributionAmbiguous: ambiguous,
      });
    rec('m1', a, true, false);
    rec('m2', f, false, true);
    repos.events.insertIfNew({
      event: {
        schemaVersion: 1,
        provider: 'claude-code',
        eventType: 'record.unrecognized',
        dedupKey: 'u1',
        sourceEventId: null,
        providerSessionId: 'a',
        providerAgentId: null,
        occurredAt: null,
        observedAt: T0,
        provenance: 'observed',
        source: {
          channel: 'transcript',
          providerVersion: '2.1.263',
          path: null,
          byteOffset: null,
          hookEvent: null,
        },
        payload: { recordType: 'mystery' },
      },
      sessionId: a,
      projectId: p1,
    });

    expect(q.projectStats().get(p1)).toEqual({ sessionCount: 3, lastEventAt: at(5) });
    expect(q.projectStats().get(empty)).toEqual({ sessionCount: 0, lastEventAt: null });
    expect([...q.childCountBySession([a, f, 'missing']).values()]).toEqual([1, 0, 0]);
    expect(q.ambiguousAttributionCount(f)).toBe(1);
    expect(q.ambiguousAttributionCount(a)).toBe(0);
    expect(q.diagnosticsCounts()).toEqual({
      edgeConflictCount: 1,
      usageConflictCount: 1,
      ambiguousAttributionCount: 1,
      unrecognized: [{ providerVersion: '2.1.263', recordType: 'mystery', count: 1 }],
    });
  });
});
