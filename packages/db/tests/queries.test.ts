import type { TokenCounts } from '@acp/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createQueries, DbError, type Queries, type Repositories } from '../src/index.js';
import { at, key, sessionInput, setupStore, T0, tokens } from './fixtures.js';

/**
 * Synthetic fixture with known totals:
 *
 *   A (P1, last 10) ── subagent ── A1 (last 8) ── subagent ── A1a (last 7, all-null usage)
 *     ├──────────────── subagent ── A2 (last 10, no usage)
 *     └──────────────── continuation ── F (P1, last 12; a fork, excluded from A's aggregate)
 *   B (P2, last 5)       U (no project, no last event)
 */
interface Fixture {
  repos: Repositories;
  q: Queries;
  ids: Record<'A' | 'A1' | 'A1a' | 'A2' | 'F' | 'B' | 'U', string>;
}

let fx: Fixture;

function build(): Fixture {
  const { db, repos } = setupStore();
  const p1 = repos.projects.insert({ name: 'p1', rootPath: '/p1' }).id;
  const p2 = repos.projects.insert({ name: 'p2', rootPath: '/p2' }).id;
  const s = (k: ReturnType<typeof key>, projectId: string | null, last: number | null) =>
    repos.sessions.upsert(
      sessionInput(k, {
        projectId,
        lastEventAt: last === null ? null : at(last),
        firstSeenAt: at(last ?? 0),
      }),
    ).id;
  const ids = {
    A: s(key('sess-a'), p1, 10),
    A1: s(key('sess-a', 'agent-1'), p1, 8),
    A1a: s(key('sess-a', 'agent-1a'), p1, 7),
    A2: s(key('sess-a', 'agent-2'), p1, 10),
    F: s(key('sess-fork'), p1, 12),
    B: s(key('sess-b'), p2, 5),
    U: s(key('sess-u'), null, null),
  };
  const sub = (parent: string, child: string) =>
    repos.edges.upsert({
      kind: 'subagent',
      parentSessionId: parent,
      childSessionId: child,
      provenance: 'observed',
      evidence: ['subagent-metadata'],
      observedAt: T0,
    });
  sub(ids.A, ids.A1);
  sub(ids.A1, ids.A1a);
  sub(ids.A, ids.A2);
  repos.edges.upsert({
    kind: 'continuation',
    parentSessionId: ids.A,
    childSessionId: ids.F,
    provenance: 'derived',
    evidence: ['shared-message-history'],
    observedAt: T0,
  });

  const rec = (
    messageId: string,
    sessionId: string,
    t: TokenCounts,
    model: string | null,
    occurredAt: string | null = T0,
    { conflict = false, attributionAmbiguous = false } = {},
  ) =>
    repos.usage.upsertRecord({
      provider: 'claude-code',
      messageId,
      sessionId,
      selectedEventId: null,
      occurredAt,
      requestId: null,
      model,
      tokens: t,
      observationCount: 1,
      conflict,
      attributionAmbiguous,
    });
  rec('m1', ids.A, tokens(10, 100, null, 1000), 'opus');
  rec('m2', ids.A, tokens(5, 50, 20, null), 'sonnet', '2026-10-11T01:00:00.000Z');
  rec('m3', ids.A1, tokens(1, 10, null, null), 'opus');
  rec('m4', ids.A1a, tokens(null, null, null, null), null);
  // The fork's copy tied with the original on time: counted once, flagged ambiguous.
  rec('m5', ids.F, tokens(2, 20, 2, 200), 'opus', T0, { attributionAmbiguous: true });
  rec('m6', ids.B, tokens(7, 70, 7, 700), 'sonnet', null, { conflict: true });
  rec('m7', ids.U, tokens(1, 1, 1, 1), 'opus');
  return { repos, q: createQueries(db), ids };
}

beforeEach(() => {
  fx = build();
});

const none = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

describe('direct and aggregate usage (B6)', () => {
  it('direct usage sums only the session’s own records, per category', () => {
    expect(fx.q.directUsage(fx.ids.A)).toEqual({
      recordCount: 2,
      tokens: { input: 15, output: 150, cacheCreation: 20, cacheRead: 1000 },
      recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 1, cacheRead: 1 },
    });
  });

  it('SUM stays NULL when every value is NULL, with unavailable counts', () => {
    expect(fx.q.directUsage(fx.ids.A1a)).toEqual({
      recordCount: 1,
      tokens: { input: null, output: null, cacheCreation: null, cacheRead: null },
      recordsWithUnavailable: { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 },
    });
  });

  it('a session with no records has null totals, never 0', () => {
    expect(fx.q.directUsage(fx.ids.A2)).toEqual({
      recordCount: 0,
      tokens: { input: null, output: null, cacheCreation: null, cacheRead: null },
      recordsWithUnavailable: none,
    });
  });

  it('aggregate = direct + subagent descendants (depth 2), excluding continuation children', () => {
    expect(fx.q.aggregateUsage(fx.ids.A)).toEqual({
      recordCount: 4, // m1, m2, m3, m4; the fork's m5 is not included
      tokens: { input: 16, output: 160, cacheCreation: 20, cacheRead: 1000 },
      recordsWithUnavailable: { input: 1, output: 1, cacheCreation: 3, cacheRead: 3 },
    });
    expect(fx.q.aggregateUsage(fx.ids.A1)).toEqual({
      recordCount: 2,
      tokens: { input: 1, output: 10, cacheCreation: null, cacheRead: null },
      recordsWithUnavailable: { input: 1, output: 1, cacheCreation: 2, cacheRead: 2 },
    });
    // A leaf's aggregate equals its direct usage.
    expect(fx.q.aggregateUsage(fx.ids.F)).toEqual(fx.q.directUsage(fx.ids.F));
  });

  it('direct usage for many sessions at once gives every id an entry', () => {
    const map = fx.q.directUsageBySession([fx.ids.A, fx.ids.A2, 'missing']);
    expect(map.get(fx.ids.A)).toEqual(fx.q.directUsage(fx.ids.A));
    expect(map.get(fx.ids.A2)?.recordCount).toBe(0);
    expect(map.get('missing')?.tokens.input).toBeNull();
  });
});

