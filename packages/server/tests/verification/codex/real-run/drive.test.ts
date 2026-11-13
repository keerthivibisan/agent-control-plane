import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deriveRoles,
  validateWorkflowGraph,
  validateWorkflowGraphV3,
  type ManagedAgentSpec,
} from '@acp/core';
import type { AgentMessageMetaDto } from '@acp/core/api';
import { createFakeManagedAdapter } from '../../../control/fake-adapter.js';
import {
  ARROWS_NODES,
  CHANGE_REVIEWER,
  CODEX_MODEL,
  LEAD,
  POOL,
  SCENARIO_IDS,
  arrowsChecks,
  arrowsGraph,
  codexChecks,
  observeManaged,
  outboxCounts,
  parseScenario,
  recordOf,
  scenarioGraph,
  summarizeUsage,
  tokensByProvider,
  type StartRecord,
  type TimelineEntry,
} from './record.js';

/*
 * The CX real-run driver's pure parts, with FAKE adapters only (nothing is spawned but the driver's
 * own refusal): the scenario graphs, the recording wrapper and the aggregates. A real run is never
 * started from here; ACP_REAL_RUN is never set.
 */

const DRIVE = fileURLToPath(new URL('./drive.ts', import.meta.url));
const SERVER_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function spec(over: Partial<ManagedAgentSpec> = {}): ManagedAgentSpec {
  return { agentRunId: 'a1', kind: 'worker', cwd: '/w', prompt: 'p', model: null, ...over };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the CX real-run driver (fake adapters only)', () => {
  it('parses only the two scenarios', () => {
    expect(SCENARIO_IDS).toEqual(['reviewer', 'lead']);
    expect(parseScenario('reviewer')).toBe('reviewer');
    expect(parseScenario('lead')).toBe('lead');
    expect(parseScenario(undefined)).toBeNull();
    expect(parseScenario('a')).toBeNull();
    expect(parseScenario('arrows')).toBe('arrows');
  });

  it('scenario arrows: a valid version 3 graph with researchers, a planner and a fan-out', () => {
    const graph = arrowsGraph('haiku');
    expect(validateWorkflowGraphV3(graph, { projectMode: 'auto-edits' })).toEqual([]);
    const roles = deriveRoles(graph);
    const role = (id: string) => {
      const r = roles.get(id);
      return r?.ok === true ? r.role : null;
    };
    const n = ARROWS_NODES;
    expect(role(n.researcherClaude)).toEqual({ role: 'researcher' });
    expect(role(n.researcherCodex)).toEqual({ role: 'researcher' });
    expect(role(n.planner)).toEqual({ role: 'planner' });
    expect(role(n.reviewerClaude)).toEqual({ role: 'reviewer', scope: 'change' });
    expect(role(n.reviewerCodex)).toEqual({ role: 'reviewer', scope: 'change' });
    const research = graph.edges.filter((e) => e.type === 'research');
    expect(research.map((e) => [e.from, e.to, e.label])).toEqual([
      [n.researcherClaude, n.planner, 'Repo layout'],
      [n.researcherCodex, n.planner, 'Repo layout'],
    ]);
    for (const node of graph.nodes) {
      if (node.type !== 'agent' && node.type !== 'lead') continue;
      const codex = node.id === n.researcherCodex || node.id === n.reviewerCodex;
      expect([node.provider, node.model, node.effort]).toEqual(
        codex ? ['codex', CODEX_MODEL, 'low'] : ['claude-code', 'haiku', 'low'],
      );
    }
  });

  it('arrowsChecks: start order, research notes and a decided two-provider fan-out', () => {
    const t = (
      event: 'start' | 'finish',
      start: number,
      provider: 'claude-code' | 'codex',
      kind: TimelineEntry['kind'],
    ): TimelineEntry => ({ event, start, provider, kind });
    const timeline = [
      t('start', 0, 'claude-code', 'researcher'),
      t('start', 1, 'codex', 'researcher'),
      t('finish', 0, 'claude-code', 'researcher'),
      t('finish', 1, 'codex', 'researcher'),
      t('start', 2, 'claude-code', 'planner'),
    ];
    const review = (provider: string, decision: string | null) => ({
      change: 'h1',
      round: 0,
      reviewer: 'agent',
      reviewerProvider: provider,
      verdict: 'approve',
      decision,
    });
    const ok = arrowsChecks(
      timeline,
      [review('claude-code', 'merge'), review('codex', 'merge')],
      [120, 80],
    );
    expect(ok).toMatchObject({
      startOrder: ['claude-code:researcher', 'codex:researcher', 'claude-code:planner'],
      researchersBothProviders: true,
      researchersBeforePlanner: true,
      researchersFinishedBeforePlanner: true,
      researchComments: 2,
      fanOutRounds: 1,
      fanOutDecided: true,
    });
    const late = arrowsChecks(
      [timeline[0]!, timeline[4]!, timeline[1]!],
      [review('codex', null)],
      [],
    );
    expect(late).toMatchObject({
      researchersBothProviders: true,
      researchersBeforePlanner: false,
      fanOutRounds: 0,
      fanOutDecided: false,
    });
  });

  it('tokensByProvider sums the deduplicated usage rows, a null as nothing', () => {
    expect(
      tokensByProvider([
        {
          provider: 'codex',
          input_tokens: 5,
          output_tokens: null,
          cache_creation_tokens: 0,
          cache_read_tokens: 2,
        },
        {
          provider: 'codex',
          input_tokens: 1,
          output_tokens: 3,
          cache_creation_tokens: null,
          cache_read_tokens: null,
        },
      ]),
    ).toEqual({ codex: { input: 6, output: 3, cacheCreation: 0, cacheRead: 2 } });
  });

  for (const id of SCENARIO_IDS) {
    it(`scenario ${id}: one node on Codex at low effort, a valid graph`, () => {
      const graph = scenarioGraph(id, 'haiku');
      const issues = validateWorkflowGraph(graph, { projectMode: 'auto-edits' });
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(issues.map((i) => i.code)).not.toContain('model-provider-mismatch');
      const agents = graph.nodes.filter(
        (n) => n.type === 'lead' || n.type === 'helper-pool' || n.type === 'reviewer',
      );
      const codex = agents.filter((n) => 'provider' in n && n.provider === 'codex');
      expect(codex.map((n) => n.id)).toEqual([id === 'reviewer' ? CHANGE_REVIEWER : LEAD]);
      for (const n of codex) {
        expect([n.model, 'effort' in n ? n.effort : null]).toEqual([CODEX_MODEL, 'low']);
      }
      for (const n of agents.filter((x) => !codex.includes(x))) expect(n.model).toBe('haiku');
      expect(agents.map((n) => n.id).sort()).toEqual([CHANGE_REVIEWER, LEAD, POOL].sort());
    });
  }

  it('records each start, its lead tool names and its events, and forwards availability', async () => {
    const fake = createFakeManagedAdapter({
      provider: 'codex',
      checkAvailable: () => Promise.resolve({ ok: true }),
    });
    const starts: StartRecord[] = [];
    const adapter = observeManaged(fake.adapter, starts);
    expect(adapter.provider).toBe('codex');
    expect(await adapter.checkAvailable?.()).toEqual({ ok: true });

    const seen: string[] = [];
    const handle = adapter.start(
      spec({
        kind: 'lead',
        model: CODEX_MODEL,
        effort: 'low',
        denyRead: ['/secret'],
        leadTools: (name) =>
          name === 'stop_agent' ? Promise.reject(new Error('x')) : Promise.resolve('done'),
      }),
      { requestPermission: () => Promise.resolve({ allow: true }) },
    );
    const reading = (async () => {
      for await (const e of handle.events) seen.push(e.type);
    })();
    const agent = fake.agents[0];
    if (agent === undefined) throw new Error('no fake agent');
    expect(await agent.callLead('submit_plan', {})).toBe('done');
    await expect(agent.callLead('stop_agent', {})).rejects.toThrow();
    agent.started('t1', CODEX_MODEL);
    agent.usage('m1', { input: 1, output: 2, cacheCreation: null, cacheRead: 0 });
    agent.usage('m2', { input: 1, output: 2, cacheCreation: 0, cacheRead: 0 });
    agent.finish('success');
    await reading;
    await settle();

    expect(seen).toEqual(['started', 'usage', 'usage', 'finished']);
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      provider: 'codex',
      kind: 'lead',
      model: CODEX_MODEL,
      effort: 'low',
      denyRead: true,
      fullAuto: false,
      followUp: false,
      rework: false,
      started: true,
      startedModel: CODEX_MODEL,
      usageEvents: 2,
      usageWithNull: 1,
      leadTools: { 'submit_plan:ok': 1, 'stop_agent:error': 1 },
      finished: { outcome: 'success', failure: null },
    });
    // Content-free: neither the prompt nor any path is in the record.
    expect(JSON.stringify(starts)).not.toMatch(/\/secret|"p"/);
  });

  it('an adapter without checkAvailable stays without one', () => {
    const adapter = observeManaged(createFakeManagedAdapter().adapter, []);
    expect('checkAvailable' in adapter).toBe(false);
  });

  it('summarizes usage records per provider with null counts, never a sum', () => {
    const out = summarizeUsage([
      {
        provider: 'codex',
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_tokens: null,
        cache_read_tokens: 0,
      },
      {
        provider: 'codex',
        input_tokens: null,
        output_tokens: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
      },
      {
        provider: 'claude-code',
        input_tokens: 5,
        output_tokens: 6,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      },
    ]);
    expect(out).toEqual({
      codex: {
        records: 2,
        withAnyNull: 2,
        allNull: 1,
        nullByField: { input: 1, output: 1, cacheCreation: 2, cacheRead: 1 },
      },
      'claude-code': {
        records: 1,
        withAnyNull: 0,
        allNull: 0,
        nullByField: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      },
    });
  });

  it('counts outbox entries by kind and latest state', () => {
    const m = (id: string, over: Partial<AgentMessageMetaDto>): AgentMessageMetaDto => ({
      id,
      from: 'lead-1',
      to: 'w-1',
      kind: 'message',
      state: 'queued',
      createdAt: '2026-11-07T00:00:00.000Z',
      deliveredAt: null,
      length: 3,
      sha256: '0'.repeat(64),
      ...over,
    });
    const seen = new Map<string, AgentMessageMetaDto>([
      ['1', m('1', { state: 'delivered' })],
      ['2', m('2', { kind: 'notice', from: 'engine', state: 'held' })],
      ['3', m('3', { kind: 'question', state: 'delivered' })],
    ]);
    expect(outboxCounts(seen)).toEqual({
      entries: 3,
      byKindState: { 'message:delivered': 1, 'notice:held': 1, 'question:delivered': 1 },
      fromEngine: 1,
    });
  });

  it('codexChecks: started, failures, readable and writable, turns and lead tools', () => {
    const rec = (over: Partial<StartRecord>): StartRecord => ({
      ...recordOf('codex', spec()),
      started: true,
      finished: { outcome: 'success', failure: null },
      denyRead: true,
      ...over,
    });
    const claude = { ...recordOf('claude-code', spec()), started: true };

    const reviewer = codexChecks([claude, rec({ kind: 'reviewer' })], {
      reviews: [{ reviewer: 'agent', verdict: 'approve' }],
      filesOnMain: true,
    });
    expect(reviewer).toMatchObject({
      starts: 1,
      allStarted: true,
      failures: {},
      allHadDenyRead: true,
      worktree: { readable: true, writable: null },
      reworkOrFollowUp: { happened: 0, started: 0 },
    });

    const lead = codexChecks(
      [
        rec({ kind: 'lead', leadTools: { 'submit_plan:ok': 1, 'start_agent:ok': 1 } }),
        rec({ kind: 'lead', followUp: true, started: false, finished: null }),
      ],
      { reviews: [], filesOnMain: false },
    );
    expect(lead.allStarted).toBe(false);
    expect(lead.worktree).toEqual({ readable: true, writable: null });
    expect(lead.leadTools).toEqual({ 'submit_plan:ok': 1, 'start_agent:ok': 1 });
    expect(lead.reworkOrFollowUp).toEqual({
      happened: 1,
      started: 0,
      byKind: { 'lead:follow-up': 1 },
    });

    const failed = codexChecks(
      [
        rec({ kind: 'worker', finished: { outcome: 'error', failure: 'unsafe-git-location' } }),
        rec({ kind: 'worker', rework: true }),
      ],
      { reviews: [], filesOnMain: true },
    );
    expect(failed.allStarted).toBe(false);
    expect(failed.failures).toEqual({ 'unsafe-git-location': 1 });
    expect(failed.worktree.writable).toBe(true);
    expect(failed.reworkOrFollowUp.byKind).toEqual({ 'worker:rework': 1 });

    expect(codexChecks([claude], { reviews: [], filesOnMain: true })).toMatchObject({
      starts: 0,
      allStarted: false,
      worktree: { readable: null, writable: null },
    });
  });

  it('the command line refuses without ACP_REAL_RUN=1 and spawns nothing', async () => {
    const r = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          ['--conditions=development', '--import', 'tsx', DRIVE],
          {
            cwd: SERVER_ROOT,
            env: { ...process.env, ACP_REAL_RUN: undefined, ACP_REAL_RUN_SCENARIO: 'reviewer' },
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
