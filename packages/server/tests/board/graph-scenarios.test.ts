import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow, workflowTemplate, type WorkflowGraph } from '@acp/core';
import {
  RunWorkflowGraphDtoSchema,
  TicketBranchReviewDtoSchema,
  TicketDetailDtoSchema,
} from '@acp/core/api';
import { createRedesignRepositories } from '@acp/db';
import { FULL_AUTO_PLAN_LINE, runSettingsFromSetup, ticketRunPrompts } from '@acp/orchestrator';
import { head } from '../workspace/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, reviewers, run, type Board } from './loop-helpers.js';
import {
  LEAD,
  POOL,
  pendingApprovals,
  planAuto,
  poolMode,
  projectMode,
  putGraph,
  withHelper,
  withTester,
} from './graph-helpers.js';
import { FULL_AUTO_DENIED_MESSAGE } from '../../src/control/full-auto.js';

/*
 * Workflow graphs end to end through the server (ADR-0023, WG-C): scenarios a, b and c up to the
 * owner's one merge of the ticket branch, named helpers from plan steps, a refused plan step,
 * `maxInstances`, the plan gate's automatic approval and its tightening, a version 1 project, and
 * a restart. The fake managed adapter plays every agent; checks are tiny node scripts (they pass
 * once `fixed.txt` exists); git runs in a throwaway repository. Synthetic data only.
 */

type Lead = ReturnType<Board['fake']['lead']>;

/** Ready and Start (`body`); the lead (or planner) started. */
async function started(s: Board, body: object = {}, ticketExtra: object = {}) {
  const ticket = await s.createTicket('Add dark mode', ticketExtra);
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const res = await s.post(`/api/tickets/${ticket.id}/start`, body);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  await s.settle();
  const first = s.fake.agents.at(-1);
  if (first === undefined) throw new Error('nothing started');
  first.started();
  await s.settle();
  const runId = TicketDetailDtoSchema.parse(res.body).currentRun?.id ?? '';
  return { ticket, runId, first };
}

/** The lead plans one step (or `steps`); the owner approves unless the gate already did. */
async function planned(s: Board, lead: Lead, ticketId: string, steps?: object[]) {
  const reply = await lead.callLead('submit_plan', {
    summary: 'Add a theme toggle',
    steps: steps ?? [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
  });
  await s.settle();
  const plan = (await s.detail(ticketId)).plans.at(-1);
  if (plan?.status === 'proposed') {
    const res = await s.post(`/api/tickets/${ticketId}/plans/${plan.id}/decision`, {
      decision: 'approve',
    });
    expect(res.status).toBe(200);
    await s.settle();
  }
  return reply;
}

/** The lead starts a helper, which writes `files` into its worktree and finishes. */
async function helperDone(
  s: Board,
  lead: Lead,
  runId: string,
  files: Record<string, string>,
  input: object = { role: 'Builder' },
) {
  expect(await lead.callLead('start_agent', { task: 'Do it', ...input })).toContain(
    'Started agent',
  );
  await s.settle();
  const worker = s.fake.workers().at(-1);
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  await s.settle();
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(s.worktree(runId, worker.id), path), content);
  }
  worker.finish('success');
  await s.settle();
  return worker;
}

/** The latest review agent approves (or asks for rework) and ends. */
async function review(s: Board, verdict: 'approve' | 'rework', findings: string) {
  const reviewer = reviewers(s).at(-1);
  if (reviewer === undefined) throw new Error('no review agent');
  reviewer.started();
  await s.settle();
  const reply = await reviewer.callLead('submit_review', { verdict, findings });
  reviewer.finish('success');
  await s.settle();
  return { reviewer, reply };
}

