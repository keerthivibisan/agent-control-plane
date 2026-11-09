import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateWorkflowGraph } from '@acp/core';
import { createFakeManagedAdapter } from '../../../control/fake-adapter.js';
import {
  DEFAULT_LIMIT_MS,
  HARNESS_FILES,
  TICKETS,
  UsageRecorder,
  armSummary,
  deltas,
  emptySums,
  indexSummary,
  measureGraph,
  median,
  parseSettings,
  recordUsage,
  schedule,
  sumUsageRecords,
  summarize,
  type AgentRecord,
  type DriveSettings,
  type RunRecord,
  type ToolCounts,
} from './record.js';

/*
 * The CM-5 measurement driver's pure parts, with FAKES only (nothing is spawned but the driver's
 * own refusal): env parsing, the arm schedule, the graph, the usage recorder and the summary math.
 * A real run is never started from here; ACP_REAL_RUN is never set. The ACP_CODE_MAP switch
 * itself is covered through the server in tests/codemap/off-switch.test.ts.
 */

const DRIVE = fileURLToPath(new URL('./drive.ts', import.meta.url));
const SERVER_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const HEAD = 'a'.repeat(40);

function settingsOf(env: Record<string, string>): DriveSettings {
  const r = parseSettings(env, HEAD);
  if (!r.ok) throw new Error(r.error);
  return r.settings;
}

function refusal(env: Record<string, string>): string {
  const r = parseSettings(env, HEAD);
  if (r.ok) throw new Error('accepted');
  return r.error;
}

describe('CM-5 driver settings', () => {
  it('defaults: Claude haiku at low effort, both arms and tickets, one repeat, HEAD', () => {
    expect(settingsOf({})).toEqual({
      provider: 'claude-code',
      model: 'haiku',
      effort: 'low',
      arms: ['on', 'off'],
      repeats: 1,
      tickets: ['A', 'B'],
      limitMs: DEFAULT_LIMIT_MS,
      keep: false,
      commit: HEAD,
    });
    expect(DEFAULT_LIMIT_MS).toBe(15 * 60_000);
  });

  it('Codex defaults to gpt-6-luna; every setting can be chosen', () => {
    expect(settingsOf({ ACP_REAL_RUN_PROVIDER: 'codex' }).model).toBe('gpt-6-luna');
    expect(
      settingsOf({
        ACP_REAL_RUN_PROVIDER: 'codex',
        ACP_REAL_RUN_MODEL: 'gpt-6.1-sol',
        ACP_REAL_RUN_EFFORT: 'medium',
        ACP_REAL_RUN_ARMS: 'off',
        ACP_REAL_RUN_REPEATS: '3',
        ACP_REAL_RUN_TICKETS: 'B,A',
        ACP_REAL_RUN_LIMIT_MS: '60000',
        ACP_REAL_RUN_KEEP: '1',
        ACP_REAL_RUN_COMMIT: '44aba8c',
      }),
    ).toEqual({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      effort: 'medium',
      arms: ['off'],
      repeats: 3,
      tickets: ['B', 'A'],
      limitMs: 60_000,
      keep: true,
      commit: '44aba8c',
    });
  });

  it('refuses effort high (and anything but low or medium)', () => {
    expect(refusal({ ACP_REAL_RUN_EFFORT: 'high' })).toMatch(/ACP_REAL_RUN_EFFORT.*never higher/);
    expect(refusal({ ACP_REAL_RUN_EFFORT: 'max' })).toMatch(/ACP_REAL_RUN_EFFORT/);
  });

  it('refuses bad providers, models, lists, repeats, limits and commits', () => {
    expect(refusal({ ACP_REAL_RUN_PROVIDER: 'gemini' })).toMatch(/ACP_REAL_RUN_PROVIDER/);
    expect(refusal({ ACP_REAL_RUN_MODEL: 'a b' })).toMatch(/ACP_REAL_RUN_MODEL/);
    expect(refusal({ ACP_REAL_RUN_ARMS: 'on,maybe' })).toMatch(/ACP_REAL_RUN_ARMS/);
    expect(refusal({ ACP_REAL_RUN_ARMS: 'on,on' })).toMatch(/repeat/);
    expect(refusal({ ACP_REAL_RUN_TICKETS: 'C' })).toMatch(/ACP_REAL_RUN_TICKETS/);
    for (const v of ['0', '-1', '1.5', '11', 'x']) {
      expect(refusal({ ACP_REAL_RUN_REPEATS: v })).toMatch(/ACP_REAL_RUN_REPEATS/);
    }
    expect(refusal({ ACP_REAL_RUN_LIMIT_MS: '0' })).toMatch(/ACP_REAL_RUN_LIMIT_MS/);
    expect(refusal({ ACP_REAL_RUN_COMMIT: 'HEAD~1' })).toMatch(/ACP_REAL_RUN_COMMIT/);
  });
});

