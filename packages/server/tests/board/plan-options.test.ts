import { describe, expect, it } from 'vitest';
import { workflowTemplateV3, type WorkflowGraphV3 } from '@acp/core';
import {
  RunWorkflowGraphDtoSchema,
  TicketDetailDtoSchema,
  WorkflowGraphDtoSchema,
} from '@acp/core/api';
import { createWorkspaceRepositories } from '@acp/db';
import type { FakeAgent } from '../control/fake-adapter.js';
import { setupBoard } from './helpers.js';
import { FILES, type Board } from './loop-helpers.js';

/*
 * ADR-0037 §3–4 through the server (AR-4): a version 3 workflow with a researcher feeding one of
 * two planners starts end to end on the fake managed adapter; the researcher gets the ticket in its
 * brief, the planner its findings; both planners' plans are stored as plan options (migration
 * 0016), and the owner approves one through `POST /api/tickets/:id/plan-options/decision`, which
 * makes it the run's plan exactly like a single planner's. Synthetic data only.
 */

const FINDINGS = 'SYNTHETIC-FINDINGS-AR4: src/app.ts sets the theme.';

function researchedTwoPlanners(): WorkflowGraphV3 {
  const g = workflowTemplateV3('reviewer-helper-loop', { planner: true });
  const agent = (id: string, label: string) => ({
    type: 'agent' as const,
    id,
    label,
    model: null,
    skills: [],
    agent: null,
  });
  return {
    ...g,
    template: 'custom',
    nodes: [...g.nodes, agent('r1', 'Claude research'), agent('plan-2', 'Codex planner')],
    edges: [
      ...g.edges,
      {
        type: 'research',
        id: 'research-r1-plan',
        from: 'r1',
        to: 'plan',
        label: 'Theme notes',
        purpose: 'Where the theme is set today',
      },
      { type: 'flow', id: 'flow-ticket-plan-2', from: 'ticket', to: 'plan-2' },
      { type: 'plan', id: 'plan-plan-2', from: 'plan-2', to: 'plan-approval' },
    ],
  };
}

const stepsOf = (title: string) => [{ title, role: 'Builder', detail: 'Synthetic step' }];

function latest(s: Board, kind: string): FakeAgent {
  const agent = s.fake.agents.filter((a) => a.spec.kind === kind).at(-1);
  if (agent === undefined) throw new Error(`no ${kind}`);
  return agent;
}

/** The ticket started on the graph, the research done and both planners' plans submitted. */
async function inPlanReview(s: Board) {
  const graph = researchedTwoPlanners();
  const put = await s.send('put', `/api/projects/${s.project.id}/workflow-graph`, { graph });
  expect(put.status, JSON.stringify(put.body).slice(0, 400)).toBe(200);
  expect(WorkflowGraphDtoSchema.parse(put.body).stored).toBe('v3');
  const ticket = await s.createTicket('Add dark mode');
  await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
  const started = await s.post(`/api/tickets/${ticket.id}/start`);
  expect(started.status, JSON.stringify(started.body).slice(0, 400)).toBe(200);
  await s.settle();
  const runId = TicketDetailDtoSchema.parse(started.body).currentRun?.id ?? '';

  // The researcher starts first, with the ticket in its brief (`ticketResearcherPrompt`).
  const researcher = latest(s, 'researcher');
  expect(researcher.spec.prompt).toContain('Add dark mode');
  researcher.started();
  await s.settle();
  expect(await researcher.callLead('report_findings', { findings: FINDINGS })).toContain(
    'recorded',
  );
  researcher.finish('success');
  await s.settle();

  // The researched planner starts once the research is done, with the findings as data.
  // Two planners: the researched one (it waited for the research) and the other.
  const planners = s.fake.agents.filter((a) => a.spec.kind === 'planner');
  expect(planners).toHaveLength(2);
  const p1 = planners.find((a) => a.spec.prompt.includes(FINDINGS));
  const p2 = planners.find((a) => !a.spec.prompt.includes(FINDINGS));
  if (p1 === undefined || p2 === undefined) throw new Error('the planners did not start');
  expect(p1.spec.prompt).toContain(FINDINGS);
  expect(p1.spec.prompt).toContain('Where the theme is set today');
  expect(p2.spec.prompt).not.toContain(FINDINGS);
  p1.started();
  p2.started();
  await s.settle();
  await p1.callLead('submit_plan', { summary: 'Plan A: a toggle', steps: stepsOf('Toggle') });
  await s.settle();
  expect((await s.detail(ticket.id)).currentRun?.status).toBe('PLANNING');
  await p2.callLead('submit_plan', { summary: 'Plan B: a menu', steps: stepsOf('Menu') });
  await s.settle();
  return { ticket, runId, p1, p2 };
}

const decide = (s: Board, ticketId: string, body: object) =>
  s.post(`/api/tickets/${ticketId}/plan-options/decision`, body);

