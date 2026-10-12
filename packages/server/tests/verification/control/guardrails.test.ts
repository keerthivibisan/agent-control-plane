import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createManagedClaudeCode, type ManagedQueryFn } from '@acp/adapter-claude-code';
import { RunDetailDtoSchema } from '@acp/core/api';
import { leadToolCall } from '@acp/orchestrator';
import { createRunStore } from '../../../src/control/store.js';
import { silentLogger } from '../../../src/logger.js';
import { setupControl } from '../../control/helpers.js';
import { boot, makeRepo, makeTempDir, registerProject, waitFor, waitForRun } from './harness.js';

/*
 * P3-F: the ADR-0013 guardrail refusals P3-D's tests did not already cover. The full map (each
 * guardrail → its passing refusal test) is the "Phase 3 M1 acceptance" checklist in
 * docs/implementation-plan.md. Covered elsewhere, not repeated here: missing/invalid CSRF, a run
 * for an unregistered project, a 4th worker, the worker budget soft cap, a pending non-read-only
 * tool use, a merge into a dirty base (tests/control/guardrails.test.ts).
 */

describe('P3-F lead tool refusals on a persisted run (engine via the run service)', () => {
  it('refuses start_agent when the lead itself is over budget', async () => {
    const s = await setupControl();
    const created = await s.post('/api/runs', {
      projectId: s.project.id,
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: null },
    });
    const runId = (created.body as { id: string }).id;
    await s.post(`/api/runs/${runId}/chat`, { text: 'go' });
    await s.control.idle();
    const lead = s.fake.lead();
    lead.started();
    lead.usage('m1', { input: 900, output: 300, cacheCreation: 0, cacheRead: 0 });
    await s.control.idle();
    expect((await s.detail(runId)).agents[0]?.status).toBe('BLOCKED');
    await expect(lead.callLead('start_agent', { role: 'W', task: 'T' })).rejects.toThrow(
      /reached its budget/,
    );
    await s.control.idle();
    expect(s.fake.workers()).toEqual([]);
  });

  it('refuses start_agent while the run is being stopped', async () => {
    const s = await setupControl({ overrides: { cancelGraceMs: 50 } });
    const runId = (await s.startRun()).id;
    const lead = s.fake.lead();
    lead.started();
    await s.control.idle();
    // The lead ignores abort, so the run stays CANCELLING while it still calls tools.
    lead.handle.abort = () => {};
    await s.post(`/api/runs/${runId}/stop`);
    expect((await s.detail(runId)).status).toBe('CANCELLING');
    await expect(lead.callLead('start_agent', { role: 'W', task: 'T' })).rejects.toThrow(
      /being stopped/,
    );
    expect(s.fake.workers()).toEqual([]);
  });

  it('refuses depth 2 and a project outside the registered ones, on the stored run state', async () => {
    const s = await setupControl();
    const runId = (await s.startRun()).id;
    s.fake.lead().started();
    const worker = await s.startWorker();
    worker.started();
    await s.control.idle();
    const state = createRunStore({ db: s.db, now: () => s.clock.now }).load(runId);
    if (state === undefined) throw new Error('run not stored');
    const ctx = { now: s.clock.now, newId: () => 'never-used' };
    const leadId = s.fake.lead().id;

    // Depth: a worker never gets the lead tools; if one called start_agent anyway it is refused.
    const depth = leadToolCall(
      state,
      {
        callerAgentRunId: worker.id,
        name: 'start_agent',
        input: { role: 'Grandchild', task: 'Nested' },
        registeredProjectIds: [s.project.id],
      },
      ctx,
    );
    expect(depth).toMatchObject({ ok: false, refusal: { code: 'depth-exceeded' } });

    // The run's project is no longer among the registered ones.
    const unregistered = leadToolCall(
      state,
      {
        callerAgentRunId: leadId,
        name: 'start_agent',
        input: { role: 'W', task: 'T' },
        registeredProjectIds: ['some-other-project'],
      },
      ctx,
    );
    expect(unregistered).toMatchObject({ ok: false, refusal: { code: 'project-not-registered' } });
  });
});