describe('CM-5 schedule', () => {
  it('alternates the arm order per repeat, per ticket', () => {
    const s = schedule({ repeats: 3, tickets: ['A', 'B'], arms: ['on', 'off'] });
    expect(s.map((x) => `${x.repeat}${x.ticket}${x.arm}`)).toEqual([
      '0Aon',
      '0Aoff',
      '0Bon',
      '0Boff',
      '1Aoff',
      '1Aon',
      '1Boff',
      '1Bon',
      '2Aon',
      '2Aoff',
      '2Bon',
      '2Boff',
    ]);
  });

  it('the default is 4 runs; one arm never alternates', () => {
    expect(schedule(settingsOf({}))).toHaveLength(4);
    expect(schedule({ repeats: 2, tickets: ['A'], arms: ['off'] }).map((x) => x.arm)).toEqual([
      'off',
      'off',
    ]);
  });
});

describe('CM-5 graph, tickets and harness', () => {
  it('lead plus helpers on the chosen provider, model and effort; no reviewers; valid', () => {
    for (const [provider, model] of [
      ['claude-code', 'haiku'],
      ['codex', 'gpt-6-luna'],
    ] as const) {
      const graph = measureGraph({ provider, model, effort: 'low' });
      const issues = validateWorkflowGraph(graph, { projectMode: 'auto-edits' });
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(issues.map((i) => i.code)).not.toContain('model-provider-mismatch');
      const agents = graph.nodes.filter(
        (n) => n.type === 'lead' || n.type === 'helper-pool' || n.type === 'reviewer',
      );
      expect(agents.map((n) => n.type).sort()).toEqual(['helper-pool', 'lead']);
      for (const n of agents) {
        expect(n).toMatchObject({ provider, model, effort: 'low' });
      }
    }
  });

  it('the tickets are the fixed texts; the harness check needs no install', () => {
    expect(TICKETS.A.description).toContain('isManagedProvider(id: string): boolean');
    expect(TICKETS.B.description).toContain("'Not reported'");
    expect(TICKETS.B.description).toContain('(ADR-0032)');
    const harness = JSON.parse(HARNESS_FILES['.acp/harness.json'] ?? '{}') as {
      checks: { argv: string[]; required: boolean }[];
    };
    expect(harness.checks).toEqual([
      expect.objectContaining({ argv: ['node', '.acp/cm5-check.mjs'], required: true }),
    ]);
    expect(HARNESS_FILES['.acp/cm5-check.mjs']).toContain("'diff', '--check'");
  });
});