describe('usage summary groups (B6)', () => {
  it('groups by project, summing direct usage (subagents counted once)', () => {
    const groups = fx.q.usageSummary('project');
    expect(groups.map((g) => [g.key, g.totals.recordCount, g.totals.tokens])).toEqual([
      [
        fx.repos.projects.getByRootPath('/p1')?.id,
        5,
        { input: 18, output: 180, cacheCreation: 22, cacheRead: 1200 },
      ],
      [
        fx.repos.projects.getByRootPath('/p2')?.id,
        1,
        { input: 7, output: 70, cacheCreation: 7, cacheRead: 700 },
      ],
      [null, 1, { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 }],
    ]);
  });

  it('groups by model, with the unknown model as a null group', () => {
    const groups = fx.q.usageSummary('model');
    expect(groups.map((g) => [g.key, g.totals.recordCount, g.totals.tokens.output])).toEqual([
      ['opus', 4, 131],
      ['sonnet', 2, 120],
      [null, 1, null],
    ]);
  });

  it('groups by UTC day and by session, and applies filters', () => {
    expect(fx.q.usageSummary('day').map((g) => [g.key, g.totals.recordCount])).toEqual([
      ['2026-10-10', 5],
      ['2026-10-11', 1],
      [null, 1],
    ]);
    const bySession = fx.q.usageSummary('session');
    expect(bySession.find((g) => g.key === fx.ids.A)?.totals).toEqual(fx.q.directUsage(fx.ids.A));
    expect(bySession).toHaveLength(6); // A2 has no records

    const p2 = fx.repos.projects.getByRootPath('/p2')?.id ?? '';
    expect(fx.q.usageSummary('model', { projectId: p2 }).map((g) => g.key)).toEqual(['sonnet']);
    expect(
      fx.q
        .usageSummary('day', { from: '2026-10-11T00:00:00.000Z', to: '2026-10-12T00:00:00Z' })
        .map((g) => [g.key, g.totals.tokens.input]),
    ).toEqual([['2026-10-11', 5]]);
    expect(fx.q.usageSummary('model', { provider: 'demo' })).toEqual([]);
    expect(() => fx.q.usageSummary('week' as 'day')).toThrow(DbError);
  });
});

describe('session tree (B6)', () => {
  it('returns the root and its subagent descendants with depth and parent', () => {
    const tree = fx.q.sessionTree(fx.ids.A);
    expect(tree.map((n) => [n.session.id, n.parentSessionId, n.depth])).toEqual([
      [fx.ids.A, null, 0],
      [fx.ids.A1, fx.ids.A, 1],
      [fx.ids.A2, fx.ids.A, 1],
      [fx.ids.A1a, fx.ids.A1, 2],
    ]);
    expect(tree[0]?.session.providerSessionId).toBe('sess-a');
  });

  it('is empty for an unknown root and terminates on a (corrupt) cycle', () => {
    expect(fx.q.sessionTree('missing')).toEqual([]);
    // B -> U and U -> B as subagent edges form a cycle.
    for (const [p, c] of [
      [fx.ids.B, fx.ids.U],
      [fx.ids.U, fx.ids.B],
    ] as const) {
      fx.repos.edges.upsert({
        kind: 'subagent',
        parentSessionId: p,
        childSessionId: c,
        provenance: 'observed',
        evidence: ['subagent-hook'],
        observedAt: T0,
      });
    }
    expect(fx.q.sessionTree(fx.ids.B).map((n) => n.session.id)).toEqual([fx.ids.B, fx.ids.U]);
    expect(fx.q.aggregateUsage(fx.ids.B).recordCount).toBe(2);
  });
});