/** The lead hands over; the owner merges the ticket branch into main once; the ticket is done. */
async function ownerMerges(s: Board, lead: Lead, runId: string, ticketId: string) {
  expect(await lead.callLead('request_review', {})).toBeTruthy();
  await s.settle();
  expect((await run(s, runId)).status).toBe('REVIEW');
  const tb = TicketBranchReviewDtoSchema.parse(
    (await s.get(`/api/runs/${runId}/ticket-branch`)).body,
  );
  const tip = tb.ticketBranch?.headCommit ?? '';
  expect(tb.checks).toMatchObject([{ status: 'passed', commit: tip }]);
  const merged = await s.post(`/api/runs/${runId}/ticket-branch`, { action: 'merge' });
  expect(merged.status).toBe(200);
  expect(head(s.repo)).toBe(tip);
  const after = TicketDetailDtoSchema.parse((await s.get(`/api/tickets/${ticketId}`)).body);
  expect(after.currentRun?.status).toBe('COMPLETED');
  expect(after.ticket).toMatchObject({ status: 'DONE', stage: 'DONE' });
  const nodes = RunWorkflowGraphDtoSchema.parse(
    (await s.get(`/api/runs/${runId}/workflow-graph`)).body,
  ).nodes;
  expect(nodes.find((n) => n.nodeId === 'owner-merge')?.state).toBe('done');
  expect(nodes.find((n) => n.nodeId === 'done')?.state).toBe('done');
}

const DONE_FILES = { 'src/theme.ts': 'export const dark = true;\n', 'fixed.txt': 'ok\n' };

describe('review scenarios end to end (ADR-0023 §4)', () => {
  it('(a) the lead reviews and merges itself; the owner merges once', async () => {
    const s = await setupBoard({ files: FILES });
    await putGraph(s, workflowTemplate('lead-only'));
    const { ticket, runId, first: lead } = await started(s);
    expect(lead.spec.kind).toBe('lead');
    await planned(s, lead, ticket.id);
    const worker = await helperDone(s, lead, runId, DONE_FILES);
    // No review agent: the lead is told the change is ready for its review.
    expect(reviewers(s)).toEqual([]);
    expect(lead.sent.some((m) => m.includes('is ready for your review'))).toBe(true);
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain(
      'Merged Builder into acp/WEBAPP-1',
    );
    const detail = await run(s, runId);
    expect(detail.changes?.[0]).toMatchObject({ state: 'merged', maxReworkRounds: 2 });
    expect(detail.changes?.[0]?.reviews.map((r) => [r.reviewer, r.decision, r.decidedBy])).toEqual([
      ['lead', 'merge', 'lead'],
    ]);
    await ownerMerges(s, lead, runId, ticket.id);
    expect(readFileSync(join(s.repo, 'src', 'theme.ts'), 'utf8')).toContain('dark');
  }, 60_000);

  it('(b) a review agent sends its findings to the lead, who merges; the owner merges once', async () => {
    const s = await setupBoard({ files: FILES });
    await putGraph(s, workflowTemplate('todays-setup'));
    const { ticket, runId, first: lead } = await started(s);
    await planned(s, lead, ticket.id);
    const worker = await helperDone(s, lead, runId, DONE_FILES);
    const { reviewer } = await review(s, 'approve', 'Looks right. Synthetic finding.');
    expect(reviewer.spec.reviewScope).toBe('change');
    expect(reviewer.spec.fullAuto).toBeUndefined();
    expect(lead.sent.some((m) => m.includes('Verdict: approve'))).toBe(true);
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged Builder');
    const change = (await run(s, runId)).changes?.[0];
    expect(change?.reviews.map((r) => [r.reviewer, r.verdict, r.decision, r.decidedBy])).toEqual([
      ['agent', 'approve', 'merge', 'lead'],
    ]);
    await ownerMerges(s, lead, runId, ticket.id);
  }, 60_000);

  it('(c) the reviewer reworks the helper directly, telling the lead; then the lead merges; the owner merges once', async () => {
    const s = await setupBoard({ files: FILES });
    await putGraph(s, workflowTemplate('reviewer-helper-loop'));
    const { ticket, runId, first: lead } = await started(s);
    await planned(s, lead, ticket.id);
    // The first change misses fixed.txt (its check fails); the reviewer sends it back itself.
    const worker = await helperDone(s, lead, runId, { 'src/theme.ts': 'export {};\n' });
    const first = await review(s, 'rework', 'Add the dark theme. Synthetic finding.');
    expect(first.reply).toContain('went back to the helper for rework');
    // The lead is told about the round, with no decision to take.
    expect(
      lead.sent.some((m) =>
        m.startsWith(`The review agent sent Builder's change (agentId ${worker.id}) back to it`),
      ),
    ).toBe(true);
    const again = s.fake.byId(worker.id);
    expect(again).not.toBe(worker);
    expect(again.spec.rework).toEqual({ resumeSessionId: `sess-${worker.id}` });
    expect(again.spec.prompt).toContain('Add the dark theme.');
    again.started(`sess-${worker.id}`);
    for (const [path, content] of Object.entries(DONE_FILES)) {
      writeFileSync(join(s.worktree(runId, worker.id), path), content);
    }
    again.finish('success');
    await s.settle();
    // Round 1: the reviewer approves; the change goes to the lead, which merges.
    await review(s, 'approve', 'Now right. Synthetic finding.');
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged Builder');
    const change = (await run(s, runId)).changes?.[0];
    expect(change).toMatchObject({ state: 'merged', reworkRounds: 1, maxReworkRounds: 2 });
    expect(change?.reviews.map((r) => [r.round, r.verdict, r.decision, r.decidedBy])).toEqual([
      [0, 'rework', 'rework', 'reviewer'],
      [1, 'approve', 'merge', 'lead'],
    ]);
    await ownerMerges(s, lead, runId, ticket.id);
  }, 60_000);
});