describe('CM-5 usage', () => {
  it('records usage per agent with a fake adapter, deduplicated by message id (max output)', async () => {
    const fake = createFakeManagedAdapter();
    const recorder = new UsageRecorder();
    const adapter = recordUsage(fake.adapter, recorder);
    const handle = adapter.start(
      { agentRunId: 'a1', kind: 'lead', cwd: '/w', prompt: 'p', model: 'haiku' },
      { requestPermission: () => Promise.resolve({ allow: true }) },
    );
    const reading = (async () => {
      for await (const e of handle.events) void e;
    })();
    const agent = fake.agents[0];
    if (agent === undefined) throw new Error('no fake agent');
    agent.started('t1', 'haiku');
    agent.usage('m1', { input: 10, output: 1, cacheCreation: 0, cacheRead: 5 });
    // A later snapshot of the same message: replaces it, never adds.
    agent.usage('m1', { input: 10, output: 4, cacheCreation: 0, cacheRead: 5 });
    agent.usage('m2', { input: 3, output: 2, cacheCreation: null, cacheRead: 0 });
    agent.finish('success');
    await reading;

    const sums = emptySums();
    Object.assign(sums, { input: 13, output: 6, cacheCreation: 0, cacheRead: 5 });
    sums.unavailable.cacheCreation = 1;
    expect(recorder.of('a1')).toEqual({ provider: 'claude-code', responses: 2, tokens: sums });
    expect(recorder.of('other')).toBeNull();
  });

  it('sums one provider’s usage_records with null counts, never a null as 0', () => {
    const out = sumUsageRecords(
      [
        {
          provider: 'codex',
          input_tokens: 5,
          output_tokens: 2,
          cache_creation_tokens: null,
          cache_read_tokens: 1,
        },
        {
          provider: 'codex',
          input_tokens: 1,
          output_tokens: null,
          cache_creation_tokens: null,
          cache_read_tokens: 0,
        },
        {
          provider: 'claude-code',
          input_tokens: 100,
          output_tokens: 100,
          cache_creation_tokens: 100,
          cache_read_tokens: 100,
        },
      ],
      'codex',
    );
    expect(out).toEqual({
      records: 2,
      input: 6,
      output: 2,
      cacheCreation: 0,
      cacheRead: 1,
      unavailable: { input: 0, output: 1, cacheCreation: 2, cacheRead: 0 },
    });
  });
});

