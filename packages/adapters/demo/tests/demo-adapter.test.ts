import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NormalizedEventSchema } from '@acp/core';
import type {
  Checkpoint,
  CheckpointStore,
  EventOf,
  IngestionBatch,
  NormalizedEvent,
  ObservationAdapter,
  RegisteredRoot,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  createDemoAdapter,
  DEMO_BASE_TIME,
  DemoFixtureError,
  DemoHookError,
} from '../src/index.js';

const API: RegisteredRoot = { projectId: 'p-api', rootPath: '/home/user/demo-api' };
const WEB: RegisteredRoot = { projectId: 'p-web', rootPath: '/home/user/demo-web' };
const FIXED_NOW = () => new Date('2026-10-12T00:00:00.000Z');

/** In-memory stand-in for the pipeline: commits each batch's checkpoint after consuming it. */
class MemoryStore implements CheckpointStore {
  readonly map = new Map<string, Checkpoint>();
  get(sourcePath: string): Checkpoint | undefined {
    return this.map.get(sourcePath);
  }
}

async function drain(
  adapter: ObservationAdapter,
  roots: readonly RegisteredRoot[],
  store = new MemoryStore(),
): Promise<{ batches: IngestionBatch[]; events: NormalizedEvent[] }> {
  const batches: IngestionBatch[] = [];
  for await (const batch of adapter.poll(roots, store)) {
    batches.push(batch);
    store.map.set(batch.sourcePath, batch.nextCheckpoint);
  }
  return { batches, events: batches.flatMap((b) => b.events) };
}

function ofType<T extends NormalizedEvent['eventType']>(
  events: NormalizedEvent[],
  type: T,
): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.eventType === type);
}

