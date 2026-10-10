import { NormalizedEventSchema } from '@acp/core';
import type { NormalizedEvent } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { DiagnosticsCollector } from '../src/diagnostics.js';
import { TranscriptIngestor } from '../src/ingestor.js';
import {
  drain,
  expectGolden,
  FIXED_NOW,
  MemoryStore,
  portable,
  scenarioRoot,
} from './helpers/scenarios.js';
import { makeTempDir, put, PROJECT_DIR, SID_1 } from './helpers/temp-claude-dir.js';

const S1 = 'c0ffee00-0000-4000-8000-000000000001';

function makeIngestor(claudeDir: string) {
  const diagnostics = new DiagnosticsCollector();
  const ingestor = new TranscriptIngestor({
    claudeDir,
    now: FIXED_NOW,
    maxFileBytes: 512 * 1024 * 1024,
    chunkBytes: 1024 * 1024,
    diagnostics,
  });
  return { ingestor, diagnostics };
}

async function ingestScenario(name: string) {
  const root = await scenarioRoot(name);
  const { ingestor, diagnostics } = makeIngestor(root);
  const result = await drain(ingestor);
  return { ...result, root, diagnostics, events: portable(result.events, root) };
}

const spawned = (events: NormalizedEvent[]) =>
  events.filter((e) => e.eventType === 'subagent.spawned');

const metaPath = (agent: string) => `${PROJECT_DIR}/${SID_1}/subagents/agent-${agent}.meta.json`;
const agentPath = (agent: string) => `${PROJECT_DIR}/${SID_1}/subagents/agent-${agent}.jsonl`;
const parentLine = {
  type: 'user',
  uuid: 'u1',
  cwd: '/home/user/project',
  timestamp: '2026-10-01T10:00:00.000Z',
  message: { content: 'x' },
};

/** A temp Claude dir with a parent transcript, a subagent transcript, and the given meta text. */
async function tempWithMeta(meta: string) {
  const dir = await makeTempDir();
  const line = `${JSON.stringify(parentLine)}\n`;
  await put(dir, `projects/${PROJECT_DIR}/${SID_1}.jsonl`, line);
  await put(dir, `projects/${agentPath('afake9')}`, line);
  await put(dir, `projects/${metaPath('afake9')}`, meta);
  return dir;
}

describe('C5 subagent meta goldens', () => {
  for (const name of [
    '03-subagent-with-meta',
    '04-subagent-without-meta',
    '05-nested-subagent',
  ] as const) {
    it(`${name}: matches the reviewed golden, and every event is schema-valid`, async () => {
      const { events } = await ingestScenario(name);
      for (const e of events) expect(NormalizedEventSchema.safeParse(e).success).toBe(true);
      expect(new Set(events.map((e) => e.dedupKey)).size).toBe(events.length);
      await expectGolden(name, events);
    });

    it(`${name}: a second poll emits nothing new`, async () => {
      const root = await scenarioRoot(name);
      const { ingestor } = makeIngestor(root);
      const store = new MemoryStore();
      await drain(ingestor, store);
      expect((await drain(ingestor, store)).events).toEqual([]);
    });
  }
});

describe('scenario 3: subagent with meta', () => {
  it('emits subagent.spawned on the child key, matching a tool.called in the parent', async () => {
    const { events } = await ingestScenario('03-subagent-with-meta');
    const [spawn, ...extra] = spawned(events);
    expect(extra).toEqual([]);
    expect(spawn).toMatchObject({
      providerSessionId: S1,
      providerAgentId: 'afake0301',
      occurredAt: null,
      provenance: 'observed',
      source: { channel: 'subagent-meta', providerVersion: null, byteOffset: 0 },
      payload: {
        parentProviderSessionId: S1,
        agentId: 'afake0301',
        agentType: 'Explore',
        spawnToolUseId: 'toolu_fake0301',
        spawnDepth: 1,
        model: 'claude-haiku-4-5',
      },
    });
    expect(spawn?.dedupKey).toMatch(new RegExp(`^cc:meta:${S1}:afake0301:h:[0-9a-f]{64}#spawned$`));
    const parentCall = events.find(
      (e) =>
        e.eventType === 'tool.called' &&
        e.providerAgentId === null &&
        e.payload.toolUseId === 'toolu_fake0301',
    );
    expect(parentCall).toBeDefined();
    const childEvents = events.filter(
      (e) => e.providerAgentId === 'afake0301' && e.eventType !== 'subagent.spawned',
    );
    expect(childEvents.length).toBeGreaterThan(0);
  });
});

describe('scenario 4: subagent without meta', () => {
  it('emits the subagent transcript events but no subagent.spawned', async () => {
    const { events } = await ingestScenario('04-subagent-without-meta');
    expect(spawned(events)).toEqual([]);
    expect(events.some((e) => e.providerAgentId === 'afake0401')).toBe(true);
  });
});