describe('session list (B6)', () => {
  const idsOf = (page: { items: { id: string }[] }) => page.items.map((s) => s.id);

  it('orders by lastEventAt desc (nulls last), then id desc, with keyset pages', () => {
    const { ids, q } = fx;
    const all = q.listSessions();
    // A and A2 share lastEventAt; the id (descending) breaks the tie.
    expect(idsOf(all)).toEqual([ids.F, ids.A2, ids.A, ids.A1, ids.A1a, ids.B, ids.U]);
    expect(all.nextCursor).toBeNull();

    const p1 = q.listSessions({}, { limit: 3 });
    expect(idsOf(p1)).toEqual([ids.F, ids.A2, ids.A]);
    expect(p1.nextCursor).toEqual({ lastEventAt: at(10), id: ids.A });
    const p2 = q.listSessions({}, { limit: 3, cursor: p1.nextCursor });
    expect(idsOf(p2)).toEqual([ids.A1, ids.A1a, ids.B]);
    const p3 = q.listSessions({}, { limit: 3, cursor: p2.nextCursor });
    expect(idsOf(p3)).toEqual([ids.U]);
    expect(p3.nextCursor).toBeNull();
  });

  it('pagination is stable when sessions are added or touched between pages', () => {
    const { ids, q, repos } = fx;
    const p1 = q.listSessions({}, { limit: 3 });
    // New activity newer than the cursor lands on an earlier page, not this one.
    repos.sessions.upsert(sessionInput(key('sess-new'), { lastEventAt: at(11) }));
    const p2 = q.listSessions({}, { limit: 3, cursor: p1.nextCursor });
    expect(idsOf(p2)).toEqual([ids.A1, ids.A1a, ids.B]);
    // Cursors crossing into, and positioned within, the null-lastEventAt tail continue by id.
    const lastDated = { lastEventAt: at(5), id: ids.B };
    expect(idsOf(q.listSessions({}, { cursor: lastDated }))).toEqual([ids.U]);
    expect(idsOf(q.listSessions({}, { cursor: { lastEventAt: null, id: ids.U } }))).toEqual([]);
  });

  it('filters by project (including no project), provider, model, and search', () => {
    const { ids, q, repos } = fx;
    const p1 = repos.projects.getByRootPath('/p1')?.id ?? '';
    expect(idsOf(q.listSessions({ projectId: p1 }))).toEqual([
      ids.F,
      ids.A2,
      ids.A,
      ids.A1,
      ids.A1a,
    ]);
    expect(idsOf(q.listSessions({ projectId: null }))).toEqual([ids.U]);
    expect(idsOf(q.listSessions({ provider: 'demo' }))).toEqual([]);
    expect(idsOf(q.listSessions({ provider: 'claude-code' }))).toHaveLength(7);
    expect(idsOf(q.listSessions({ model: 'sonnet' }))).toEqual([ids.A, ids.B]);
    expect(idsOf(q.listSessions({ search: 'SESS-B' }))).toEqual([ids.B]);
    expect(idsOf(q.listSessions({ search: 'agent-1' }))).toEqual([ids.A1, ids.A1a]);
    expect(idsOf(q.listSessions({ search: ids.U }))).toEqual([ids.U]);
    // LIKE wildcards in the search text are literal.
    expect(idsOf(q.listSessions({ search: '%' }))).toEqual([]);
    expect(idsOf(q.listSessions({ search: '_' }))).toEqual([]);
    expect(idsOf(q.listSessions({ topLevelOnly: true }))).toEqual([ids.F, ids.A, ids.B, ids.U]);
  });

  it('filters by status inputs: lastEventAt bounds and observed end', () => {
    const { ids, q, repos } = fx;
    repos.sessions.upsert(sessionInput(key('sess-a', 'agent-1'), { endedAt: at(8) }));
    expect(idsOf(q.listSessions({ lastEventAfter: at(9) }))).toEqual([ids.F, ids.A2, ids.A]);
    expect(idsOf(q.listSessions({ lastEventBefore: at(8) }))).toEqual([ids.A1a, ids.B]);
    expect(idsOf(q.listSessions({ ended: true }))).toEqual([ids.A1]);
    expect(idsOf(q.listSessions({ ended: false, topLevelOnly: true }))).toHaveLength(4);
    const row = q.listSessions({ ended: true }).items[0];
    // Evidence columns are exposed for status derivation.
    expect(row).toMatchObject({ lastEventAt: at(8), endedAt: at(8), lastAttentionAt: null });
  });

  it('validates the page size and cursor', () => {
    expect(() => fx.q.listSessions({}, { limit: 0 })).toThrow(DbError);
    expect(() => fx.q.listSessions({}, { cursor: { lastEventAt: 'bad', id: 'x' } })).toThrow(
      DbError,
    );
    expect(() => fx.q.listSessions({}, { cursor: { lastEventAt: null, id: '' } })).toThrow(DbError);
  });

  it('lists distinct models per session', () => {
    const models = fx.q.modelsBySession([fx.ids.A, fx.ids.A2, fx.ids.A1a]);
    expect(models.get(fx.ids.A)).toEqual(['opus', 'sonnet']);
    expect(models.get(fx.ids.A2)).toEqual([]);
    expect(models.get(fx.ids.A1a)).toEqual([]);
  });
});
