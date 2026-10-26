import { AGENT_NOTE_LINE } from '@acp/orchestrator';
// Synthetic temp git repos, skill folders and the scripted fake adapter only (R-G Part 2).
// Never the Agent SDK, never the real ~/.claude.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow, type AgentRoleKind } from '@acp/core';
import {
  RunDetailDtoSchema,
  RunWorkflowDtoSchema,
  type RunWorkflowDto,
  type TicketDto,
  type UpdateWorkflowRequest,
} from '@acp/core/api';
import { createRedesignRepositories } from '@acp/db';
import {
  PLANNER_READ_ONLY_MESSAGE,
  REVIEWER_READ_ONLY_MESSAGE,
} from '../../src/control/service.js';
import { expectError } from '../control/helpers.js';
import type { FakeAgent } from '../control/fake-adapter.js';
import { setupBoard } from '../board/helpers.js';

type Board = Awaited<ReturnType<typeof setupBoard>>;

function stages(): UpdateWorkflowRequest['stages'] {
  return defaultProjectWorkflow('x', '2026-10-16T09:00:00.000Z').stages;
}

async function saveWorkflow(s: Board, workflow: UpdateWorkflowRequest): Promise<void> {
  const res = await s.send('put', `/api/projects/${s.project.id}/workflow`, workflow);
  expect(res.status).toBe(200);
}

function agentOf(s: Board, kind: AgentRoleKind, nth = 0): FakeAgent {
  const agent = s.fake.agents.filter((a) => a.spec.kind === kind)[nth];
  if (agent === undefined) throw new Error(`no ${kind} agent started`);
  return agent;
}

/** Created, moved to Ready and started, without driving any agent. */
async function startReady(s: Board): Promise<TicketDto> {
  const ticket = await s.createTicket();
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  expect((await s.post(`/api/tickets/${ticket.id}/start`)).status).toBe(200);
  await s.settle();
  return ticket;
}

async function runIdOf(s: Board, ticketId: string): Promise<string> {
  return (await s.detail(ticketId)).currentRun?.id ?? '';
}

async function runWorkflow(s: Board, runId: string): Promise<Record<string, string>> {
  await s.settle();
  const res = await s.get(`/api/runs/${runId}/workflow`);
  expect(res.status).toBe(200);
  const dto: RunWorkflowDto = RunWorkflowDtoSchema.parse(res.body);
  return Object.fromEntries(dto.stages.map((st) => [st.stage, st.state]));
}

async function approvePlan(s: Board, ticketId: string): Promise<void> {
  const plan = (await s.detail(ticketId)).plans.at(-1);
  const res = await s.post(`/api/tickets/${ticketId}/plans/${plan?.id ?? ''}/decision`, {
    decision: 'approve',
  });
  expect(res.status).toBe(200);
  await s.settle();
}

/** Lead mode: plan approved, one helper writes a file, its change is merged. */
async function toMergedHelper(s: Board) {
  const { ticket } = await s.startTicket();
  await s.submitPlan();
  await approvePlan(s, ticket.id);
  const lead = s.fake.lead();
  await lead.callLead('start_agent', { role: 'Builder', task: 'Build the toggle' });
  await s.settle();
  const worker = agentOf(s, 'worker');
  worker.started();
  const runId = await runIdOf(s, ticket.id);
  writeFileSync(join(s.worktree(runId, worker.id), 'src', 'theme.ts'), 'export const dark = 1;\n');
  worker.finish('success');
  await s.settle();
  await lead.callLead('request_review', {});
  await s.settle();
  const merged = await s.post(`/api/runs/${runId}/review`, {
    agentRunId: worker.id,
    action: 'merge',
  });
  expect(merged.status).toBe(200);
  await s.settle();
  return { ticket, runId, worker, lead };
}

