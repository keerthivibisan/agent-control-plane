import { describe, expect, it } from 'vitest';
import { createDemoAdapter } from '@acp/adapter-demo';
import type { NormalizedEvent } from '@acp/core';
import {
  at,
  batch,
  checkpoint,
  collect,
  observed,
  setupPipeline,
  spawned,
  toolCalled,
  tokens,
  usage,
} from './helpers.js';

const E = { sessionId: 'sess-1' };

function totals(s: ReturnType<typeof setupPipeline>) {
  return s.queries.usageSummary('session').map((g) => [g.key, g.totals.tokens]);
}

describe('pipeline: demo adapter end to end', () => {
  async function ingestDemo(s: ReturnType<typeof setupPipeline>) {
    s.repos.projects.insert({ name: 'demo-api', rootPath: '/home/user/demo-api' });
    s.repos.projects.insert({ name: 'demo-web', rootPath: '/home/user/demo-web' });
    const adapter = createDemoAdapter();
    const roots = s.repos.projects.list().map((p) => ({ projectId: p.id, rootPath: p.rootPath }));
    const batches = await collect(adapter, roots, s.repos.checkpoints);
    for (const b of batches) s.pipeline.ingestBatch(b);
    return { adapter, roots, batches };
  }

  it('projects sessions, projects, usage, snapshots and edges from the fixtures', async () => {
    const s = setupPipeline();
    const { batches } = await ingestDemo(s);
    expect(batches.length).toBe(6);

    const sessions = s.queries.listSessions({}, { limit: 100 }).items;
    // api main + 2 subagents + fork, and two web sessions
    expect(sessions.length).toBe(6);
    expect(sessions.every((r) => r.projectId !== null)).toBe(true);
    expect(sessions.every((r) => r.origin === 'demo')).toBe(true);

    const subagents = sessions.filter((r) => r.providerAgentId !== null);
    expect(subagents.length).toBe(2);
    for (const child of subagents) {
      const edge = s.repos.edges.getByChild('subagent', child.id);
      expect(edge?.evidence).toContain('subagent-metadata');
      expect(edge?.provenance).toBe('observed');
    }
    expect(s.repos.checkpoints.list().length).toBe(6);
    expect(s.notices.length).toBe(6);
    expect(s.notices.every((n) => n.kind === 'events-ingested')).toBe(true);
  });

  it('re-ingesting everything twice leaves identical totals and counts', async () => {
    const s = setupPipeline();
    const { batches } = await ingestDemo(s);
    const before = {
      usage: totals(s),
      events: s.repos.events.maxId(),
      sessions: s.queries.listSessions({}, { limit: 100 }).items,
    };

    for (const b of batches) {
      const again = s.pipeline.ingestBatch(b);
      expect(again.inserted).toBe(0);
      expect(again.duplicates).toBe(b.events.length);
    }
    expect(totals(s)).toEqual(before.usage);
    expect(s.repos.events.maxId()).toBe(before.events);
    expect(s.queries.listSessions({}, { limit: 100 }).items).toEqual(before.sessions);
    // No new notices for duplicates.
    expect(s.notices.length).toBe(6);
  });

  it('scenario 8: after a restart the checkpoints make the adapter emit nothing new', async () => {
    const first = setupPipeline();
    await ingestDemo(first);
    first.db.close();

    const second = setupPipeline(first.dbPath);
    const roots = second.repos.projects
      .list()
      .map((p) => ({ projectId: p.id, rootPath: p.rootPath }));
    const batches = await collect(createDemoAdapter(), roots, second.repos.checkpoints);
    expect(batches).toEqual([]);
  });
});

