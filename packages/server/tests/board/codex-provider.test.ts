// Synthetic temp git repo and scripted fake adapters only (CX-4). Never the Agent SDK or Codex.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowTemplate, type WorkflowGraph, type WorkflowNode } from '@acp/core';
import {
  RunDetailDtoSchema,
  RunWorkflowGraphDtoSchema,
  TicketDetailDtoSchema,
  WorkflowGraphDtoSchema,
  type ProjectAgentSetupDto,
} from '@acp/core/api';
import {
  createOrchestrationRepositories,
  createRedesignRepositories,
  createRepositories,
} from '@acp/db';
import { FULL_AUTO_FAILURE_ACTIVITY } from '@acp/orchestrator';
import { AVAILABILITY_RECHECK_MS } from '../../src/control/service.js';
import { createTokensService } from '../../src/tokens/service.js';
import { setupBoard } from './helpers.js';
import { FILES, run, type Board } from './loop-helpers.js';
import { mapNodes, poolMode, putGraph, withHelper } from './graph-helpers.js';
import { setupControl } from '../control/helpers.js';
import { createFakeManagedAdapter } from '../control/fake-adapter.js';

/*
 * ADR-0031 server wiring (CX-4): each agent starts on its own provider's adapter (a Claude lead
 * with a Codex helper in one run), never on another; a provider without an adapter, or one that is
 * not available, ends the agent with `provider-unavailable` and says why on the ticket; Codex's
 * missing capabilities refuse or strip as ADR-0031 §5 says; and Codex usage is recorded through
 * the ingestion pipeline (ADR-0032 §5). Synthetic data and fake adapters only.
 */

const NARROW_AGENT = [
  '---',
  'name: narrow',
  'description: Synthetic test agent.',
  'tools: Read',
  '---',
  'Read only.',
  '',
].join('\n');
const SKILL = ['---', 'name: lint', 'description: Lint first.', '---', 'Run lint.', ''].join('\n');

/** The lead-only template with a named `frontend` helper changed by `f`. */
function frontendGraph(f: (n: WorkflowNode) => WorkflowNode = (n) => n): WorkflowGraph {
  const graph = withHelper(poolMode(workflowTemplate('lead-only'), null), {
    id: 'frontend',
    label: 'Frontend helper',
    mode: 'auto',
  });
  return mapNodes(graph, (n) => (n.id === 'frontend' ? f(n) : n));
}

const onCodex = (n: WorkflowNode): WorkflowNode => ({ ...n, provider: 'codex' }) as WorkflowNode;

async function setProvider(s: Board, provider: 'codex' | null) {
  const current = (await s.get(`/api/projects/${s.project.id}/setup`)).body as ProjectAgentSetupDto;
  const res = await s.send('put', `/api/projects/${s.project.id}/setup`, {
    projectKey: current.projectKey,
    maxConcurrentHelpers: current.maxConcurrentHelpers,
    maxDepth: current.maxDepth,
    defaultBudgetTokensPerAgent: current.defaultBudgetTokensPerAgent,
    model: null,
    contextFiles: [],
    provider,
  });
  expect(res.status).toBe(200);
}

/** Ready and Start; the run id. The lead is not driven. */
async function start(s: Board, title = 'Add dark mode', body: object = {}) {
  const ticket = await s.createTicket(title);
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const res = await s.post(`/api/tickets/${ticket.id}/start`, body);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  await s.settle();
  return { ticket, runId: TicketDetailDtoSchema.parse(res.body).currentRun?.id ?? '' };
}

/** A Claude lead with an approved plan. */
async function planned(s: Board, body: object = {}) {
  const x = await start(s, 'Add dark mode', body);
  const lead = s.fake.agents.filter((a) => a.spec.kind === 'lead').at(-1);
  if (lead === undefined) throw new Error('no lead');
  lead.started();
  await s.settle();
  await lead.callLead('submit_plan', {
    summary: 'Add a theme toggle',
    steps: [{ title: 'Build the page', role: 'Page', detail: 'In settings' }],
  });
  await s.settle();
  const plan = (await s.detail(x.ticket.id)).plans.at(-1);
  if (plan?.status === 'proposed') {
    await s.post(`/api/tickets/${x.ticket.id}/plans/${plan.id}/decision`, { decision: 'approve' });
    await s.settle();
  }
  return { ...x, lead };
}