describe('separate planner (ADR-0019)', () => {
  it('starts the planner read-only in the project; the lead starts with the approved plan', async () => {
    const s = await setupBoard({ legacyRuns: true });
    await saveWorkflow(s, { plannerMode: 'separate', stages: stages() });
    const ticket = await startReady(s);
    const runId = await runIdOf(s, ticket.id);

    const planner = agentOf(s, 'planner');
    expect(planner.spec.cwd).toBe(s.repo);
    expect(planner.spec.leadTools).toBeDefined();
    expect(s.fake.agents.map((a) => a.spec.kind)).toEqual(['planner']);
    planner.started();
    expect(await planner.ask('Edit', 'Edit src/app.ts')).toEqual({
      allow: false,
      message: PLANNER_READ_ONLY_MESSAGE,
    });
    expect(await runWorkflow(s, runId)).toMatchObject({ plan: 'active', orchestrate: 'waiting' });

    await planner.callLead('submit_plan', {
      summary: 'Add a theme toggle',
      steps: [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
    });
    await s.settle();
    expect(await runWorkflow(s, runId)).toMatchObject({ plan: 'needs-you' });
    await approvePlan(s, ticket.id);

    expect(planner.aborted || planner.ended).toBe(true);
    const lead = s.fake.lead();
    expect(lead.spec).toMatchObject({ kind: 'lead', cwd: s.repo });
    expect(lead.spec.prompt).toContain('Add a theme toggle');
    lead.started();
    expect(await runWorkflow(s, runId)).toMatchObject({ plan: 'done', orchestrate: 'active' });

    const stored = createRedesignRepositories(s.db).runAudit.agentStagesForRun(runId);
    expect([...stored.values()].sort()).toEqual(['orchestrate', 'plan']);
  });
});

describe('post-merge stages: reviewer and tester (ADR-0019)', () => {
  it('reviews the merged main branch, posts a reviewer comment, then the tester change is merged', async () => {
    const s = await setupBoard({ legacyRuns: true });
    const st = stages();
    st['code-review'] = { enabled: true, model: 'claude-review-model', skill: null };
    st['unit-tests'] = { enabled: true, model: null, skill: null };
    await saveWorkflow(s, { plannerMode: 'lead', stages: st });
    const { ticket, runId, lead } = await toMergedHelper(s);

    // The reviewer reads a temporary detached checkout of the main branch, with the merge in it.
    const reviewer = agentOf(s, 'reviewer');
    expect(lead.aborted || lead.ended).toBe(true);
    expect(reviewer.spec.cwd.startsWith(join(s.dataDir, 'review-checkouts', runId))).toBe(true);
    expect(readFileSync(join(reviewer.spec.cwd, 'src', 'theme.ts'), 'utf8')).toContain('dark');
    expect(reviewer.spec.model).toBe('claude-review-model');
    expect(reviewer.spec.leadTools).toBeDefined();
    expect(s.control.extraRoots().some((r) => r.rootPath === reviewer.spec.cwd)).toBe(true);
    expect(s.control.isManagedPath(reviewer.spec.cwd)).toBe(true);
    reviewer.started();
    expect(await reviewer.ask('Edit', 'Edit src/theme.ts')).toEqual({
      allow: false,
      message: REVIEWER_READ_ONLY_MESSAGE,
    });
    expect(await runWorkflow(s, runId)).toMatchObject({
      helpers: 'done',
      review: 'done',
      'code-review': 'active',
      'unit-tests': 'waiting',
    });

    s.notices.length = 0;
    await reviewer.callLead('post_review', { text: 'The toggle has no keyboard shortcut.' });
    await s.settle();
    const comments = (await s.detail(ticket.id)).comments.filter((c) => c.author === 'reviewer');
    expect(comments).toEqual([
      expect.objectContaining({
        runId,
        planId: null,
        body: 'The toggle has no keyboard shortcut.',
      }),
    ]);
    expect(
      s.notices.some((n) => n.kind === 'tickets-changed' && n.ticketIds?.includes(ticket.id)),
    ).toBe(true);

    const checkout = reviewer.spec.cwd;
    reviewer.finish('success');
    await s.settle();
    expect(existsSync(checkout)).toBe(false);

    // The tester works in its own worktree from main, and its change is reviewed and merged.
    const tester = agentOf(s, 'tester');
    expect(tester.spec.cwd).toBe(s.worktree(runId, tester.id));
    // ADR-0026 §3: the tester's one control-plane tool is report_work.
    expect(tester.spec.leadTools).toBeDefined();
    expect(tester.spec.prompt.endsWith(AGENT_NOTE_LINE)).toBe(true);
    expect(readFileSync(join(tester.spec.cwd, 'src', 'theme.ts'), 'utf8')).toContain('dark');
    expect(await runWorkflow(s, runId)).toMatchObject({
      'code-review': 'done',
      'unit-tests': 'active',
    });
    tester.started();
    writeFileSync(join(tester.spec.cwd, 'src', 'theme.test.ts'), 'export const tested = 1;\n');
    tester.finish('success');
    await s.settle();
    expect(await runWorkflow(s, runId)).toMatchObject({ 'unit-tests': 'needs-you' });

    const review = await s.get(`/api/runs/${runId}/review`);
    const reviewed = (review.body as { agents: { agentRunId: string }[] }).agents;
    expect(reviewed.map((a) => a.agentRunId)).toContain(tester.id);
    const merged = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: tester.id,
      action: 'merge',
    });
    expect(merged.status).toBe(200);
    await s.settle();
    expect(existsSync(join(s.repo, 'src', 'theme.test.ts'))).toBe(true);

    const run = RunDetailDtoSchema.parse((await s.get(`/api/runs/${runId}`)).body);
    expect(run.status).toBe('COMPLETED');
    expect((await s.detail(ticket.id)).ticket.status).toBe('DONE');
    expect(await runWorkflow(s, runId)).toEqual({
      plan: 'done',
      orchestrate: 'done',
      helpers: 'done',
      review: 'done',
      'code-review': 'done',
      'unit-tests': 'done',
    });
    const stored = createRedesignRepositories(s.db).runAudit.agentStagesForRun(runId);
    expect(stored.get(reviewer.id)).toBe('code-review');
    expect(stored.get(tester.id)).toBe('unit-tests');
  }, 60_000);

  it('answers off for stages the workflow switches off, and 404 for an unknown run', async () => {
    const s = await setupBoard({ legacyRuns: true });
    const { ticket } = await s.startTicket();
    const runId = await runIdOf(s, ticket.id);
    expect(await runWorkflow(s, runId)).toEqual({
      plan: 'active',
      orchestrate: 'waiting',
      helpers: 'waiting',
      review: 'waiting',
      'code-review': 'off',
      'unit-tests': 'off',
    });
    expect((await s.get('/api/runs/nope/workflow')).status).toBe(404);
  });
});