describe('pipeline: usage rules', () => {
  it('scenario 2: the same message via a second channel is one record, not two', () => {
    const s = setupPipeline();
    s.pipeline.ingestEvents([
      usage({ ...E, dedupKey: 'transcript:1' }, 'msg-1', tokens(5, 40)),
      usage({ ...E, dedupKey: 'hook:1', channel: 'hook' }, 'msg-1', tokens(5, 40)),
    ]);
    const record = s.repos.usage.getRecord('claude-code', 'msg-1');
    expect(record?.observationCount).toBe(2);
    expect(totals(s)).toEqual([[expect.any(String), tokens(5, 40)]]);
  });

  it('scenario 5: shuffled and split delivery gives the same records', () => {
    const events: NormalizedEvent[] = [
      usage({ ...E, dedupKey: 'u1', occurredAt: at(1) }, 'msg-1', tokens(5, 10)),
      usage({ ...E, dedupKey: 'u2', occurredAt: at(1) }, 'msg-1', tokens(5, 90)),
      usage({ ...E, dedupKey: 'u3', occurredAt: at(2) }, 'msg-2', tokens(7, 20)),
    ];
    const a = setupPipeline();
    a.pipeline.ingestEvents(events);
    const b = setupPipeline();
    b.pipeline.ingestEvents([events[2]!]);
    b.pipeline.ingestEvents([events[1]!, events[0]!]);

    const record = (s: typeof a, id: string) => {
      const r = s.repos.usage.getRecord('claude-code', id);
      return r && { tokens: r.tokens, n: r.observationCount, at: r.occurredAt };
    };
    expect(record(a, 'msg-1')).toEqual({ tokens: tokens(5, 90), n: 2, at: at(1) });
    expect(record(b, 'msg-1')).toEqual(record(a, 'msg-1'));
    expect(record(b, 'msg-2')).toEqual(record(a, 'msg-2'));
    expect(a.queries.usageSummary('model')[0]?.totals.tokens).toEqual(
      b.queries.usageSummary('model')[0]?.totals.tokens,
    );
  });

  it('keeps unavailable usage null instead of 0', () => {
    const s = setupPipeline();
    s.pipeline.ingestEvents([
      usage({ ...E, dedupKey: 'u1' }, 'msg-1', tokens(null, null, null, null)),
    ]);
    const row = s.repos.usage.getRecord('claude-code', 'msg-1');
    expect(row?.tokens).toEqual({
      input: null,
      output: null,
      cacheCreation: null,
      cacheRead: null,
    });
  });

  it('skips and counts events that fail validation', () => {
    const s = setupPipeline();
    const result = s.pipeline.ingestEvents([
      { eventType: 'usage.reported' } as unknown as NormalizedEvent,
      usage({ ...E, dedupKey: 'ok' }, 'msg-1', tokens(1, 1)),
    ]);
    expect(result).toMatchObject({ inserted: 1, invalid: 1 });
    expect(s.pipeline.counters().eventsInvalid).toBe(1);
  });
});

describe('pipeline: atomicity', () => {
  it('rolls back events, projections and the checkpoint when the batch fails', () => {
    const s = setupPipeline();
    const bad = {
      ...batch('/src/a.jsonl', [usage({ ...E, dedupKey: 'u1' }, 'msg-1', tokens(1, 1))]),
      nextCheckpoint: { ...checkpoint('/src/a.jsonl'), byteOffset: -1 },
    };
    expect(() => s.pipeline.ingestBatch(bad)).toThrow();
    expect(s.repos.events.maxId()).toBeNull();
    expect(s.repos.usage.getRecord('claude-code', 'msg-1')).toBeUndefined();
    expect(s.queries.listSessions().items).toEqual([]);
    expect(s.repos.checkpoints.list()).toEqual([]);
    expect(s.notices).toEqual([]);
    expect(s.pipeline.counters().batchesFailed).toBe(1);

    // The same batch with a valid checkpoint then succeeds from a clean slate.
    const ok = s.pipeline.ingestBatch(batch('/src/a.jsonl', bad.events));
    expect(ok.inserted).toBe(1);
  });
});

describe('pipeline: sessions and projects', () => {
  it('assigns the project from the first cwd and never invents one outside registered roots', () => {
    const s = setupPipeline();
    const inside = s.repos.projects.insert({ name: 'p', rootPath: '/work/p' });
    s.pipeline.ingestEvents([
      observed({ sessionId: 'in', dedupKey: 'o1' }, '/work/p/pkg'),
      observed({ sessionId: 'out', dedupKey: 'o2' }, '/work/p-evil'),
    ]);
    const byId = new Map(s.queries.listSessions().items.map((r) => [r.providerSessionId, r]));
    expect(byId.get('in')?.projectId).toBe(inside.id);
    expect(byId.get('out')?.projectId).toBeNull();
  });
});

describe('pipeline: subagent edges', () => {
  it('derives the edge whatever order the spawn event and root session arrive in', () => {
    const forward = setupPipeline();
    forward.pipeline.ingestEvents([
      observed({ dedupKey: 'root' }, '/w'),
      toolCalled({ dedupKey: 'tc' }, 'toolu_1', 'Agent'),
      spawned({ dedupKey: 'sp', agentId: 'a1' }, { agentId: 'a1', toolUseId: 'toolu_1', depth: 1 }),
    ]);
    const reverse = setupPipeline();
    reverse.pipeline.ingestEvents([
      spawned({ dedupKey: 'sp', agentId: 'a1' }, { agentId: 'a1', toolUseId: 'toolu_1', depth: 1 }),
      toolCalled({ dedupKey: 'tc' }, 'toolu_1', 'Agent'),
      observed({ dedupKey: 'root' }, '/w'),
    ]);
    for (const s of [forward, reverse]) {
      const child = s.repos.sessions.getByKey({
        provider: 'claude-code',
        providerSessionId: 'sess-1',
        providerAgentId: 'a1',
      });
      expect(child).toBeDefined();
      const edge = s.repos.edges.getByChild('subagent', child!.id);
      expect(edge?.evidence.sort()).toEqual(['spawn-tool-use', 'subagent-metadata']);
    }
  });

  it('creates no edge without spawn evidence (a lone subagent transcript proves nothing)', () => {
    const s = setupPipeline();
    s.pipeline.ingestEvents([
      observed({ dedupKey: 'root' }, '/w'),
      usage({ dedupKey: 'u', agentId: 'a9' }, 'msg-a9', tokens(1, 1)),
    ]);
    expect(s.repos.edges.listForSessions(s.queries.listSessions().items.map((r) => r.id))).toEqual(
      [],
    );
  });
});