describe('CM-5 summary math', () => {
  const tools = (over: Partial<ToolCounts>): ToolCounts => ({
    read: 0,
    search: 0,
    edit: 0,
    shell: 0,
    code_map: 0,
    other: 0,
    ...over,
  });
  const agent = (role: string, t: Partial<ToolCounts>, budgetUsed: number): AgentRecord => ({
    role,
    provider: 'claude-code',
    model: 'haiku',
    status: 'COMPLETED',
    toolCounts: tools(t),
    budgetUsed,
    durationMs: 1,
    responses: 1,
    tokens: null,
  });
  const run = (
    arm: 'on' | 'off',
    o: { leadRead: number; helperRead: number; map: number; budget: number; wall: number },
    over: Partial<RunRecord> = {},
  ): RunRecord => ({
    repeat: 0,
    ticket: 'A',
    arm,
    provider: 'claude-code',
    model: 'haiku',
    effort: 'low',
    wallMs: o.wall,
    outcome: {
      runStatus: 'COMPLETED',
      timedOut: false,
      ticketFileChanged: true,
      changedFilesOnMain: 2,
      checksPassed: true,
      finalMerge: 'merged',
    },
    index:
      arm === 'on'
        ? { buildMs: 100, files: 1000, indexed: 900, symbols: 5000, dbBytes: 4096 }
        : null,
    startingPoints: {
      steps: 1,
      stepsWithFiles: 1,
      files: 2,
      notFoundInMap: arm === 'on' ? 0 : null,
    },
    agents: [
      agent('lead', { read: o.leadRead, search: 1, code_map: o.map }, o.budget / 2),
      agent('worker', { read: o.helperRead, search: 2 }, o.budget / 4),
      agent('worker', { read: 1, search: 1 }, o.budget / 4),
    ],
    tokens: emptySums(),
    codexUsageRecords: null,
    ...over,
  });

  it('median: odd, even, empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('per arm medians, success rate, index cost and the off − on deltas', () => {
    const on = [
      run('on', { leadRead: 2, helperRead: 3, map: 4, budget: 1000, wall: 60_000 }),
      run('on', { leadRead: 4, helperRead: 5, map: 2, budget: 2000, wall: 80_000 }),
    ];
    const off = [
      run('off', { leadRead: 10, helperRead: 9, map: 0, budget: 4000, wall: 120_000 }),
      run('off', { leadRead: 12, helperRead: 7, map: 0, budget: 3000, wall: 100_000 }),
      run(
        'off',
        { leadRead: 99, helperRead: 99, map: 0, budget: 99_999, wall: 1 },
        {
          outcome: {
            ...run('off', { leadRead: 0, helperRead: 0, map: 0, budget: 0, wall: 0 }).outcome,
            finalMerge: 'refused:checks_failed',
          },
        },
      ),
    ];
    const a = armSummary(on);
    expect(a).toEqual({
      runs: 2,
      errors: 0,
      successes: 2,
      successRate: 1,
      medians: {
        leadRead: 3,
        leadSearch: 1,
        // Helpers' reads summed per run (3+1, 5+1), then the median.
        helperRead: 5,
        helperSearch: 3,
        codeMapCalls: 3,
        budgetTokens: 1500,
        wallMs: 70_000,
      },
    });
    const b = armSummary(off);
    expect(b.successes).toBe(2);
    expect(b.successRate).toBeCloseTo(2 / 3);
    expect(b.medians.leadRead).toBe(12);
    expect(deltas(a, b)).toEqual({
      medians: {
        leadRead: 9,
        leadSearch: 0,
        // Off: 10, 8, 100 (median 10); on: 5.
        helperRead: 5,
        helperSearch: 0,
        codeMapCalls: -3,
        budgetTokens: 2500,
        wallMs: 30_000,
      },
      successRate: 2 / 3 - 1,
    });
    expect(indexSummary([...on, ...off])).toEqual({
      builds: 2,
      medianBuildMs: 100,
      medianFiles: 1000,
      medianSymbols: 5000,
      medianDbBytes: 4096,
    });
  });

  it('a run the driver could not carry through counts as a failure but not in the medians', () => {
    const ok = run('on', { leadRead: 2, helperRead: 0, map: 1, budget: 10, wall: 5 });
    const broken = {
      ...run('on', { leadRead: 0, helperRead: 0, map: 0, budget: 0, wall: 0 }),
      error: 'x',
    };
    const s = armSummary([ok, broken]);
    expect([s.runs, s.errors, s.successes, s.successRate]).toEqual([2, 1, 1, 0.5]);
    expect(s.medians.leadRead).toBe(2);
    expect(s.medians.wallMs).toBe(5);
  });

  it('an empty arm gives nulls, and its deltas are null', () => {
    const none = armSummary([]);
    expect(none.successRate).toBeNull();
    expect(none.medians.leadRead).toBeNull();
    const one = armSummary([run('on', { leadRead: 1, helperRead: 1, map: 1, budget: 1, wall: 1 })]);
    expect(deltas(one, none).medians.leadRead).toBeNull();
    expect(deltas(one, none).successRate).toBeNull();
  });

  it('the summary says the sample is small and carries every run, content-free', () => {
    const runs = [
      run('on', { leadRead: 1, helperRead: 1, map: 1, budget: 1, wall: 1 }),
      run('off', { leadRead: 2, helperRead: 2, map: 0, budget: 2, wall: 2 }),
    ];
    const out = summarize(runs, settingsOf({}));
    expect(out.note).toMatch(/not statistically significant/);
    expect(out.runs).toHaveLength(2);
    expect(Object.keys(out.byTicket)).toEqual(['A', 'B']);
    expect(out.deltaOffMinusOn.medians.leadRead).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(/isManagedProvider|Not reported/);
  });
});

describe('CM-5 command line', () => {
  it('refuses without ACP_REAL_RUN=1 and spawns nothing', async () => {
    const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          ['--conditions=development', '--import', 'tsx', DRIVE],
          {
            cwd: SERVER_ROOT,
            env: { ...process.env, ACP_REAL_RUN: undefined },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      },
    );
    expect([r.code, r.stdout]).toEqual([2, '']);
    expect(r.stderr).toContain('ACP_REAL_RUN=1');
  }, 60_000);
});
