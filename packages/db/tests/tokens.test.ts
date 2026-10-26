// Synthetic fixture for the project Tokens query (redesign R-F). Ids, titles and numbers are fake.
import { buildUsageRecord, type TokenCounts } from '@acp/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTokenQueries,
  DbError,
  type ProjectTokens,
  type TokenQueries,
} from '../src/index.js';
import { key, sessionInput, tokens, usageEvent, snapshotEvent } from './fixtures.js';
import { thrown } from './helpers.js';
import { setupWorkspace, ticketWithRun, BUDGET, type WorkspaceStore } from './workspace/setup.js';

const DAY1 = '2026-10-12T10:00:00.000Z';
const DAY2 = '2026-10-13T10:00:00.000Z';

/*
 * Project "web" (P) and another project (Q):
 *
 *   EXT   P, external, "Fix login"  m1 day1 (fork-copied into FORK), m2 day2 (input null)
 *   EXT2  P, external               m9 undated, every category null, no model
 *   LEAD  P, WEB-1 lead             m3 day2           (+ snapshot with no cost)
 *   LSUB  P, LEAD's own helper session (same provider session id)  m4 day2
 *   W1    P, WEB-1 worker           m5 day2           (also linked later by WEB-2's lead: retry)
 *   REV   no project, WEB-1 reviewer  m6 day2         (in scope through its run)
 *   P3    P, lead of a Phase 3 run without a ticket   m10 day2
 *   FORK  P, a fork of EXT: its copy of m1 is not a new record
 *   OTHER Q                          m8 day2 (never in P's numbers)
 *
 * WEB-2 has a run whose lead has no observed session.
 */
interface Fixture {
  store: WorkspaceStore;
  q: TokenQueries;
  ids: Record<'EXT' | 'EXT2' | 'LEAD' | 'LSUB' | 'W1' | 'REV' | 'P3' | 'FORK' | 'OTHER', string>;
  tickets: { web1: string; web2: string };
}

let fx: Fixture;