describe('skills plugin (ADR-0019 §4)', () => {
  it('copies mapped skills from the checkout with front matter cut to name and description', async () => {
    const s = await setupBoard({ legacyRuns: true });
    const skills = join(s.repo, '.claude', 'skills');
    mkdirSync(join(skills, 'planning'), { recursive: true });
    writeFileSync(
      join(skills, 'planning', 'SKILL.md'),
      [
        '---',
        'name: planning',
        'description: Plan small steps first.',
        'allowed-tools: Bash, Write',
        'model: some-model',
        '---',
        '# Planning',
        'Write the plan in short steps.',
        '',
      ].join('\n'),
    );
    const outside = join(s.homeDir, 'elsewhere');
    mkdirSync(join(outside, 'linked'), { recursive: true });
    writeFileSync(join(outside, 'linked', 'SKILL.md'), '---\nname: linked\n---\nNot ours.\n');
    symlinkSync(join(outside, 'linked'), join(skills, 'linked'));

    const st = stages();
    st.plan = { model: 'claude-plan-model', skill: 'planning' };
    st.orchestrate = { model: null, skill: 'linked' };
    await saveWorkflow(s, { plannerMode: 'lead', stages: st });
    const ticket = await startReady(s);
    const runId = await runIdOf(s, ticket.id);

    const lead = s.fake.lead();
    const plugin = join(s.dataDir, 'runs', runId, 'skills-plugin');
    expect(lead.spec.skillPlugin).toEqual({ path: plugin, skills: ['acp-skills:planning'] });
    expect(lead.spec.model).toBe('claude-plan-model');
    expect(lead.spec.prompt).toContain('acp-skills:planning');
    expect(JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'))).toEqual(
      { name: 'acp-skills' },
    );
    const copied = readFileSync(join(plugin, 'skills', 'planning', 'SKILL.md'), 'utf8');
    expect(copied).toBe(
      '---\nname: planning\ndescription: "Plan small steps first."\n---\n# Planning\nWrite the plan in short steps.\n',
    );
    expect(copied).not.toContain('allowed-tools');
    expect(existsSync(join(plugin, 'skills', 'linked'))).toBe(false);
    expect(s.control.counters().diagnostics['skill-unavailable']).toBe(1);

    // The plugin is a run's temporary file: it goes when the run ends.
    expect((await s.post(`/api/runs/${runId}/stop`)).status).toBe(200);
    await s.settle();
    expect(existsSync(plugin)).toBe(false);
  });
});