function codexOf(s: Board) {
  if (s.codex === undefined) throw new Error('no codex fake');
  return s.codex;
}

const systemLines = (s: Board, ticketId: string) =>
  s.workspace.comments
    .listForTicket(ticketId)
    .filter((c) => c.author === 'app' && c.kind === 'system')
    .map((c) => c.body);

describe('mixed providers in one run (ADR-0031 §2)', () => {
  it('starts the Claude lead and the Codex helper on their own adapters, links each session under its provider, and records Codex usage', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    await putGraph(s, frontendGraph(onCodex));
    const x = await planned(s);
    expect(codexOf(s).agents).toEqual([]);
    const reply = await x.lead.callLead('start_agent', {
      role: 'Page',
      task: 'Build it',
      helper: 'frontend',
    });
    expect(reply).toContain('Started agent');
    await s.settle();
    const worker = codexOf(s).agents.at(-1);
    if (worker === undefined) throw new Error('no codex worker');
    expect(s.fake.workers()).toEqual([]);
    expect(worker.spec.kind).toBe('worker');
    // CX-3: the gate's mode reaches the spec, equal to the node's mode on the run.
    const nodes = RunWorkflowGraphDtoSchema.parse(
      (await s.get(`/api/runs/${x.runId}/workflow-graph`)).body,
    ).nodes;
    expect(worker.spec.approvalMode).toBe('auto');
    expect(nodes.find((n) => n.nodeId === 'frontend')?.approvalMode).toBe('auto');
    expect(x.lead.spec.approvalMode).toBeUndefined();

    worker.started('thread-1', 'gpt-test');
    const full = { input: 120, output: 30, cacheCreation: null, cacheRead: 100 };
    worker.usage('thread-1:turn-1:250', full);
    worker.usage('thread-1:turn-1:300', {
      input: 10,
      output: null,
      cacheCreation: null,
      cacheRead: 0,
    });
    // CX-1: Codex repeats the last notification after a resume; a replay is a no-op.
    worker.usage('thread-1:turn-1:300', {
      input: 10,
      output: null,
      cacheCreation: null,
      cacheRead: 0,
    });
    await s.settle();

    const repos = createOrchestrationRepositories(s.db);
    const links = (id: string) =>
      repos.agentRunSessions.listForAgentRun(id).map((l) => [l.provider, l.providerSessionId]);
    expect(links(x.lead.id)).toEqual([['claude-code', `sess-${x.lead.id}`]]);
    expect(links(worker.id)).toEqual([['codex', 'thread-1']]);
    const runDetail = await run(s, x.runId);
    expect(runDetail.agents.find((a) => a.id === worker.id)?.provider).toBe('codex');

    const db = createRepositories(s.db);
    const session = db.sessions.getByKey({
      provider: 'codex',
      providerSessionId: 'thread-1',
      providerAgentId: null,
    });
    // The test pipeline has no worktree roots (the server's has), so the session is the
    // project's through its owning agent run, which the Tokens page counts below.
    expect(session).toMatchObject({ origin: 'managed', launchCwd: s.worktree(x.runId, worker.id) });
    const first = db.usage.getRecord('codex', 'thread-1:turn-1:250');
    expect(first).toMatchObject({
      provider: 'codex',
      model: 'gpt-test',
      tokens: full,
      observationCount: 1,
      source: 'managed',
      provenance: 'observed',
    });
    const second = db.usage.getRecord('codex', 'thread-1:turn-1:300');
    // Null stays null (unavailable), never 0; the replay added no observation.
    expect(second?.tokens).toEqual({ input: 10, output: null, cacheCreation: null, cacheRead: 0 });
    expect(second?.observationCount).toBe(1);
    expect(db.usage.listRecordsForSession(session?.id ?? '')).toHaveLength(2);

    // The Tokens page sees it, under the helper's role and the ticket.
    const tokens = createTokensService({ db: s.db }).project(s.project.id, {});
    expect(tokens.byModel.map((m) => m.model)).toContain('gpt-test');
    const workerRow = tokens.byRole.find((r) => r.role === 'worker');
    expect(workerRow?.usage.tokens.input).toBe(130);
    expect(workerRow?.usage.tokens.output).toBe(30);
    expect(tokens.byTicket.find((t) => t.ticketId === x.ticket.id)).toBeDefined();
    expect(tokens.bySession.find((r) => r.sessionId === session?.id)).toBeDefined();
  });

  it('gives a Claude helper the gate mode too, tightened by the ticket', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    await putGraph(s, frontendGraph());
    const x = await planned(s, { approvalMode: 'auto-edits' });
    await x.lead.callLead('start_agent', { role: 'Page', task: 'Build it', helper: 'frontend' });
    await s.settle();
    const worker = s.fake.workers().at(-1);
    expect(worker?.spec.approvalMode).toBe('auto-edits');
    expect(codexOf(s).agents).toEqual([]);
    // A Claude agent's usage is left to transcript observation: nothing recorded here.
    worker?.started('sess-claude', 'claude-test');
    worker?.usage('msg-1', { input: 1, output: 1, cacheCreation: null, cacheRead: null });
    await s.settle();
    expect(createRepositories(s.db).usage.getRecord('claude-code', 'msg-1')).toBeUndefined();
  });

  it('a Codex helper with no Codex adapter ends provider-unavailable and the ticket says why', async () => {
    const s = await setupBoard({ files: FILES });
    await putGraph(s, frontendGraph(onCodex));
    const x = await planned(s);
    await x.lead.callLead('start_agent', { role: 'Page', task: 'Build it', helper: 'frontend' });
    await s.settle();
    expect(s.fake.workers()).toEqual([]);
    const helper = (await run(s, x.runId)).agents.find((a) => a.kind === 'worker');
    expect(helper?.status).toBe('FAILED');
    expect(helper?.provider).toBe('codex');
    expect(helper?.latestActivity).toBe(FULL_AUTO_FAILURE_ACTIVITY['provider-unavailable']);
    expect(systemLines(s, x.ticket.id)).toContain(
      'Page did not start: Codex is not set up on this server.',
    );
  });
});