describe('a mixed-mode run through the server (ADR-0023 §5)', () => {
  it('Manual named helper, Full auto pool and an Auto edits tester each launch and ask by their own mode', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'auto-edits');
    const graph = withTester(
      withHelper(poolMode(workflowTemplate('lead-only'), 'full-auto'), {
        id: 'frontend',
        label: 'Frontend helper',
        mode: 'manual',
      }),
      null,
    );
    await putGraph(s, graph);
    const { ticket, runId, first: lead } = await started(s);
    await planned(s, lead, ticket.id);
    const pool = await helperDone(s, lead, runId, DONE_FILES);
    expect(pool.spec.fullAuto).toBeDefined();
    expect(await lead.callLead('merge_change', { agentId: pool.id })).toContain('Merged Builder');
    // The Manual helper starts without the sandbox and asks the owner even for its own edits.
    expect(
      await lead.callLead('start_agent', { role: 'Page', task: 'Do it', helper: 'frontend' }),
    ).toContain('Started agent');
    await s.settle();
    const front = s.fake.workers().at(-1);
    if (front === undefined) throw new Error('no worker');
    front.started();
    await s.settle();
    expect(front.spec.fullAuto).toBeUndefined();
    const asked = front.ask('Edit', 'Edit b.ts', {
      file_path: `${s.worktree(runId, front.id)}/b.ts`,
    });
    const pending = await pendingApprovals(s, runId);
    expect(pending.map((a) => a.agentRunId)).toEqual([front.id]);
    await s.post(`/api/approvals/${pending[0]?.id ?? ''}`, { decision: 'deny' });
    expect((await asked).allow).toBe(false);
    front.finish('success');
    await s.settle();
    // Hand over: the tester starts from the ticket branch, with the project's Auto edits mode.
    expect(await lead.callLead('request_review', {})).toBeTruthy();
    await s.settle();
    const tester = s.fake.agents.filter((a) => a.spec.kind === 'tester').at(-1);
    if (tester === undefined) throw new Error('no tester');
    tester.started();
    await s.settle();
    expect(tester.spec.fullAuto).toBeUndefined();
    const wt = (await s.control.agentWorkspace(runId, tester.id))?.path ?? '';
    expect(await tester.ask('Edit', 'Edit t.test.ts', { file_path: `${wt}/t.test.ts` })).toEqual({
      allow: true,
    });
    // Outside the Auto edits rules a tester's command waits for the owner (never the Full auto
    // "deny without asking"); the owner denies it.
    const curl = tester.ask('Bash', 'Bash curl', { command: 'curl https://example.test' });
    const waiting = await pendingApprovals(s, runId);
    expect(waiting.map((a) => a.agentRunId)).toEqual([tester.id]);
    await s.post(`/api/approvals/${waiting[0]?.id ?? ''}`, { decision: 'deny' });
    expect(await curl).not.toEqual({ allow: false, message: FULL_AUTO_DENIED_MESSAGE });
    expect(s.control.counters().diagnostics['full-auto-denied'] ?? 0).toBe(0);
    const nodes = RunWorkflowGraphDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/workflow-graph`)).body,
    ).nodes;
    expect(
      nodes
        .filter((n) => n.approvalMode !== undefined)
        .map((n) => [n.nodeId, n.approvalMode, n.sandbox]),
    ).toEqual([
      [POOL, 'full-auto', true],
      ['frontend', 'manual', false],
      ['unit-tests', 'auto-edits', false],
    ]);
  }, 60_000);
});

describe('named helpers (ADR-0023 §7)', () => {
  const graphWithFrontend = (max = 1) =>
    withHelper(workflowTemplate('lead-only'), {
      id: 'frontend',
      label: 'Frontend helper',
      maxInstances: max,
    });

  it('a plan step naming a helper by its label goes to that node, which the plan keeps across a restart', async () => {
    const s = await setupBoard({ files: FILES });
    await putGraph(s, graphWithFrontend());
    const { ticket, runId, first: lead } = await started(s);
    // The brief lists the helper nodes.
    expect(lead.spec.prompt).toContain('Frontend helper (helper "frontend")');
    await planned(s, lead, ticket.id, [
      { title: 'Page', role: 'Frontend helper', detail: 'The form' },
      { title: 'API', role: 'Builder', detail: '' },
    ]);
    const plan = (await s.detail(ticket.id)).plans[0];
    expect(plan?.steps.map((st) => st.helper)).toEqual(['frontend', POOL]);
    const worker = await helperDone(s, lead, runId, DONE_FILES, { role: 'Frontend helper' });
    const stages = createRedesignRepositories(s.db).runAudit.agentStagesForRun(runId);
    expect(stages.get(worker.id)).toBe('frontend');
    const nodes = RunWorkflowGraphDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/workflow-graph`)).body,
    ).nodes;
    expect(nodes.find((n) => n.nodeId === 'frontend')?.agentRunIds).toEqual([worker.id]);

    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    const reloaded = (await again.detail(ticket.id)).plans[0];
    expect(reloaded?.steps.map((st) => st.helper)).toEqual(['frontend', POOL]);
    // Nothing relaunches after a restart (ADR-0013 §7); the reloaded state keeps the step nodes.
    expect((await run(again, runId)).status).toBe('NEEDS_REVIEW');
    expect(again.control.peek(runId)?.planStepHelpers).toEqual({
      [plan?.id ?? '']: ['frontend', POOL],
    });
  }, 60_000);

  it('refuses a plan step no helper node takes, listing the helper nodes', async () => {
    const s = await setupBoard({ files: FILES });
    // Only a named helper: no pool to take other roles.
    const base = graphWithFrontend();
    const noPool: WorkflowGraph = {
      ...base,
      nodes: base.nodes.filter((n) => n.id !== POOL),
      edges: base.edges.filter((e) => e.from !== POOL && e.to !== POOL),
    };
    await putGraph(s, noPool);
    const { ticket, first: lead } = await started(s);
    await expect(
      lead.callLead('submit_plan', {
        summary: 'S',
        steps: [{ title: 'API', role: 'Builder', detail: '' }],
      }),
    ).rejects.toThrow(/Frontend helper \(helper "frontend"\)/);
    expect((await s.detail(ticket.id)).plans).toEqual([]);
    // Naming the node works.
    await planned(s, lead, ticket.id, [
      { title: 'API', role: 'Builder', detail: '', helper: 'frontend' },
    ]);
    expect((await s.detail(ticket.id)).plans[0]?.status).toBe('approved');
  }, 60_000);

  it('holds a named helper to its maxInstances', async () => {
    const s = await setupBoard({ files: FILES });
    await putGraph(s, graphWithFrontend(1));
    const { ticket, runId, first: lead } = await started(s);
    await planned(s, lead, ticket.id);
    expect(
      await lead.callLead('start_agent', { role: 'Page', task: 'One', helper: 'frontend' }),
    ).toContain('Started agent');
    await s.settle();
    await expect(
      lead.callLead('start_agent', { role: 'Page', task: 'Two', helper: 'frontend' }),
    ).rejects.toThrow('At most 1 of Frontend helper can work at once');
    // The pool still has room.
    expect(await lead.callLead('start_agent', { role: 'Builder', task: 'Three' })).toContain(
      'Started agent',
    );
    await s.settle();
    expect((await run(s, runId)).agents.filter((a) => a.kind === 'worker')).toHaveLength(2);
  }, 60_000);
});

