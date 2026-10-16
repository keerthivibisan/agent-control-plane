import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BoardDtoSchema,
  CheckRunDtoSchema,
  ReviewDtoSchema,
  TicketDetailDtoSchema,
} from '@acp/core/api';
import { createRunStore } from '../../src/control/store.js';
import { PARENT_HELPER_NOTE } from '../../src/control/service.js';
import { expectError } from '../control/helpers.js';
import { BOARD_NOW, PASSING_WHEN_FIXED, setupBoard } from './helpers.js';

/*
 * A ticket worked end to end through the routes (README §4.2, ADR-0016/0017): start → plan →
 * request changes → plan v2 → approve → helper → review with checks → merge (or merge anyway with
 * a reason) → Done. The fake managed adapter plays the agents; checks are tiny node scripts.
 */

const SETUP = {
  projectKey: 'WEB',
  maxConcurrentHelpers: 3,
  maxDepth: 1,
  defaultBudgetTokensPerAgent: 100_000,
  model: null,
  allowlist: { editInOwnWorktree: false, runHarnessChecks: false },
  contextFiles: [],
};

describe('start and plan decisions', () => {
  it('start creates a PLANNING run whose lead gets the brief; plans are versioned and stored', async () => {
    const s = await setupBoard();
    const { ticket, detail: started } = await s.startTicket('Add dark mode');
    const parsed = TicketDetailDtoSchema.parse(started);
    expect(parsed.ticket).toMatchObject({ status: 'ACTIVE', stage: 'PLANNING' });
    expect(parsed.currentRun).toMatchObject({
      status: 'PLANNING',
      title: 'WEBAPP-1 Add dark mode',
    });
    expect(parsed.runs).toHaveLength(1);
    const lead = s.fake.lead();
    expect(lead.spec.prompt).toContain('Ticket WEBAPP-1 (feature, medium priority): Add dark mode');
    expect(lead.spec.prompt).toContain('submit_plan');
    expectError(await s.post(`/api/tickets/${ticket.id}/start`), 409, 'run_in_progress');

    // Plan first: helpers are refused until a plan is approved.
    await expect(lead.callLead('start_agent', { role: 'Builder', task: 'x' })).rejects.toThrow();

    s.notices.length = 0;
    await s.submitPlan('First idea');
    let d = await s.detail(ticket.id);
    expect(d.ticket.stage).toBe('PLAN_REVIEW');
    // SSE: the board and the ticket page hear about the new plan.
    expect(
      s.notices.some(
        (n) =>
          n.kind === 'tickets-changed' &&
          n.ticketIds?.includes(ticket.id) === true &&
          n.runIds?.includes(d.currentRun?.id ?? '') === true &&
          n.projectIds.includes(s.project.id),
      ),
    ).toBe(true);
    expect(d.plans).toMatchObject([{ version: 1, status: 'proposed', summary: 'First idea' }]);
    const board = BoardDtoSchema.parse((await s.get(`/api/board?projectId=${s.project.id}`)).body);
    const card = board.columns.find((c) => c.stage === 'PLAN_REVIEW')?.tickets[0];
    expect(card).toMatchObject({ needsYou: 1, budgetTokensUsed: 0, activeHelpers: 0 });
    expect(board.stats).toMatchObject({ runningRuns: 1, needsYou: 1 });

    const planId = d.plans[0]?.id ?? '';
    expectError(
      await s.post(`/api/tickets/${ticket.id}/plans/${planId}/decision`, {
        decision: 'request-changes',
      }),
      400,
      'invalid_request',
    );
    const changes = await s.post(`/api/tickets/${ticket.id}/plans/${planId}/decision`, {
      decision: 'request-changes',
      comment: 'Also cover the settings page.',
    });
    expect(changes.status).toBe(200);
    d = TicketDetailDtoSchema.parse(changes.body);
    expect(d.ticket.stage).toBe('PLANNING');
    expect(d.plans[0]?.status).toBe('changes-requested');
    expect(d.comments).toMatchObject([
      { author: 'owner', planId, body: 'Also cover the settings page.' },
    ]);
    await s.settle();
    expect(lead.sent.at(-1)).toContain('Also cover the settings page.');
    expectError(
      await s.post(`/api/tickets/${ticket.id}/plans/${planId}/decision`, { decision: 'approve' }),
      409,
      'plan_not_pending',
    );

    await s.submitPlan('Second idea');
    d = await s.detail(ticket.id);
    const v2 = d.plans[1];
    expect(v2).toMatchObject({ version: 2, status: 'proposed' });
    const approved = await s.post(`/api/tickets/${ticket.id}/plans/${v2?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    d = TicketDetailDtoSchema.parse(approved.body);
    expect(d.ticket.stage).toBe('WORKING');
    expect(d.currentRun?.status).toBe('RUNNING');
    expect(d.plans.map((p) => p.status)).toEqual(['changes-requested', 'approved']);
    expectError(
      await s.post(`/api/tickets/${ticket.id}/plans/other/decision`, { decision: 'approve' }),
      404,
      'plan_not_found',
    );

    // Plans come back from the database with the run (restart path).
    const store = createRunStore({ db: s.db, now: () => BOARD_NOW });
    const loaded = store.load(d.currentRun?.id ?? '');
    expect(loaded?.plans?.map((p) => [p.version, p.status])).toEqual([
      [1, 'changes-requested'],
      [2, 'approved'],
    ]);
    expect(loaded?.run.ticketId).toBe(ticket.id);
  });
});

/** Start a ticket and get it to a helper that has finished, with the run in review. */
async function toReview(s: Awaited<ReturnType<typeof setupBoard>>, fix: boolean) {
  const { ticket } = await s.startTicket();
  await s.submitPlan();
  const plan = (await s.detail(ticket.id)).plans[0];
  await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
    decision: 'approve',
  });
  const lead = s.fake.lead();
  await lead.callLead('start_agent', { role: 'Builder', task: 'Build the toggle' });
  await s.settle();
  const worker = s.fake.workers()[0];
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
  const wt = s.worktree(runId, worker.id);
  writeFileSync(join(wt, 'src', 'theme.ts'), 'export const dark = true;\n');
  if (fix) writeFileSync(join(wt, 'fixed.txt'), 'ok\n');
  worker.finish('success');
  await s.settle();
  await lead.callLead('request_review', {});
  await s.settle();
  return { ticket, runId, worker, lead };
}

describe('review, checks and merge (ADR-0017 §3–§4)', () => {
  it('runs the checks when the run enters review; a passing required check allows merge → Done', async () => {
    const s = await setupBoard({
      files: { 'README.md': 'x\n', 'src/app.ts': '', ...PASSING_WHEN_FIXED },
    });
    const { ticket, runId, worker } = await toReview(s, true);
    let d = await s.detail(ticket.id);
    expect(d.ticket.stage).toBe('IN_REVIEW');
    expect(d.checks).toMatchObject([
      { runId, agentRunId: worker.id, checkId: 'test', status: 'passed', exitCode: 0 },
    ]);
    const listed = CheckRunDtoSchema.array().parse((await s.get(`/api/runs/${runId}/checks`)).body);
    expect(listed).toHaveLength(1);

    const merged = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'merge',
    });
    expect(merged.status).toBe(200);
    expect(ReviewDtoSchema.parse(merged.body).agents[0]?.state).toBe('merged');
    expect(readFileSync(join(s.repo, 'src', 'theme.ts'), 'utf8')).toBe(
      'export const dark = true;\n',
    );
    d = await s.detail(ticket.id);
    expect(d.currentRun?.status).toBe('COMPLETED');
    expect(d.ticket).toMatchObject({ status: 'DONE', stage: 'DONE' });
    expectError(
      await s.post(`/api/tickets/${ticket.id}/move`, { status: 'CANCELLED' }),
      409,
      'ticket_done',
    );

    // Re-run: a new run on the same ticket; the old one stays in its history.
    const rerun = await s.post(`/api/tickets/${ticket.id}/start`);
    expect(rerun.status).toBe(200);
    const again = TicketDetailDtoSchema.parse(rerun.body);
    expect(again.runs).toHaveLength(2);
    expect(again.currentRun?.status).toBe('PLANNING');
    expect(again.checks).toEqual([]);
  }, 60_000);

  it('a failed required check blocks merge; merge anyway needs a reason and is recorded', async () => {
    const s = await setupBoard({
      files: { 'README.md': 'x\n', 'src/app.ts': '', ...PASSING_WHEN_FIXED },
    });
    const { ticket, runId, worker } = await toReview(s, false);
    const d = await s.detail(ticket.id);
    expect(d.checks.map((c) => c.status)).toEqual(['failed']);

    expectError(
      await s.post(`/api/runs/${runId}/review`, { agentRunId: worker.id, action: 'merge' }),
      409,
      'checks_failed',
    );
    expectError(
      await s.post(`/api/runs/${runId}/review`, { agentRunId: worker.id, action: 'merge-anyway' }),
      400,
      'invalid_request',
    );

    // Fixing it in the worktree and running the checks again on demand turns it green.
    writeFileSync(join(s.worktree(runId, worker.id), 'fixed.txt'), 'ok\n');
    const rerun = await s.post(`/api/runs/${runId}/agents/${worker.id}/checks`, {});
    expect(rerun.status).toBe(200);
    expect(
      CheckRunDtoSchema.array()
        .parse(rerun.body)
        .map((c) => c.status),
    ).toEqual(['passed']);
    expectError(
      await s.post(`/api/runs/${runId}/review`, {
        agentRunId: worker.id,
        action: 'merge-anyway',
        reason: 'x',
      }),
      409,
      'merge_anyway_unavailable',
    );
  }, 60_000);

  it('merge anyway with a reason merges and keeps the reason on the ticket', async () => {
    const s = await setupBoard({
      files: { 'README.md': 'x\n', 'src/app.ts': '', ...PASSING_WHEN_FIXED },
    });
    const { ticket, runId, worker } = await toReview(s, false);
    const res = await s.post(`/api/runs/${runId}/review`, {
      agentRunId: worker.id,
      action: 'merge-anyway',
      reason: 'The test is flaky; tracked in WEB-9.',
    });
    expect(res.status).toBe(200);
    const d = await s.detail(ticket.id);
    expect(d.ticket.stage).toBe('DONE');
    expect(d.comments.at(-1)).toMatchObject({ author: 'owner', runId });
    expect(d.comments.at(-1)?.body).toContain('Unit tests');
    expect(d.comments.at(-1)?.body).toContain('The test is flaky; tracked in WEB-9.');
  }, 60_000);

  it('refuses on-demand checks for a live agent, the lead, and an unknown agent', async () => {
    const s = await setupBoard({
      files: { 'README.md': 'x\n', 'src/app.ts': '', ...PASSING_WHEN_FIXED },
    });
    const { ticket } = await s.startTicket();
    await s.submitPlan();
    const plan = (await s.detail(ticket.id)).plans[0];
    await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    await s.fake.lead().callLead('start_agent', { role: 'Builder', task: 'Build' });
    await s.settle();
    const runId = (await s.detail(ticket.id)).currentRun?.id ?? '';
    const worker = s.fake.workers()[0];
    expectError(
      await s.post(`/api/runs/${runId}/agents/${worker?.id ?? ''}/checks`, {}),
      409,
      'agent_working',
    );
    expectError(
      await s.post(`/api/runs/${runId}/agents/${s.fake.lead().id}/checks`, {}),
      409,
      'not_a_helper',
    );
    expectError(await s.post(`/api/runs/${runId}/agents/nope/checks`, {}), 404, 'not_found');
    expectError(await s.get('/api/runs/nope/checks'), 404, 'not_found');
  }, 60_000);
});

describe('cancel, context and depth 2', () => {
  it('cancelling a ticket stops its run; a cancelled ticket can be re-run', async () => {
    const s = await setupBoard();
    const { ticket } = await s.startTicket();
    const res = await s.post(`/api/tickets/${ticket.id}/move`, { status: 'CANCELLED' });
    expect(res.status).toBe(200);
    await s.settle();
    expect(s.fake.lead().aborted).toBe(true);
    let d = await s.detail(ticket.id);
    expect(d.ticket).toMatchObject({ status: 'CANCELLED', stage: 'CANCELLED' });
    expect(['CANCELLING', 'CANCELLED']).toContain(d.currentRun?.status);
    const rerun = await s.post(`/api/tickets/${ticket.id}/start`);
    expect(rerun.status).toBe(200);
    d = TicketDetailDtoSchema.parse(rerun.body);
    expect(d.ticket.status).toBe('ACTIVE');
    expect(d.runs).toHaveLength(2);
  });

  it('a failed run puts the card back in Ready with a note; it can start again', async () => {
    const s = await setupBoard();
    const { ticket } = await s.startTicket();
    s.fake.lead().finish('error');
    await s.settle();
    const board = BoardDtoSchema.parse((await s.get(`/api/board?projectId=${s.project.id}`)).body);
    const card = board.columns.find((c) => c.stage === 'READY')?.tickets[0];
    expect(card).toMatchObject({ id: ticket.id, status: 'ACTIVE', lastRunOutcome: 'failed' });
    // The run has ended, so the owner may move the ticket again.
    const moved = await s.post(`/api/tickets/${ticket.id}/move`, { status: 'BACKLOG' });
    expect(moved.body).toMatchObject({ status: 'BACKLOG', stage: 'BACKLOG' });
    expectError(await s.post(`/api/tickets/${ticket.id}/start`), 409, 'ticket_not_ready');
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    expect((await s.post(`/api/tickets/${ticket.id}/start`)).status).toBe(200);
  });

  it('agents get the chosen context files and model', async () => {
    const s = await setupBoard({
      files: { 'README.md': 'Project facts here.\n', 'src/app.ts': '' },
    });
    await s.send('put', `/api/projects/${s.project.id}/setup`, {
      ...SETUP,
      model: 'claude-test-model',
      contextFiles: ['README.md'],
    });
    await s.startTicket();
    const lead = s.fake.lead();
    expect(lead.spec.context).toContain('=== README.md ===');
    expect(lead.spec.context).toContain('Project facts here.');
    expect(lead.spec.model).toBe('claude-test-model');
  });

  it('depth 2: a helper gets the child tools and is told when its own helper ends', async () => {
    const s = await setupBoard();
    await s.send('put', `/api/projects/${s.project.id}/setup`, { ...SETUP, maxDepth: 2 });
    const { ticket } = await s.startTicket();
    await s.submitPlan();
    const plan = (await s.detail(ticket.id)).plans[0];
    await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    await s.fake.lead().callLead('start_agent', { role: 'Parent', task: 'Split the work' });
    await s.settle();
    const parent = s.fake.workers()[0];
    if (parent === undefined) throw new Error('no parent');
    expect(parent.spec.canStartHelpers).toBe(true);
    expect(parent.spec.leadTools).toBeDefined();
    expect(parent.spec.prompt).toBe(`Split the work\n\n${PARENT_HELPER_NOTE}`);
    parent.started();
    await parent.callLead('start_agent', { role: 'Child', task: 'Do one part' });
    await s.settle();
    const child = s.fake.workers()[1];
    if (child === undefined) throw new Error('no child');
    expect(child.spec.canStartHelpers).toBeUndefined();
    expect(child.spec.leadTools).toBeUndefined();
    expect(child.spec.prompt).toBe('Do one part');
    child.started();
    child.finish('success');
    await s.settle();
    expect(parent.sent.at(-1)).toContain(`Your helper "Child" (${child.id}) finished.`);
  });

  it('depth 1: helpers get no child tools', async () => {
    const s = await setupBoard();
    const { ticket } = await s.startTicket();
    await s.submitPlan();
    const plan = (await s.detail(ticket.id)).plans[0];
    await s.post(`/api/tickets/${ticket.id}/plans/${plan?.id ?? ''}/decision`, {
      decision: 'approve',
    });
    await s.fake.lead().callLead('start_agent', { role: 'Builder', task: 'Build' });
    await s.settle();
    const worker = s.fake.workers()[0];
    expect(worker?.spec.canStartHelpers).toBeUndefined();
    expect(worker?.spec.leadTools).toBeUndefined();
  });
});