describe('pipeline: forks', () => {
  it('flags tied fork copies as ambiguous and creates no continuation edge', () => {
    const s = setupPipeline();
    const t = at(5);
    s.pipeline.ingestEvents([
      usage({ sessionId: 'orig', dedupKey: 'o1', occurredAt: t }, 'msg-1', tokens(1, 10)),
      usage({ sessionId: 'fork', dedupKey: 'f1', occurredAt: t }, 'msg-1', tokens(1, 10)),
    ]);
    expect(s.repos.usage.getRecord('claude-code', 'msg-1')?.attributionAmbiguous).toBe(true);
    const ids = s.queries.listSessions().items.map((r) => r.id);
    expect(s.repos.edges.listForSessions(ids)).toEqual([]);
    // Counted once overall.
    expect(s.queries.usageSummary('model')[0]?.totals.recordCount).toBe(1);
  });

  it('derives a continuation edge when the original saw the message strictly earlier', () => {
    const s = setupPipeline();
    s.pipeline.ingestEvents([
      usage({ sessionId: 'orig', dedupKey: 'o1', occurredAt: at(1) }, 'msg-1', tokens(1, 10)),
      usage({ sessionId: 'fork', dedupKey: 'f1', occurredAt: at(9) }, 'msg-1', tokens(1, 10)),
    ]);
    const orig = s.repos.sessions.getByKey({
      provider: 'claude-code',
      providerSessionId: 'orig',
      providerAgentId: null,
    });
    const fork = s.repos.sessions.getByKey({
      provider: 'claude-code',
      providerSessionId: 'fork',
      providerAgentId: null,
    });
    const edge = s.repos.edges.getByChild('continuation', fork!.id);
    expect(edge?.parentSessionId).toBe(orig!.id);
    expect(edge?.evidence).toEqual(['shared-message-history']);
    expect(s.repos.usage.getRecord('claude-code', 'msg-1')?.sessionId).toBe(orig!.id);
  });
});

describe('pipeline: subagent project inheritance (P1-F F2 finding)', () => {
  const sub = { sessionId: 'sess-1', agentId: 'a1' };
  const projectOf = (s: ReturnType<typeof setupPipeline>, agentId: string | null) =>
    s.repos.sessions.getByKey({
      provider: 'claude-code',
      providerSessionId: 'sess-1',
      providerAgentId: agentId,
    })?.projectId;

  it('gives a subagent whose cwd is outside every root its parent session project', () => {
    const s = setupPipeline();
    const p = s.repos.projects.insert({ name: 'p', rootPath: '/work/p' });
    s.pipeline.ingestEvents([
      observed({ dedupKey: 'root' }, '/work/p'),
      observed({ ...sub, dedupKey: 'sub' }, '/elsewhere/worktree'),
      usage({ ...sub, dedupKey: 'u' }, 'msg-sub', tokens(1, 5)),
    ]);
    expect(projectOf(s, 'a1')).toBe(p.id);
    expect(s.queries.usageSummary('project', { projectId: p.id })[0]?.totals.recordCount).toBe(1);
  });

  it('assigns subagents that arrived before their parent once the parent is placed', () => {
    const s = setupPipeline();
    const p = s.repos.projects.insert({ name: 'p', rootPath: '/work/p' });
    s.pipeline.ingestEvents([observed({ ...sub, dedupKey: 'sub' }, '/elsewhere/worktree')]);
    expect(projectOf(s, 'a1')).toBeNull();
    const result = s.pipeline.ingestEvents([observed({ dedupKey: 'root' }, '/work/p')]);
    expect(projectOf(s, 'a1')).toBe(p.id);
    expect(result.sessionIds.length).toBe(2);
  });

  it('never assigns a project when the parent has none', () => {
    const s = setupPipeline();
    s.repos.projects.insert({ name: 'p', rootPath: '/work/p' });
    s.pipeline.ingestEvents([
      observed({ dedupKey: 'root' }, '/other'),
      observed({ ...sub, dedupKey: 'sub' }, '/elsewhere'),
    ]);
    expect(projectOf(s, null)).toBeNull();
    expect(projectOf(s, 'a1')).toBeNull();
  });
});