function build(): Fixture {
  const store = setupWorkspace();
  const { repos, orch, projectId } = store;
  const other = repos.projects.insert({ name: 'other', rootPath: '/home/user/other' }).id;

  const s = (
    providerSessionId: string,
    projectOf: string | null,
    extra: { agent?: string; title?: string; lastEventAt?: string } = {},
  ) =>
    repos.sessions.upsert(
      sessionInput(key(providerSessionId, extra.agent ?? null), {
        projectId: projectOf,
        title: extra.title ?? null,
        lastEventAt: extra.lastEventAt ?? null,
      }),
    ).id;
  const ids = {
    EXT: s('sess-ext', projectId, { title: 'Fix login' }),
    EXT2: s('sess-ext2', projectId),
    LEAD: s('sess-lead', projectId, { title: 'Lead' }),
    LSUB: s('sess-lead', projectId, { agent: 'agent-x' }),
    W1: s('sess-w1', projectId),
    REV: s('sess-rev', null),
    P3: s('sess-p3', projectId),
    FORK: s('sess-fork', projectId, { lastEventAt: '2026-10-13T09:00:00.000Z' }),
    OTHER: s('sess-other', other),
  };

  const web1 = ticketWithRun(store, 'Dark mode');
  const reviewer = orch.agentRuns.insert({
    runId: web1.run.id,
    kind: 'reviewer',
    parentAgentRunId: web1.lead.id,
    role: 'Reviewer',
    task: 'Review the merged change',
  });
  const web2 = ticketWithRun(store, 'Search');
  const p3 = orch.runs.insert({ projectId, title: 'Ad hoc', budget: BUDGET });
  const p3Lead = orch.agentRuns.insert({
    runId: p3.id,
    kind: 'lead',
    parentAgentRunId: null,
    role: 'Lead',
    task: null,
  });
  const link = (agentRunId: string, providerSessionId: string, relation = 'primary' as const) =>
    orch.agentRunSessions.link({
      agentRunId,
      provider: 'claude-code',
      providerSessionId,
      relation,
    });
  link(web1.lead.id, 'sess-lead');
  link(web1.helper.id, 'sess-w1');
  link(reviewer.id, 'sess-rev');
  link(p3Lead.id, 'sess-p3');
  // A later link to the same provider session never moves it to another role or ticket.
  orch.agentRunSessions.link({
    agentRunId: web2.lead.id,
    provider: 'claude-code',
    providerSessionId: 'sess-w1',
    relation: 'retry',
  });

  const rec = (
    messageId: string,
    sessionId: string,
    t: TokenCounts,
    model: string | null,
    occurredAt: string | null,
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
      conflict: false,
      attributionAmbiguous: false,
      source: 'transcript',
    });

  // m1 is seen in EXT and, copied by a fork with the original timestamp, in FORK. Selection and
  // attribution (core) make one record for it, as the pipeline does.
  const observe = (dedup: string, providerSessionId: string, sessionId: string) => {
    const event = usageEvent(
      dedup,
      key(providerSessionId),
      'm1',
      tokens(10, 100, 50, 1000),
      DAY1,
      'opus',
    );
    const { id } = repos.events.insertIfNew({ event, sessionId, projectId });
    repos.usage.insertObservation({
      eventId: id,
      provider: 'claude-code',
      messageId: 'm1',
      sessionId,
      occurredAt: DAY1,
      requestId: null,
      model: 'opus',
      tokens: tokens(10, 100, 50, 1000),
    });
  };
  observe('ev-m1-ext', 'sess-ext', ids.EXT);
  observe('ev-m1-fork', 'sess-fork', ids.FORK);
  const draft = buildUsageRecord(repos.usage.listObservationsByMessage('claude-code', 'm1'));
  if (draft === null) throw new Error('expected a usage record for m1');
  const owner = repos.sessions.getByKey(draft.session);
  if (owner === undefined) throw new Error('attributed session missing');
  repos.usage.upsertRecord({
    provider: 'claude-code',
    messageId: 'm1',
    sessionId: owner.id,
    selectedEventId: draft.selectedEventId,
    occurredAt: DAY1,
    requestId: null,
    model: draft.model,
    tokens: draft.tokens,
    observationCount: draft.observationCount,
    conflict: draft.conflict,
    attributionAmbiguous: draft.attributionAmbiguous,
    source: 'transcript',
  });

  rec('m2', ids.EXT, tokens(null, 20, null, null), 'sonnet', DAY2);
  rec('m3', ids.LEAD, tokens(5, 50, 5, 500), 'opus', DAY2);
  rec('m4', ids.LSUB, tokens(1, 10, null, 100), 'opus', DAY2);
  rec('m5', ids.W1, tokens(2, 20, 20, 200), 'sonnet', DAY2);
  rec('m6', ids.REV, tokens(1, 1, 1, 1), 'opus', DAY2);
  rec('m8', ids.OTHER, tokens(9000, 9000, 9000, 9000), 'opus', DAY2);
  rec('m9', ids.EXT2, tokens(null, null, null, null), null, null);
  rec('m10', ids.P3, tokens(3, 30, 3, 300), 'opus', DAY2);

  // Provider-reported running totals: stored, the latest one shown, never summed.
  const snap = (
    dedup: string,
    providerSessionId: string,
    sessionId: string,
    at: string,
    cost: number | null,
  ) => {
    const event = snapshotEvent(dedup, key(providerSessionId), at, cost);
    const { id } = repos.events.insertIfNew({ event, sessionId, projectId });
    repos.snapshots.insert({
      eventId: id,
      provider: 'claude-code',
      sessionId,
      occurredAt: at,
      observedAt: event.observedAt,
      snapshot: event.payload,
    });
  };
  snap('snap-ext-1', 'sess-ext', ids.EXT, DAY1, 0.5);
  snap('snap-ext-2', 'sess-ext', ids.EXT, DAY2, 1.25);
  snap('snap-lead', 'sess-lead', ids.LEAD, DAY2, null);

  return {
    store,
    q: createTokenQueries(store.db),
    ids,
    tickets: { web1: web1.ticket.id, web2: web2.ticket.id },
  };
}

beforeEach(() => {
  fx = build();
});

const tokensOf = (rows: { totals: { tokens: TokenCounts } }[]) => rows.map((r) => r.totals.tokens);
function get(range?: Parameters<TokenQueries['projectTokens']>[1]): ProjectTokens {
  const result = fx.q.projectTokens(fx.store.projectId, range);
  if (result === undefined) throw new Error('project missing');
  return result;
}