describe('demo adapter', () => {
  it('is deterministic: two runs give deep-equal events and checkpoints', async () => {
    const a = await drain(createDemoAdapter({ now: FIXED_NOW }), [API, WEB]);
    const b = await drain(createDemoAdapter({ now: FIXED_NOW }), [API, WEB]);
    expect(a.events.length).toBeGreaterThan(50);
    expect(b).toEqual(a);
    // The default clock is fixed too, so even an un-configured adapter is deterministic.
    expect((await drain(createDemoAdapter(), [API, WEB])).events).toEqual(
      (await drain(createDemoAdapter(), [API, WEB])).events,
    );
  });

  it('emits only schema-valid demo events with unique dedup keys', async () => {
    const { events } = await drain(createDemoAdapter({ now: FIXED_NOW }), [API, WEB]);
    for (const e of events) {
      expect(NormalizedEventSchema.parse(e)).toEqual(e);
      expect(e.provider).toBe('demo');
      expect(e.source.channel).toBe('demo');
      expect(e.observedAt).toBe(FIXED_NOW().toISOString());
    }
    expect(new Set(events.map((e) => e.dedupKey)).size).toBe(events.length);
  });

  it('places timestamps relative to the base time', async () => {
    const { events } = await drain(
      createDemoAdapter({ baseTime: '2030-01-01T00:00:00.000Z', now: FIXED_NOW }),
      [API, WEB],
    );
    // Nothing is released before the base time.
    expect(events).toEqual([]);
    const later = await drain(
      createDemoAdapter({
        baseTime: '2030-01-01T00:00:00.000Z',
        now: () => new Date('2030-01-02T00:00:00.000Z'),
      }),
      [API],
    );
    const main = later.events.filter((e) => e.source.path === 'demo://api-main');
    expect(main[0]?.occurredAt).toBe('2030-01-01T00:00:00.000Z');
    expect(main[1]?.occurredAt).toBe('2030-01-01T00:00:01.000Z');
  });

  it('covers the required demo scenarios', async () => {
    const { events } = await drain(createDemoAdapter({ now: FIXED_NOW }), [API, WEB]);

    // Two projects.
    const cwds = new Set(ofType(events, 'session.observed').map((e) => e.payload.cwd));
    expect(cwds).toEqual(new Set(['/home/user/demo-api', '/home/user/demo-web']));

    // One session with two subagents whose spawn tool calls are in the parent transcript.
    const spawned = ofType(events, 'subagent.spawned');
    expect(spawned).toHaveLength(2);
    const parentId = spawned[0]?.payload.parentProviderSessionId;
    expect(spawned.every((s) => s.payload.parentProviderSessionId === parentId)).toBe(true);
    const parentToolIds = ofType(events, 'tool.called')
      .filter((t) => t.providerSessionId === parentId && t.providerAgentId === null)
      .map((t) => t.payload.toolUseId);
    for (const s of spawned) {
      expect(parentToolIds).toContain(s.payload.spawnToolUseId);
      expect(s.providerAgentId).toBe(s.payload.agentId);
    }

    // A fork: a different session repeats message ids first seen in the parent.
    const usage = ofType(events, 'usage.reported');
    const sessionsByMessage = new Map<string, Set<string>>();
    for (const u of usage) {
      const set = sessionsByMessage.get(u.payload.messageId) ?? new Set<string>();
      set.add(u.providerSessionId ?? '');
      sessionsByMessage.set(u.payload.messageId, set);
    }
    expect([...sessionsByMessage.values()].some((s) => s.size === 2)).toBe(true);

    // Streaming duplicates: one message id reported several times with growing output.
    const first = usage.filter(
      (u) => u.payload.messageId === 'msg_demo_0001' && u.providerSessionId === parentId,
    );
    expect(first.map((u) => u.payload.tokens.output)).toEqual([40, 180, 260]);

    // Missing usage categories stay null, never 0.
    expect(usage.some((u) => u.payload.tokens.cacheRead === null)).toBe(true);
    expect(usage.some((u) => u.payload.tokens.input === null)).toBe(true);

    // A cumulative snapshot with unknown scope, titles from both sources, exactly one end.
    expect(ofType(events, 'usage.snapshot').map((e) => e.payload.scope)).toEqual(['unknown']);
    expect(new Set(ofType(events, 'session.titled').map((e) => e.payload.titleSource))).toEqual(
      new Set(['user', 'ai']),
    );
    expect(ofType(events, 'session.ended')).toHaveLength(1);
  });

  it('only polls sources whose cwd is inside a registered root', async () => {
    const adapter = createDemoAdapter({ now: FIXED_NOW });
    const { events } = await drain(adapter, [API]);
    expect(events.length).toBeGreaterThan(0);
    expect(
      ofType(events, 'session.observed').every((e) => e.payload.cwd === '/home/user/demo-api'),
    ).toBe(true);
    // Segment-wise containment: a sibling with a shared prefix is not inside.
    expect(
      (await drain(adapter, [{ projectId: 'x', rootPath: '/home/user/demo-ap' }])).events,
    ).toEqual([]);
    // A registered parent directory contains both projects.
    const all = await drain(adapter, [{ projectId: 'home', rootPath: '/home/user' }]);
    expect(all.events.length).toBe((await drain(adapter, [API, WEB])).events.length);
  });

  it('reports unregistered cwds as candidates', async () => {
    const adapter = createDemoAdapter({ now: FIXED_NOW });
    expect(await adapter.discoverCandidates([API])).toEqual([
      {
        provider: 'demo',
        cwd: '/home/user/demo-web',
        sessionCount: 2,
        lastSeenAt: new Date(Date.parse(DEMO_BASE_TIME) + 14340 * 1000).toISOString(),
      },
    ]);
    expect(await adapter.discoverCandidates([API, WEB])).toEqual([]);
  });

  it('resumes from checkpoints and releases records as the clock advances', async () => {
    let nowMs = Date.parse(DEMO_BASE_TIME) + 12_000;
    const adapter = createDemoAdapter({ now: () => new Date(nowMs) });
    const store = new MemoryStore();

    const early = await drain(adapter, [API, WEB], store);
    expect(early.events.length).toBeGreaterThan(0);
    // Re-polling with committed checkpoints yields nothing new.
    expect((await drain(adapter, [API, WEB], store)).batches).toEqual([]);

    nowMs = Date.parse(DEMO_BASE_TIME) + 2 * DAY_S * 1000;
    const late = await drain(adapter, [API, WEB], store);
    const full = await drain(createDemoAdapter({ now: FIXED_NOW }), [API, WEB]);
    const keys = [...early.events, ...late.events].map((e) => e.dedupKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(full.events.map((e) => e.dedupKey)));
  });

  it('resets a checkpoint whose head hash or identity no longer matches', async () => {
    const adapter = createDemoAdapter({ now: FIXED_NOW });
    const store = new MemoryStore();
    const first = await drain(adapter, [API], store);
    const [sourcePath, cp] = [...store.map.entries()][0] ?? [];
    expect(sourcePath).toBeDefined();
    if (sourcePath === undefined || cp === undefined) return;
    store.map.set(sourcePath, { ...cp, headHash: 'stale' });
    const again = await drain(adapter, [API], store);
    expect(again.batches.map((b) => b.sourcePath)).toEqual([sourcePath]);
    expect(again.events).toEqual(first.batches.find((b) => b.sourcePath === sourcePath)?.events);
  });

  it('ignores hook deliveries and rejects non-object bodies', () => {
    const adapter = createDemoAdapter();
    expect(adapter.normalizeHook({ hook_event_name: 'Stop' }, DEMO_BASE_TIME)).toEqual([]);
    expect(() => adapter.normalizeHook('nope', DEMO_BASE_TIME)).toThrow(DemoHookError);
    expect(() => adapter.normalizeHook(null, DEMO_BASE_TIME)).toThrow(DemoHookError);
  });

  it('reports honest capabilities', async () => {
    const caps = await createDemoAdapter().capabilities();
    expect(caps.provider).toBe('demo');
    expect(caps.managedExecution).toBe(false);
    expect(caps.limitations.join(' ')).toMatch(/demo/i);
  });

  it('rejects invalid fixtures with a typed error', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'acp-demo-'));
    await writeFile(
      path.join(dir, 'bad.json'),
      JSON.stringify({
        source: 'bad',
        providerSessionId: 's',
        providerAgentId: null,
        cwd: '/home/user/demo-api',
        records: [{ id: 'r1', t: 0, eventType: 'usage.reported', payload: { kind: 'per-turn' } }],
      }),
    );
    const adapter = createDemoAdapter({ fixturesDir: dir });
    await expect(drain(adapter, [API])).rejects.toThrow(DemoFixtureError);

    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ source: 'bad', records: [] }));
    await expect(drain(createDemoAdapter({ fixturesDir: dir }), [API])).rejects.toThrow(
      DemoFixtureError,
    );
  });
});

const DAY_S = 24 * 60 * 60;