describe('plan approval by the plan gate (ADR-0023 §6)', () => {
  const autoGraph = () => planAuto(poolMode(workflowTemplate('lead-only'), null), true);

  it('approves the plan at once when the gate is automatic and no ceiling is stricter than Full auto', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'full-auto');
    await putGraph(s, autoGraph());
    const { ticket, runId, first: lead } = await started(s);
    expect(lead.spec.prompt).toContain(FULL_AUTO_PLAN_LINE);
    const reply = await planned(s, lead, ticket.id);
    expect(reply).toContain('approved automatically (Full auto)');
    expect((await s.detail(ticket.id)).plans[0]).toMatchObject({
      status: 'approved',
      decidedBy: 'auto',
    });
    expect((await run(s, runId)).status).toBe('RUNNING');
  }, 60_000);

  it('a stricter ticket mode makes the plan wait for the owner', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'full-auto');
    await putGraph(s, autoGraph());
    const { ticket, first: lead } = await started(s, {}, { runOptions: { approvalMode: 'auto' } });
    expect(lead.spec.prompt).not.toContain(FULL_AUTO_PLAN_LINE);
    await lead.callLead('submit_plan', {
      summary: 'S',
      steps: [{ title: 'Build', role: 'Builder', detail: '' }],
    });
    await s.settle();
    const detail = await s.detail(ticket.id);
    expect(detail.currentRun?.status).toBe('PLAN_REVIEW');
    expect(detail.plans[0]?.decidedBy).toBeUndefined();
  }, 60_000);

  it('a gate that asks makes the plan wait even when every node is Full auto', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'full-auto');
    await putGraph(s, planAuto(autoGraph(), false));
    const { ticket, first: lead } = await started(s);
    await lead.callLead('submit_plan', {
      summary: 'S',
      steps: [{ title: 'Build', role: 'Builder', detail: '' }],
    });
    await s.settle();
    expect((await s.detail(ticket.id)).currentRun?.status).toBe('PLAN_REVIEW');
  }, 60_000);
});