describe('stage agent files (ADR-0019 §6)', () => {
  const SETUP = {
    projectKey: 'WEB',
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 100_000,
    model: 'claude-project-model',
    allowlist: { editInOwnWorktree: false, runHarnessChecks: false },
    contextFiles: [],
  };

  function agentFile(name: string, extra: string[], body: string): string {
    return [
      '---',
      `name: ${name}`,
      'description: Synthetic test agent.',
      ...extra,
      '---',
      body,
    ].join('\n');
  }

  function writeAgent(root: string, name: string, text: string): void {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', `${name}.md`), text);
  }

  it("gives the lead the file's instructions and tools; the file model beats the project's", async () => {
    const s = await setupBoard({ legacyRuns: true });
    expect((await s.send('put', `/api/projects/${s.project.id}/setup`, SETUP)).status).toBe(200);
    writeAgent(
      s.repo,
      'lead-style',
      agentFile(
        'lead-style',
        ['tools: Read, Grep, Bash', 'model: claude-file-model', 'permissionMode: acceptEdits'],
        'Plan in three steps at most.\n',
      ),
    );
    const st = stages();
    st.orchestrate = { model: null, skill: null, agent: 'lead-style' };
    await saveWorkflow(s, { plannerMode: 'lead', stages: st });
    await startReady(s);

    const lead = s.fake.lead();
    expect(lead.spec.profile).toEqual({
      name: 'lead-style',
      instructions: 'Plan in three steps at most.\n',
      tools: ['Read', 'Grep', 'Bash'],
    });
    expect(lead.spec.model).toBe('claude-file-model');
    // The file goes to the system prompt (adapter), not into the first message.
    expect(lead.spec.prompt).not.toContain('three steps');
    expect(JSON.stringify(lead.spec.profile)).not.toContain('acceptEdits');
    expect(s.control.counters().diagnostics['agent-file-unavailable']).toBeUndefined();
  });

  it("an explicit stage model wins over the file's; a helper's file comes from the owner's checkout", async () => {
    const s = await setupBoard({
      legacyRuns: true,
      files: {
        'README.md': 'hello\n',
        'src/app.ts': 'export {};\n',
        '.claude/agents/frontend-dev.md': agentFile(
          'frontend-dev',
          ['tools: Read'],
          'Committed.\n',
        ),
      },
    });
    expect((await s.send('put', `/api/projects/${s.project.id}/setup`, SETUP)).status).toBe(200);
    // The owner's uncommitted edit is what runs; the helper's worktree still has the committed one.
    writeAgent(
      s.repo,
      'frontend-dev',
      agentFile('frontend-dev', ['tools: Read, Edit', 'model: claude-file-model'], 'Owner copy.\n'),
    );
    const st = stages();
    st.helpers = { model: 'claude-stage-model', skill: null, agent: 'frontend-dev' };
    await saveWorkflow(s, { plannerMode: 'lead', stages: st });
    const { ticket } = await s.startTicket();
    expect(s.fake.lead().spec.profile).toBeUndefined();
    await s.submitPlan();
    await approvePlan(s, ticket.id);
    await s.fake.lead().callLead('start_agent', { role: 'Builder', task: 'Build the toggle' });
    await s.settle();

    const worker = agentOf(s, 'worker');
    expect(worker.spec.cwd).not.toBe(s.repo);
    expect(worker.spec.profile).toEqual({
      name: 'frontend-dev',
      instructions: 'Owner copy.\n',
      tools: ['Read', 'Edit'],
    });
    expect(worker.spec.model).toBe('claude-stage-model');
    expect(
      readFileSync(join(worker.spec.cwd, '.claude', 'agents', 'frontend-dev.md'), 'utf8'),
    ).toContain('Committed.');
  });

  it('starts the agent without a profile when the file is missing or unparsable, and counts it', async () => {
    const entries: { message: string; fields: unknown }[] = [];
    const s = await setupBoard({
      legacyRuns: true,
      logger: { log: (_level, message, fields) => entries.push({ message, fields }) },
    });
    expect((await s.send('put', `/api/projects/${s.project.id}/setup`, SETUP)).status).toBe(200);
    writeAgent(
      s.repo,
      'broken',
      '---\nname: broken\ntools: Read\ntools: Bash\n---\nSECRET-BODY-TEXT\n',
    );
    const st = stages();
    st.plan = { model: null, skill: null, agent: 'broken' };
    st['code-review'] = { enabled: false, model: null, skill: null, agent: 'gone-agent' };
    await saveWorkflow(s, { plannerMode: 'separate', stages: st });
    await startReady(s);

    const planner = agentOf(s, 'planner');
    expect(planner.spec.profile).toBeUndefined();
    expect(planner.spec.model).toBe('claude-project-model');
    expect(s.control.counters().diagnostics['agent-file-unavailable']).toBe(1);
    const logged = entries.filter((e) => e.message === 'project agent file unavailable');
    expect(logged).toHaveLength(1);
    expect(logged[0]?.fields).toMatchObject({ agentFile: 'broken', problem: 'unparsable' });
    expect(JSON.stringify(entries)).not.toContain('SECRET-BODY-TEXT');
  });

  it('a missing file for the lead: started without a profile, the run goes on', async () => {
    const s = await setupBoard({ legacyRuns: true });
    const st = stages();
    st.orchestrate = { model: null, skill: null, agent: 'gone-agent' };
    await saveWorkflow(s, { plannerMode: 'lead', stages: st });
    const { ticket } = await s.startTicket();
    const lead = s.fake.lead();
    expect(lead.spec.profile).toBeUndefined();
    expect(lead.spec.model).toBeNull();
    expect(s.control.counters().diagnostics['agent-file-unavailable']).toBe(1);
    await s.submitPlan();
    expect((await s.detail(ticket.id)).plans).toHaveLength(1);
  });
});