describe('Codex availability (CX-4)', () => {
  it('ends the agent with the reason when Codex is not available, caches it, and checks again after a minute', async () => {
    let calls = 0;
    const reason = 'Codex is not signed in; run codex login.';
    const s = await setupBoard({
      files: FILES,
      codex: {
        checkAvailable: () => {
          calls++;
          return Promise.resolve({ ok: false, reason });
        },
      },
    });
    await setProvider(s, 'codex');
    expect(s.control.providerAvailability()).toEqual([
      { provider: 'claude-code', available: true, reason: null, checkedAt: null },
      { provider: 'codex', available: null, reason: null, checkedAt: null },
    ]);

    const a = await start(s, 'First');
    expect(calls).toBe(1);
    expect(codexOf(s).agents).toEqual([]);
    const lead = (await run(s, a.runId)).agents.find((g) => g.kind === 'lead');
    expect(lead?.status).toBe('FAILED');
    expect(lead?.latestActivity).toBe(FULL_AUTO_FAILURE_ACTIVITY['provider-unavailable']);
    expect(systemLines(s, a.ticket.id)).toContain(`Lead did not start: ${reason}`);
    expect(s.control.providerAvailability()[1]).toEqual({
      provider: 'codex',
      available: false,
      reason,
      checkedAt: s.clock.now.toISOString(),
    });
    expect(s.control.counters().diagnostics['provider-unavailable']).toBe(1);

    // Within the minute: the cached failure answers.
    s.clock.now = new Date(s.clock.now.getTime() + AVAILABILITY_RECHECK_MS - 1);
    await start(s, 'Second');
    expect(calls).toBe(1);

    // After it: asked again.
    s.clock.now = new Date(s.clock.now.getTime() + 2);
    await start(s, 'Third');
    expect(calls).toBe(2);
  });

  it('checks once and keeps an ok for the server lifetime', async () => {
    let calls = 0;
    const s = await setupBoard({
      files: FILES,
      codex: {
        checkAvailable: () => {
          calls++;
          return Promise.resolve({ ok: true });
        },
      },
    });
    await setProvider(s, 'codex');
    await start(s, 'First');
    expect(codexOf(s).agents.map((g) => g.spec.kind)).toEqual(['lead']);
    s.clock.now = new Date(s.clock.now.getTime() + 10 * AVAILABILITY_RECHECK_MS);
    await start(s, 'Second');
    expect(calls).toBe(1);
    expect(codexOf(s).agents).toHaveLength(2);
    expect(s.control.providerAvailability()[1]).toMatchObject({ available: true, reason: null });
  });
});

