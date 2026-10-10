import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { deriveSubagentEdge, NormalizedEventSchema } from '@acp/core';
import type {
  AdapterDiagnostics,
  NormalizedEvent,
  SubagentMetaEvidence,
  ToolCallSighting,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter, hookSettingsSnippet, HookPayloadError } from '../src/index.js';
import {
  copyScenario,
  drain,
  FIXED_NOW,
  MemoryStore,
  ROOTS,
  scenarioRoot,
} from './helpers/scenarios.js';

const S1 = 'c0ffee00-0000-4000-8000-000000000001';

const ALL_SCENARIOS = [
  '01-streaming-duplicates',
  '02-fork',
  '03-subagent-with-meta',
  '04-subagent-without-meta',
  '05-nested-subagent',
  '06-partial-last-line',
  '08-unknown-record-types',
  '09-cost-state',
  '10-cwd-change',
  '11-api-error-and-edge-lines',
  '12-missing-usage-categories',
  '14-denied-files',
  '15-unparseable-line',
  '16-titles',
];

async function adapterFor(
  scenario: string,
  extra: { chunkBytes?: number; maxFileBytes?: number } = {},
) {
  const claudeDir = await scenarioRoot(scenario);
  return { claudeDir, adapter: createClaudeCodeAdapter({ claudeDir, now: FIXED_NOW, ...extra }) };
}

describe('createClaudeCodeAdapter', () => {
  it('identifies as claude-code and implements the observation contract', async () => {
    const { adapter } = await adapterFor('01-streaming-duplicates');
    expect(adapter.provider).toBe('claude-code');
    for (const fn of [
      'capabilities',
      'discoverCandidates',
      'poll',
      'normalizeHook',
      'diagnostics',
    ]) {
      expect(typeof (adapter as unknown as Record<string, unknown>)[fn]).toBe('function');
    }
  });

  it('rejects invalid options', () => {
    expect(() => createClaudeCodeAdapter({ claudeDir: 'relative/.claude' })).toThrow(RangeError);
    expect(() => createClaudeCodeAdapter({ claudeDir: '/x', chunkBytes: 0 })).toThrow(RangeError);
    expect(() => createClaudeCodeAdapter({ claudeDir: '/x', maxFileBytes: 1.5 })).toThrow(
      RangeError,
    );
  });

  it('emits only schema-valid events for every scenario', async () => {
    for (const scenario of ALL_SCENARIOS) {
      const { adapter } = await adapterFor(scenario);
      const { events } = await drain(adapter);
      expect(events.length, scenario).toBeGreaterThan(0);
      for (const e of events) {
        expect(NormalizedEventSchema.safeParse(e).success, scenario).toBe(true);
        expect(e.provider).toBe('claude-code');
        expect(e.observedAt).toBe('2026-10-10T12:00:00.000Z');
      }
    }
  });

  it('uses the system clock when none is injected', async () => {
    const claudeDir = await scenarioRoot('01-streaming-duplicates');
    const before = Date.now();
    const { events } = await drain(createClaudeCodeAdapter({ claudeDir }));
    const observed = Date.parse(events[0]?.observedAt ?? '');
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(Date.now());
  });

  it('produces the same events regardless of chunk size, across a fresh adapter', async () => {
    const a = await adapterFor('03-subagent-with-meta');
    const b = await adapterFor('03-subagent-with-meta', { chunkBytes: 128 });
    const keys = async (x: typeof a) =>
      (await drain(x.adapter)).events.map((e) => e.dedupKey).sort();
    expect(await keys(b)).toEqual(await keys(a));
  });

  it('never writes to the Claude data directory', async () => {
    const dir = await copyScenario('03-subagent-with-meta');
    const snapshot = async () => {
      const out: string[] = [];
      const walk = async (d: string): Promise<void> => {
        for (const entry of await readdir(d, { withFileTypes: true })) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) await walk(p);
          const st = await stat(p);
          out.push(`${p}:${st.size}:${st.mtimeMs}`);
        }
      };
      await walk(dir);
      return out.sort();
    };
    const before = await snapshot();
    const adapter = createClaudeCodeAdapter({ claudeDir: dir, now: FIXED_NOW });
    await drain(adapter);
    await adapter.discoverCandidates([]);
    expect(await snapshot()).toEqual(before);
  });
});

describe('capabilities (C7)', () => {
  it('is honest: no managed execution, documented limitations, versions only once seen', async () => {
    const { adapter } = await adapterFor('01-streaming-duplicates');
    const before = await adapter.capabilities();
    expect(before.provider).toBe('claude-code');
    expect(before.managedExecution).toBe(false);
    expect(before.providerVersionsSeen).toEqual([]);
    expect(before.observation).toEqual({
      transcripts: true,
      lifecycleHooks: true,
      subagentRelationships: true,
      perTurnUsage: true,
      cumulativeSnapshots: true,
    });
    const text = before.limitations.join('\n');
    for (const topic of [
      /internal to Claude Code/,
      /Hooks are opt-in/,
      /real payloads have not been captured/,
      /scope of cumulative/,
      /estimate/,
      /Auxiliary/,
      /deeper than one level/,
      /retention/,
      /size cap/,
    ]) {
      expect(text).toMatch(topic);
    }

    await drain(adapter);
    expect((await adapter.capabilities()).providerVersionsSeen).toEqual(['2.1.263']);
  });
});