describe('scenario 5: nested subagent (synthetic)', () => {
  it('reports depth 2 and the spawning tool id; the parent is core business', async () => {
    const { events } = await ingestScenario('05-nested-subagent');
    const spawns = spawned(events);
    expect(spawns.map((e) => e.providerAgentId).sort()).toEqual(['afake0501', 'afake0502']);
    const nested = spawns.find((e) => e.providerAgentId === 'afake0502');
    expect(nested?.payload).toMatchObject({
      spawnDepth: 2,
      spawnToolUseId: 'toolu_fake0511',
      // The adapter does not guess the parent: it names the session directory it was found in.
      parentProviderSessionId: S1,
    });
    const call = events.find(
      (e) => e.eventType === 'tool.called' && e.payload.toolUseId === 'toolu_fake0511',
    );
    expect(call?.providerAgentId).toBe('afake0501');
  });
});

describe('meta file handling', () => {
  it('redacts and caps the description, and ignores every other field', async () => {
    const meta = JSON.stringify({
      agentType: 'Explore',
      description: `look at sk-ant-api03-abcdefghijklmnop ${'long '.repeat(80)}`,
      toolUseId: 'toolu_1',
      spawnDepth: 1,
      prompt: 'PROMPT-SECRET',
      worktree: { path: '/never/read' },
    });
    const dir = await tempWithMeta(meta);
    const { events } = await drain(makeIngestor(dir).ingestor, new MemoryStore(), [
      { projectId: 'p', rootPath: '/home/user/project' },
    ]);
    const [spawn] = spawned(events);
    if (spawn?.eventType !== 'subagent.spawned') throw new Error('expected a spawn event');
    expect(spawn.payload.description?.length).toBeLessThanOrEqual(200);
    expect(spawn.payload.description).toContain('[REDACTED]');
    expect(JSON.stringify(events)).not.toMatch(/sk-ant|PROMPT-SECRET|never\/read/);
  });

  it('maps missing or invalid fields to null', async () => {
    const dir = await tempWithMeta(JSON.stringify({ spawnDepth: 0, agentType: 5 }));
    const { events } = await drain(makeIngestor(dir).ingestor);
    const [spawn] = spawned(events);
    expect(spawn?.payload).toEqual({
      parentProviderSessionId: SID_1,
      agentId: 'afake9',
      agentType: null,
      description: null,
      spawnToolUseId: null,
      spawnDepth: null,
      model: null,
    });
  });

  for (const [label, text] of [
    ['invalid JSON', '{"agentType": '],
    ['a JSON array', '[1,2]'],
    ['a JSON scalar', '"x"'],
    ['an empty file', ''],
  ] as const) {
    it(`reports ${label} as invalid-meta and emits nothing for it`, async () => {
      const dir = await tempWithMeta(text);
      const { ingestor, diagnostics } = makeIngestor(dir);
      const { events } = await drain(ingestor);
      expect(spawned(events)).toEqual([]);
      const issues = diagnostics.snapshot().fileIssues;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ reason: 'invalid-meta' });
      expect(issues[0]?.path).toBe(`projects/${metaPath('afake9')}`);
    });
  }

  it('recovers when an invalid meta file later becomes valid', async () => {
    const dir = await tempWithMeta('{"agentType":');
    const { ingestor, diagnostics } = makeIngestor(dir);
    const store = new MemoryStore();
    expect(spawned((await drain(ingestor, store)).events)).toEqual([]);
    await put(dir, `projects/${metaPath('afake9')}`, JSON.stringify({ agentType: 'Explore' }));
    expect(spawned((await drain(ingestor, store)).events)).toHaveLength(1);
    expect(diagnostics.snapshot().fileIssues).toEqual([]);
  });

  it('treats a rewritten meta file as a new fact with a new key', async () => {
    const dir = await tempWithMeta(JSON.stringify({ agentType: 'Explore' }));
    const { ingestor } = makeIngestor(dir);
    const store = new MemoryStore();
    const first = spawned((await drain(ingestor, store)).events);
    await put(dir, `projects/${metaPath('afake9')}`, JSON.stringify({ agentType: 'Plan' }));
    const second = spawned((await drain(ingestor, store)).events);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.dedupKey).not.toBe(first[0]?.dedupKey);
  });

  it('is not read when its session is outside every registered root', async () => {
    const dir = await tempWithMeta(JSON.stringify({ agentType: 'Explore' }));
    const { events } = await drain(makeIngestor(dir).ingestor, new MemoryStore(), [
      { projectId: 'p', rootPath: '/somewhere/else' },
    ]);
    expect(events).toEqual([]);
  });
});