describe('Codex capabilities (ADR-0031 §5)', () => {
  it('drops the block skills on Codex with a ticket line', async () => {
    const s = await setupBoard({
      files: { ...FILES, '.claude/skills/lint/SKILL.md': SKILL },
      codex: {},
    });
    const saved = await putGraph(
      s,
      frontendGraph((n) => onCodex({ ...n, skills: ['lint'] } as WorkflowNode)),
    );
    expect(saved.issues.filter((i) => i.code === 'codex-skills-ignored')).toHaveLength(1);
    const x = await planned(s);
    await x.lead.callLead('start_agent', { role: 'Page', task: 'Build it', helper: 'frontend' });
    await s.settle();
    const worker = codexOf(s).agents.at(-1);
    expect(worker?.spec.skillPlugin).toBeUndefined();
    expect(systemLines(s, x.ticket.id)).toContain(
      "Page runs on Codex, which cannot load project skills yet, so its block's skills were not loaded.",
    );
  });

  it('refuses a Codex agent whose agent file narrows tools: at save, and at launch when stored anyway', async () => {
    const s = await setupBoard({
      files: { ...FILES, '.claude/agents/narrow.md': NARROW_AGENT },
      codex: {},
    });
    const graph = frontendGraph((n) => onCodex({ ...n, agent: 'narrow' } as WorkflowNode));
    const res = await s.send('put', `/api/projects/${s.project.id}/workflow-graph`, { graph });
    expect(res.status).toBe(422);
    const issues = (
      await s.post(`/api/projects/${s.project.id}/workflow-graph/validate`, { graph })
    ).body as { issues: { code: string; severity: string }[] };
    expect(issues.issues).toContainEqual(
      expect.objectContaining({ code: 'codex-agent-tools', severity: 'error' }),
    );
    // Stored behind the editor's back: the launch refuses it, never widening the agent's tools.
    createRedesignRepositories(s.db).workflow.putGraph(s.project.id, graph);
    const x = await planned(s);
    await x.lead.callLead('start_agent', { role: 'Page', task: 'Build it', helper: 'frontend' });
    await s.settle();
    expect(codexOf(s).agents).toEqual([]);
    const helper = (await run(s, x.runId)).agents.find((a) => a.kind === 'worker');
    expect(helper?.status).toBe('FAILED');
    expect(systemLines(s, x.ticket.id)).toContain(
      'Page did not start: its agent file "narrow" limits the agent\'s tools, which Codex cannot apply yet, so it would run with more tools than the file allows.',
    );
    expect(s.control.counters().diagnostics['capability-refused-profile-tools']).toBe(1);
  });

  it('runs Full auto on a Codex block (CX-3b): saved, started, launched with its sandbox paths and the deny list', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    const graph = frontendGraph((n) =>
      onCodex({ ...n, approvalMode: 'full-auto' } as WorkflowNode),
    );
    const res = await s.send('put', `/api/projects/${s.project.id}/workflow-graph`, { graph });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const x = await planned(s);
    await x.lead.callLead('start_agent', { role: 'Page', task: 'Build it', helper: 'frontend' });
    await s.settle();
    const worker = codexOf(s).agents.at(-1);
    if (worker === undefined) throw new Error('no codex worker');
    expect(worker.spec.kind).toBe('worker');
    expect(worker.spec.approvalMode).toBe('full-auto');
    const fullAuto = worker.spec.fullAuto;
    expect(fullAuto?.tempDir).toBe(realpathSync(join(s.dataDir, 'sandbox-tmp', x.runId)));
    expect(fullAuto?.gitDirs).toContain(realpathSync(join(s.repo, '.git')));
    // The same list as the Full auto paths, on the spec for the provider to enforce.
    expect(worker.spec.denyRead).toEqual(fullAuto?.denyRead);
    expect(worker.spec.denyRead).toContain(join(s.homeDir, '.codex'));
    expect(s.control.counters().diagnostics['capability-refused-full-auto']).toBeUndefined();
    // The Claude lead is not given the list: its adapter does not enforce it for every agent.
    expect(x.lead.spec.denyRead).toBeUndefined();
  });

  it('gives every Codex agent the deny list, whatever its role or mode', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    await setProvider(s, 'codex');
    await start(s);
    const lead = codexOf(s).agents.find((a) => a.spec.kind === 'lead');
    if (lead === undefined) throw new Error('no codex lead');
    const deny = lead.spec.denyRead ?? [];
    for (const dir of ['.ssh', '.aws', '.claude', '.codex']) {
      expect(deny).toContain(join(s.homeDir, dir));
    }
    expect(deny).toContain(s.dataDir);
    expect(lead.spec.fullAuto).toBeUndefined();
    expect(lead.spec.sandbox).toBeUndefined();
  });

  it('validates with the project default provider', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    const graph = frontendGraph((n) => ({ ...n, skills: ['lint'] }) as WorkflowNode);
    const valid = async () =>
      WorkflowGraphDtoSchema.shape.issues.parse(
        (
          (await s.post(`/api/projects/${s.project.id}/workflow-graph/validate`, { graph }))
            .body as { issues: unknown }
        ).issues,
      );
    expect((await valid()).map((i) => i.code)).not.toContain('codex-skills-ignored');
    await setProvider(s, 'codex');
    expect((await valid()).map((i) => i.code)).toContain('codex-skills-ignored');
  });
});