describe('several planners through the server (ADR-0037 §4, AR-4)', () => {
  it('stores both plan options, serves them while in plan review, and approves the second', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId, p1, p2 } = await inPlanReview(s);
    const detail = await s.detail(ticket.id);
    expect(detail.currentRun?.status).toBe('PLAN_REVIEW');
    expect(detail.plans).toEqual([]);
    expect(
      detail.planOptions?.map((o) => [o.optionIndex, o.nodeId, o.label, o.summary, o.status]),
    ).toEqual([
      [1, 'plan', 'Planner', 'Plan A: a toggle', 'proposed'],
      [2, 'plan-2', 'Codex planner', 'Plan B: a menu', 'proposed'],
    ]);
    expect(detail.planOptions?.[0]).toMatchObject({ agentRunId: p1.id, planId: null });
    expect(detail.planOptions?.[1]).toMatchObject({ agentRunId: p2.id });
    expect(detail.planOptions?.[1]?.steps.map((st) => st.title)).toEqual(['Menu']);

    // The live run graph is version 3: the researcher is done, plan approval needs the owner.
    const runGraph = RunWorkflowGraphDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/workflow-graph`)).body,
    );
    expect(runGraph.graph.edges.find((e) => e.id === 'research-r1-plan')?.label).toBe(
      'Theme notes',
    );
    const state = (id: string) => runGraph.nodes.find((n) => n.nodeId === id)?.state;
    expect(state('r1')).toBe('done');
    expect(state('plan-approval')).toBe('needs-you');

    const option2 = detail.planOptions?.[1]?.id ?? '';
    const res = await decide(s, ticket.id, {
      decision: 'approve',
      planOptionId: option2,
      comment: 'Go with the menu.',
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    await s.settle();
    const after = await s.detail(ticket.id);
    expect(after.currentRun?.status).toBe('RUNNING');
    expect(after.plans.map((p) => [p.version, p.summary, p.status])).toEqual([
      [1, 'Plan B: a menu', 'approved'],
    ]);
    expect(after.planOptions?.map((o) => o.status)).toEqual(['not-chosen', 'chosen']);
    expect(after.planOptions?.[1]?.planId).toBe(after.plans[0]?.id);
    expect(after.comments.some((c) => c.body === 'Go with the menu.')).toBe(true);
    // The lead starts with the chosen plan.
    const lead = latest(s, 'lead');
    expect(lead.spec.prompt).toContain('Plan B: a menu');

    // Stored (migration 0016): the options survive in the database as decided.
    const stored = createWorkspaceRepositories(s.db).planOptions.listForRun(runId);
    expect(stored.map((o) => [o.optionIndex, o.status])).toEqual([
      [1, 'not-chosen'],
      [2, 'chosen'],
    ]);
  });

  it('validates the decision: an option id is required with two, must exist, and not on a plan', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket } = await inPlanReview(s);
    const missing = await decide(s, ticket.id, { decision: 'approve' });
    expect(missing.status).toBe(400);
    expect((missing.body as { error: { code: string } }).error.code).toBe('invalid_input');
    const unknown = await decide(s, ticket.id, { decision: 'approve', planOptionId: 'nope' });
    expect(unknown.status).toBe(404);
    expect((unknown.body as { error: { code: string } }).error.code).toBe('plan_not_found');
    const noComment = await decide(s, ticket.id, { decision: 'request-changes' });
    expect(noComment.status).toBe(400);
    const other = await s.createTicket('Other');
    expect((await decide(s, other.id, { decision: 'approve' })).status).toBe(409);
    expect((await s.detail(ticket.id)).planOptions?.map((o) => o.status)).toEqual([
      'proposed',
      'proposed',
    ]);
  });

  it('keeps the plan options across a restart (stored, and back in the run state)', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, runId } = await inPlanReview(s);
    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    const detail = await again.detail(ticket.id);
    expect(detail.planOptions?.map((o) => [o.label, o.summary])).toEqual([
      ['Planner', 'Plan A: a toggle'],
      ['Codex planner', 'Plan B: a menu'],
    ]);
    const state = again.control.peek(runId);
    expect(state?.planOptions?.map((o) => [o.nodeId, o.status])).toEqual(
      detail.planOptions?.map((o) => [o.nodeId, o.status]),
    );
  });

  it('request changes supersedes both options and asks each planner again', async () => {
    const s = await setupBoard({ files: FILES });
    const { ticket, p1, p2 } = await inPlanReview(s);
    const res = await decide(s, ticket.id, {
      decision: 'request-changes',
      comment: 'Both need tests.',
    });
    expect(res.status).toBe(200);
    await s.settle();
    const after = await s.detail(ticket.id);
    expect(after.currentRun?.status).toBe('PLANNING');
    expect(after.planOptions?.map((o) => o.status)).toEqual(['superseded', 'superseded']);
    for (const p of [p1, p2]) expect(p.sent.some((m) => m.includes('Both need tests.'))).toBe(true);
    // A planner's revised plan is a new option.
    await p1.callLead('submit_plan', { summary: 'Plan A2', steps: stepsOf('Toggle and tests') });
    await s.settle();
    expect((await s.detail(ticket.id)).planOptions?.map((o) => [o.optionIndex, o.status])).toEqual([
      [1, 'superseded'],
      [2, 'superseded'],
      [3, 'proposed'],
    ]);
  });
});

describe('a single plan is decided as before (AR-4)', () => {
  it('refuses a plan option id on the plan route', async () => {
    const s = await setupBoard({ files: FILES });
    const ticket = await s.createTicket('One plan');
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    await s.post(`/api/tickets/${ticket.id}/start`);
    await s.settle();
    const lead = latest(s, 'lead');
    lead.started();
    await s.settle();
    await lead.callLead('submit_plan', { summary: 'One plan', steps: stepsOf('Do it') });
    await s.settle();
    const detail = await s.detail(ticket.id);
    expect(detail.planOptions).toEqual([]);
    const plan = detail.plans[0];
    const res = await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
      planOptionId: 'x',
    });
    expect(res.status).toBe(400);
    expect((await decide(s, ticket.id, { decision: 'approve' })).status).toBe(409);
    const ok = await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    expect(ok.status).toBe(200);
  });
});