describe('Continue after a restart (ADR-0019, ADR-0013 §7)', () => {
  it('holds the interrupted code review until the owner continues, across restarts', async () => {
    const first = await setupBoard({ legacyRuns: true });
    const st = stages();
    st['code-review'] = { enabled: true, model: null, skill: null };
    await saveWorkflow(first, { plannerMode: 'lead', stages: st });
    const { runId } = await toMergedHelper(first);
    const reviewer = agentOf(first, 'reviewer');
    reviewer.started();
    await first.settle();
    const checkout = reviewer.spec.cwd;
    expect(existsSync(checkout)).toBe(true);

    // "Crash": a second server opens the same database, data folder and repository.
    const reopen = { dbPath: first.dbPath, dataDir: first.dataDir, repo: first.repo };
    const second = await setupBoard({ legacyRuns: true, reopen });
    expect(second.fake.agents).toEqual([]);
    expect(existsSync(checkout)).toBe(false);
    expect(await runWorkflow(second, runId)).toMatchObject({ 'code-review': 'needs-you' });

    // A third start must not begin the held stage by itself.
    const third = await setupBoard({ legacyRuns: true, reopen });
    expect(third.fake.agents).toEqual([]);
    expect(await runWorkflow(third, runId)).toMatchObject({ 'code-review': 'needs-you' });

    expectError(
      await third.send('post', `/api/runs/${runId}/continue`).set('X-ACP-CSRF', 'f'.repeat(64)),
      403,
      'csrf_invalid',
    );
    const res = await third.post(`/api/runs/${runId}/continue`, {});
    expect(res.status).toBe(200);
    expect(RunDetailDtoSchema.parse(res.body).status).toBe('REVIEW');
    await third.settle();
    const again = agentOf(third, 'reviewer');
    expect(again.spec.cwd.startsWith(join(third.dataDir, 'review-checkouts', runId))).toBe(true);
    expect(await runWorkflow(third, runId)).toMatchObject({ 'code-review': 'active' });

    expectError(await third.post(`/api/runs/${runId}/continue`, {}), 409, 'run_not_active');
  }, 60_000);
});