describe('follow-ups on the lead provider (ADR-0031 §7)', () => {
  it('resumes a Codex lead on Codex', async () => {
    const s = await setupBoard({ files: FILES, codex: {} });
    await setProvider(s, 'codex');
    const x = await start(s);
    const lead = codexOf(s).agents.find((a) => a.spec.kind === 'lead');
    if (lead === undefined) throw new Error('no codex lead');
    lead.started('thread-lead', 'gpt-test');
    await s.settle();
    lead.finish('success');
    await s.settle();
    const chat = await s.post(`/api/runs/${x.runId}/chat`, { text: 'Why?' });
    expect(chat.status, JSON.stringify(chat.body)).toBe(200);
    await s.settle();
    const turn = codexOf(s).agents.at(-1);
    expect(turn?.spec.followUp).toEqual({ resumeSessionId: 'thread-lead' });
    expect(s.fake.agents).toEqual([]);
  });

  it('resumes a Claude lead on Claude when Codex is registered too', async () => {
    const claude = createFakeManagedAdapter();
    const codex = createFakeManagedAdapter({ provider: 'codex' });
    const adapters = new Map([
      [claude.adapter.provider, claude.adapter],
      [codex.adapter.provider, codex.adapter],
    ]);
    const c = await setupControl({ overrides: { adapters } });
    const created = await c.post('/api/runs', { projectId: c.project.id });
    const runId = RunDetailDtoSchema.parse(created.body).id;
    await c.post(`/api/runs/${runId}/chat`, { text: 'Look' });
    await c.control.idle();
    const lead = claude.lead();
    lead.started();
    lead.finish('success');
    await c.detail(runId);
    expect((await c.post(`/api/runs/${runId}/chat`, { text: 'Why?' })).status).toBe(200);
    await c.control.idle();
    expect(claude.agents.at(-1)?.spec.followUp).toEqual({ resumeSessionId: `sess-${lead.id}` });
    expect(codex.agents).toEqual([]);
  });
});