describe('projectTokens (R-F)', () => {
  it('sums direct usage of the project’s sessions, null-preserving, with partial counts', () => {
    const t = get();
    expect(t.totals).toEqual({
      recordCount: 8,
      tokens: { input: 22, output: 231, cacheCreation: 79, cacheRead: 2101 },
      recordsWithUnavailable: { input: 2, output: 1, cacheCreation: 3, cacheRead: 2 },
    });
    expect(t.headline).toEqual({
      newWork: 253,
      totalProcessed: 2433,
      cacheReuseShare: 2101 / 2433,
    });
    expect(t.range).toEqual({ from: null, to: null });
  });

  it('counts a fork-shared message once, under the session it is attributed to', () => {
    const t = get();
    const ext = t.bySession.find((r) => r.sessionId === fx.ids.EXT);
    expect(ext?.totals.recordCount).toBe(2); // m1 and m2
    expect(t.bySession.some((r) => r.sessionId === fx.ids.FORK)).toBe(false);
    // The fork is still one of the project's sessions; it just has no usage of its own.
    expect(t.sessions).toEqual({ total: 8, withUsage: 7 });
  });

  it('keeps an all-null record null (never 0) and leaves undated records off the days', () => {
    const t = get();
    const ext2 = t.bySession.find((r) => r.sessionId === fx.ids.EXT2);
    expect(ext2?.totals.tokens).toEqual({
      input: null,
      output: null,
      cacheCreation: null,
      cacheRead: null,
    });
    expect(ext2?.headline).toEqual({ newWork: null, totalProcessed: null, cacheReuseShare: null });
    expect(t.bySession.at(-1)?.sessionId).toBe(fx.ids.EXT2); // unavailable sorts last
    expect(t.byModel.find((r) => r.model === null)?.totals.recordCount).toBe(1);
    expect(t.byDay.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-13']);
    const dated = t.byDay.reduce((n, d) => n + d.totals.recordCount, 0);
    expect(dated).toBe(t.totals.recordCount - 1);
  });

  it('attributes agent sessions to their run’s role and ticket, others to external', () => {
    const t = get();
    expect(t.byRole.map((r) => r.role)).toEqual(['lead', 'worker', 'reviewer', 'external']);
    const role = (r: string) => t.byRole.find((x) => x.role === r)?.totals;
    // The lead's own helper session (same provider session) and the Phase 3 lead count as lead.
    expect(role('lead')?.tokens).toEqual({
      input: 9,
      output: 90,
      cacheCreation: 8,
      cacheRead: 900,
    });
    expect(role('lead')?.recordsWithUnavailable.cacheCreation).toBe(1);
    expect(role('worker')?.tokens).toEqual(tokens(2, 20, 20, 200));
    expect(role('reviewer')?.tokens).toEqual(tokens(1, 1, 1, 1));
    expect(role('external')?.recordCount).toBe(3); // m1, m2, m9
    // Roles partition the records: nothing is counted twice or dropped.
    expect(t.byRole.reduce((n, r) => n + r.totals.recordCount, 0)).toBe(t.totals.recordCount);
  });

  it('groups by ticket through the runs’ agents; a ticket with no observed usage stays null', () => {
    const t = get();
    expect(t.runs).toBe(3);
    expect(t.ticketsWithRuns).toBe(2);
    expect(t.byTicket.map((r) => r.key)).toEqual(['WEB-1', 'WEB-2']);
    expect(t.byTicket[0]).toMatchObject({ ticketId: fx.tickets.web1, title: 'Dark mode' });
    // m3 + m4 (lead), m5 (worker, despite WEB-2's later retry link), m6 (reviewer).
    expect(t.byTicket[0]?.totals.tokens).toEqual(tokens(9, 81, 26, 801));
    expect(t.byTicket[1]?.totals).toEqual({
      recordCount: 0,
      tokens: tokens(null, null, null, null),
      recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    });
  });

  it('groups by model and orders by new work, with the session’s latest estimated cost', () => {
    const t = get();
    expect(t.byModel.map((r) => r.model)).toEqual(['opus', 'sonnet', null]);
    expect(tokensOf(t.byModel.slice(0, 2))).toEqual([
      tokens(20, 191, 59, 1901),
      tokens(2, 40, 20, 200),
    ]);
    const ext = t.bySession.find((r) => r.sessionId === fx.ids.EXT);
    expect(ext).toMatchObject({ title: 'Fix login', latestSnapshot: { reportedCostUsd: 1.25 } });
    const lead = t.bySession.find((r) => r.sessionId === fx.ids.LEAD);
    expect(lead?.latestSnapshot).toEqual({ reportedCostUsd: null });
    const w1 = t.bySession.find((r) => r.sessionId === fx.ids.W1);
    expect(w1?.latestSnapshot).toBeNull();
    expect(t.bySession[0]?.sessionId).toBe(fx.ids.EXT); // 130 new-work tokens
  });

  it('a range filters records by time (from inclusive, to exclusive)', () => {
    const t = get({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' });
    expect(t.range).toEqual({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' });
    // m1 is on day 1 and m9 has no time: both are outside any range.
    expect(t.totals.recordCount).toBe(6);
    expect(t.totals.tokens).toEqual({ input: 12, output: 131, cacheCreation: 29, cacheRead: 1101 });
    expect(t.byDay.map((d) => d.day)).toEqual(['2026-10-13']);
    // FORK was active in the range (no usage); EXT2's only record is undated.
    expect(t.sessions).toEqual({ total: 7, withUsage: 6 });
    expect(t.runs).toBe(3);

    const day1 = get({ from: '2026-10-12T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' });
    expect(day1.totals.tokens).toEqual(tokens(10, 100, 50, 1000));
    // The runs started after the range; the cost is the latest snapshot before the range ended.
    expect(day1.runs).toBe(0);
    expect(day1.byTicket).toEqual([]);
    expect(day1.bySession[0]?.latestSnapshot).toEqual({ reportedCostUsd: 0.5 });
    expect(day1.byRole.map((r) => r.role)).toEqual(['external']);
  });

  it('an empty range has null totals, never 0', () => {
    const t = get({ from: '2027-01-01T00:00:00.000Z' });
    expect(t.totals.tokens).toEqual(tokens(null, null, null, null));
    expect(t.headline).toEqual({ newWork: null, totalProcessed: null, cacheReuseShare: null });
    expect(t.bySession).toEqual([]);
    expect(t.byDay).toEqual([]);
  });

  it('returns undefined for an unknown project and rejects a bad range', () => {
    expect(fx.q.projectTokens('nope')).toBeUndefined();
    const e = thrown(() =>
      get({ from: '2026-10-14T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' }),
    );
    expect(e).toBeInstanceOf(DbError);
    expect((e as DbError).code).toBe('invalid_input');
    expect(thrown(() => get({ from: 'yesterday' }))).toBeInstanceOf(DbError);
  });
});

describe('ticketTokens (v0.3.0 T-A, the ticket badge)', () => {
  it('equals the Tokens page’s byTicket row for each ticket, nulls kept null', () => {
    const t = get();
    for (const id of [fx.tickets.web1, fx.tickets.web2]) {
      const row = t.byTicket.find((r) => r.ticketId === id);
      const one = fx.q.ticketTokens(fx.store.projectId, id);
      expect(one).toEqual({ totals: row?.totals, headline: row?.headline });
    }
    expect(fx.q.ticketTokens(fx.store.projectId, fx.tickets.web1)?.totals.tokens).toEqual(
      tokens(9, 81, 26, 801),
    );
    // WEB-2 has a run but no observed usage: every category unavailable, never 0.
    expect(fx.q.ticketTokens(fx.store.projectId, fx.tickets.web2)?.headline).toEqual({
      newWork: null,
      totalProcessed: null,
      cacheReuseShare: null,
    });
  });

  it('an unknown ticket has no records; an unknown project is undefined', () => {
    expect(fx.q.ticketTokens(fx.store.projectId, 'no-such-ticket')?.totals.recordCount).toBe(0);
    expect(fx.q.ticketTokens('no-such-project', fx.tickets.web1)).toBeUndefined();
  });
});