describe('diagnostics', () => {
  it('counts records by runtime version and parse errors', async () => {
    const { adapter } = await adapterFor('15-unparseable-line');
    await drain(adapter);
    const d = adapter.diagnostics();
    expect(d.parseErrors).toBe(3);
    expect(d.recordsByVersion['2.1.263']?.total).toBeGreaterThan(0);
    expect(d.fileIssues).toEqual([]);
  });

  it('reports unrecognized records per version', async () => {
    const { adapter } = await adapterFor('08-unknown-record-types');
    await drain(adapter);
    const counts = adapter.diagnostics().recordsByVersion;
    expect(Object.values(counts).reduce((n, c) => n + c.unrecognized, 0)).toBeGreaterThan(0);
  });

  it('satisfies the core AdapterDiagnostics shape with ignored record counts', async () => {
    const { adapter } = await adapterFor('08-unknown-record-types');
    expect(adapter.diagnostics().ignoredRecords).toEqual({});
    const { store } = await drain(adapter);
    const core: AdapterDiagnostics = adapter.diagnostics();
    expect(core.parseErrors).toBe(0);
    expect(core.fileIssues).toEqual([]);
    expect(core.ignoredRecords.attachment).toBe(1);
    expect(Object.keys(core.ignoredRecords)).toHaveLength(8);
    // A second poll from the committed checkpoints reads nothing new; the counts do not grow.
    await drain(adapter, store);
    expect(adapter.diagnostics().ignoredRecords).toEqual(core.ignoredRecords);
  });

  it('skips files over the size cap and reports them without content or absolute paths', async () => {
    const { adapter } = await adapterFor('01-streaming-duplicates', { maxFileBytes: 100 });
    const { events } = await drain(adapter);
    expect(events).toEqual([]);
    const issues = adapter.diagnostics().fileIssues;
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe('size-cap');
    expect(issues[0]?.path.startsWith('projects/')).toBe(true);
  });
});

describe('discoverCandidates', () => {
  it('lists the first cwd of eligible-looking transcripts outside registered roots', async () => {
    const { adapter } = await adapterFor('14-denied-files');
    const candidates = await adapter.discoverCandidates([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      provider: 'claude-code',
      cwd: '/home/user/project',
      sessionCount: 1,
    });
    expect(await adapter.discoverCandidates(ROOTS)).toEqual([]);
  });
});

describe('normalizeHook via the adapter', () => {
  it('normalizes a delivery and rejects a bad one', async () => {
    const { adapter } = await adapterFor('13-hooks');
    const events = adapter.normalizeHook(
      { session_id: S1, hook_event_name: 'Stop', cwd: '/home/user/project' },
      '2026-10-10T12:00:00.000Z',
    );
    expect(events.map((e) => e.eventType)).toEqual(['session.turn_ended']);
    expect(() => adapter.normalizeHook({}, '2026-10-10T12:00:00.000Z')).toThrow(HookPayloadError);
  });

  it('exposes the settings snippet helper from the package entry point', () => {
    expect(
      JSON.parse(hookSettingsSnippet({ port: 7420, tokenEnvVar: 'ACP_HOOK_TOKEN' })),
    ).toHaveProperty('hooks.Stop');
  });
});

describe('consumer check: core derives subagent edges from the emitted events', () => {
  async function edgeFor(scenario: string, agentId: string) {
    const { adapter } = await adapterFor(scenario);
    const { events } = await drain(adapter, new MemoryStore());
    const spawn = events.find(
      (e): e is Extract<NormalizedEvent, { eventType: 'subagent.spawned' }> =>
        e.eventType === 'subagent.spawned' && e.providerAgentId === agentId,
    );
    const meta: SubagentMetaEvidence | null =
      spawn === undefined
        ? null
        : {
            provider: 'claude-code',
            providerSessionId: spawn.payload.parentProviderSessionId,
            agentId,
            spawnToolUseId: spawn.payload.spawnToolUseId,
            spawnDepth: spawn.payload.spawnDepth,
          };
    const calls: ToolCallSighting[] = events.flatMap((e) =>
      e.eventType === 'tool.called' && e.providerSessionId !== null
        ? [
            {
              session: {
                provider: 'claude-code' as const,
                providerSessionId: e.providerSessionId,
                providerAgentId: e.providerAgentId,
              },
              toolUseId: e.payload.toolUseId,
              toolName: e.payload.toolName,
            },
          ]
        : [],
    );
    return deriveSubagentEdge(meta, calls);
  }

  it('scenario 3: parent is the root session, with spawn-tool-use evidence', async () => {
    const edge = await edgeFor('03-subagent-with-meta', 'afake0301');
    expect(edge?.parent).toEqual({
      provider: 'claude-code',
      providerSessionId: S1,
      providerAgentId: null,
    });
    expect(edge?.evidence).toEqual(['subagent-metadata', 'spawn-tool-use']);
  });

  it('scenario 4: no meta, no edge (parent unknown)', async () => {
    expect(await edgeFor('04-subagent-without-meta', 'afake0401')).toBeNull();
  });

  it('scenario 5: depth 2 resolves to the subagent that holds the spawning call', async () => {
    const edge = await edgeFor('05-nested-subagent', 'afake0502');
    expect(edge?.parent).toEqual({
      provider: 'claude-code',
      providerSessionId: S1,
      providerAgentId: 'afake0501',
    });
  });
});