describe('P3-F tool permissions through the real managed adapter (scripted SDK query)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('read-only tools inside the worktree run; a lead tool from a worker is denied; edits, commands and outside reads wait for the owner', async () => {
    const dataDir = makeTempDir('acp-p3f-data-');
    const claudeDir = makeTempDir('acp-p3f-claude-');
    const repo = makeRepo();
    dirs.push(dataDir, claudeDir, repo);

    const answers = new Map<string, string>();
    type Options = Parameters<ManagedQueryFn>[0]['options'];
    const ask = async (options: Options, tool: string, input: Record<string, unknown>) => {
      const decision = await options.canUseTool?.(tool, input, {
        signal: new AbortController().signal,
        toolUseID: `tu-${tool}`,
        requestId: `req-${tool}`,
      });
      answers.set(tool, decision?.behavior ?? 'none');
    };
    let leadTools: ((name: 'start_agent', input: unknown) => Promise<string>) | undefined;
    const query: ManagedQueryFn = ({ prompt, options }) => {
      const input = prompt[Symbol.asyncIterator]();
      const kind = options.mcpServers?.['acp'] === undefined ? 'worker' : 'lead';
      const cwd = options.cwd ?? '';
      async function* script() {
        yield { type: 'system', subtype: 'init', session_id: `s-${kind}`, model: 'm' };
        if (kind === 'worker') {
          await ask(options, 'Read', { file_path: join(cwd, 'README.md') });
          await ask(options, 'mcp__acp__start_agent', { role: 'Nested', task: 'x' });
          // These three park until the owner answers; they are not awaited.
          void ask(options, 'Write', { file_path: join(cwd, 'new.txt'), content: 'x' });
          void ask(options, 'Bash', { command: 'git push' });
          void ask(options, 'Glob', { pattern: '*', path: '/etc' });
        }
        while (!(await input.next()).done) {
          // Idle until the input closes.
        }
      }
      return { [Symbol.asyncIterator]: script, interrupt: () => Promise.resolve(undefined) };
    };
    const real = createManagedClaudeCode({ query, env: {} });
    const b = await boot({
      mode: 'live',
      dataDir,
      claudeDir,
      logger: silentLogger,
      adapter: {
        provider: 'claude-code',
        start(spec, callbacks) {
          if (spec.kind === 'lead') leadTools = spec.leadTools;
          return real.start(spec, callbacks);
        },
      },
    });
    try {
      const project = await registerProject(b, 'app', repo);
      const runId = RunDetailDtoSchema.parse(
        (await b.post('/api/runs', { projectId: project.id })).body,
      ).id;
      await b.post(`/api/runs/${runId}/chat`, { text: 'go' });
      await waitForRun(b, runId, (r) => r.status === 'RUNNING', 'the lead running');
      const call = await waitFor(() => leadTools, 'lead tools');
      await call('start_agent', { role: 'Builder', task: 'Build' });
      const run = await waitForRun(
        b,
        runId,
        (r) => r.approvals.filter((a) => a.status === 'pending').length === 3,
        'three pending approvals',
      );
      expect(answers.get('Read')).toBe('allow');
      expect(answers.get('mcp__acp__start_agent')).toBe('deny');
      expect(run.approvals.map((a) => a.toolName).sort()).toEqual(['Bash', 'Glob', 'Write']);
      // Nothing was allowed by default: the parked requests have no answer yet.
      for (const tool of ['Write', 'Bash', 'Glob']) expect(answers.has(tool)).toBe(false);
      expect(run.agents.find((a) => a.kind === 'worker')?.status).toBe('WAITING_APPROVAL');
    } finally {
      await b.server.close();
    }
    // Shutting down answers every parked request with a deny, never an allow.
    for (const tool of ['Write', 'Bash', 'Glob']) expect(answers.get(tool)).toBe('deny');
  });
});