describe('a version 1 project (ADR-0023 §9)', () => {
  it('runs exactly as before: the same briefs, stages and models, on its migrated graph', async () => {
    const s = await setupBoard({ files: FILES });
    const base = defaultProjectWorkflow(s.project.id, s.project.createdAt);
    const v1 = {
      plannerMode: 'separate' as const,
      stages: {
        ...base.stages,
        plan: { model: 'claude-plan-model', skill: null },
        helpers: { model: 'claude-helper-model', skill: null },
      },
    };
    expect((await s.send('put', `/api/projects/${s.project.id}/workflow`, v1)).status).toBe(200);
    const { ticket, runId, first: planner } = await started(s);
    const setup = await s.board.getSetup(s.project.id);
    const prompts = ticketRunPrompts(
      { ...ticket, description: ticket.description },
      runSettingsFromSetup(setup).limits,
      v1,
      { fullAuto: false },
    );
    expect(planner.spec.kind).toBe('planner');
    expect(planner.spec.prompt).toBe(prompts.plannerPrompt);
    expect(planner.spec.model).toBe('claude-plan-model');
    await planner.callLead('submit_plan', {
      summary: 'Add a theme toggle',
      steps: [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
    });
    await s.settle();
    const plan = (await s.detail(ticket.id)).plans[0];
    // Version 1 runs have no named helpers: the stored steps keep no helper node.
    expect(plan?.steps[0]).not.toHaveProperty('helper');
    await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    await s.settle();
    const lead = s.fake.lead();
    lead.started();
    await s.settle();
    expect(lead.spec.prompt.startsWith(prompts.leadPrompt)).toBe(true);
    const worker = await helperDone(s, lead, runId, DONE_FILES);
    expect(worker.spec.model).toBe('claude-helper-model');
    expect(worker.spec.fullAuto).toBeUndefined();
    // Route b, as the version 1 review stage says: a review agent (stage `review`), then the
    // lead decides. Every agent keeps its version 1 stage id.
    expect(stagesOf(s, runId).sort()).toEqual(['helpers', 'orchestrate', 'plan', 'review']);
    await review(s, 'approve', 'Fine. Synthetic finding.');
    expect(await lead.callLead('merge_change', { agentId: worker.id })).toContain('Merged Builder');
    await ownerMerges(s, lead, runId, ticket.id);
    expect(lead.id).toBe(
      [...createRedesignRepositories(s.db).runAudit.agentStagesForRun(runId)].find(
        ([, stage]) => stage === LEAD,
      )?.[0],
    );
  }, 60_000);
});

function stagesOf(s: Board, runId: string): (string | null)[] {
  return [...createRedesignRepositories(s.db).runAudit.agentStagesForRun(runId).values()];
}
