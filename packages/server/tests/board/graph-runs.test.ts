import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultProjectWorkflow,
  migrateWorkflowV1,
  workflowTemplate,
  type WorkflowGraph,
} from '@acp/core';
import { RunWorkflowGraphDtoSchema, TicketDetailDtoSchema } from '@acp/core/api';
import { createRedesignRepositories } from '@acp/db';
import { FULL_AUTO_DENIED_MESSAGE } from '../../src/control/full-auto.js';
import { expectError } from '../control/helpers.js';
import { setupBoard } from './helpers.js';
import { FILES, run, type Board } from './loop-helpers.js';
import {
  LEAD,
  POOL,
  pendingApprovals,
  poolMode,
  projectMode,
  putGraph,
  withHelper,
} from './graph-helpers.js';

/*
 * Ticket runs on workflow graphs through the routes (ADR-0023, WG-C): the run start validates,
 * tightens and snapshots; each agent gets its own node's mode at the gate and at launch; the
 * snapshot survives a restart. The fake managed adapter plays every agent; git runs in a
 * throwaway repository. Synthetic data only.
 */

/** Ready, Start with `body`, the lead started: the run id and its lead. */
async function started(s: Board, body: object = {}, title = 'Add dark mode') {
  const ticket = await s.createTicket(title);
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const res = await s.post(`/api/tickets/${ticket.id}/start`, body);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  await s.settle();
  const lead = s.fake.agents.filter((a) => a.spec.kind === 'lead').at(-1);
  if (lead === undefined) throw new Error('no lead');
  lead.started();
  await s.settle();
  const runId = TicketDetailDtoSchema.parse(res.body).currentRun?.id ?? '';
  return { ticket, runId, lead };
}

/** The lead's plan, approved by the owner unless the gate approved it. */
async function approvePlan(s: Board, x: Awaited<ReturnType<typeof started>>, steps?: object[]) {
  await x.lead.callLead('submit_plan', {
    summary: 'Add a theme toggle',
    steps: steps ?? [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
  });
  await s.settle();
  const detail = await s.detail(x.ticket.id);
  const plan = detail.plans.at(-1);
  if (plan?.status === 'proposed') {
    const res = await s.post(`/api/tickets/${x.ticket.id}/plans/${plan.id}/decision`, {
      decision: 'approve',
    });
    expect(res.status).toBe(200);
    await s.settle();
  }
}

/** The lead starts a helper (optionally naming its node); it starts. */
async function helper(s: Board, x: Awaited<ReturnType<typeof started>>, input: object) {
  const reply = await x.lead.callLead('start_agent', { task: 'Do it', ...input });
  expect(reply).toContain('Started agent');
  await s.settle();
  const worker = s.fake.workers().at(-1);
  if (worker === undefined) throw new Error('no worker');
  worker.started();
  await s.settle();
  return worker;
}

const audit = (s: Board) => createRedesignRepositories(s.db).runAudit;

describe('starting a ticket on a workflow graph (ADR-0023)', () => {
  it('snapshots the graph and its context; the ticket and run modes are ceilings', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'full-auto');
    const graph = withHelper(poolMode(workflowTemplate('lead-only'), null), {
      id: 'frontend',
      label: 'Frontend helper',
      mode: 'auto',
    });
    await putGraph(s, graph);
    const ticket = await s.createTicket('Careful', { runOptions: { approvalMode: 'auto' } });
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    const res = await s.post(`/api/tickets/${ticket.id}/start`, {
      approvalMode: 'auto-edits',
      maxReworkRounds: 1,
    });
    expect(res.status).toBe(200);
    const runId = TicketDetailDtoSchema.parse(res.body).currentRun?.id ?? '';
    const snapshot = audit(s).getRunSnapshot(runId);
    expect(snapshot?.graph).toEqual(graph);
    expect(snapshot?.graphContext).toEqual({
      projectMode: 'full-auto',
      approvalCeilings: ['auto', 'auto-edits'],
      maxReworkRounds: 1,
      maxConcurrentHelpers: 3,
    });
    // The run's own mode is the project's, tightened by both.
    expect((await run(s, runId)).approvalMode).toBe('auto-edits');
    const nodes = RunWorkflowGraphDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/workflow-graph`)).body,
    ).nodes;
    expect(nodes.find((n) => n.nodeId === POOL)).toMatchObject({
      approvalMode: 'auto-edits',
      sandbox: true,
    });
    expect(nodes.find((n) => n.nodeId === 'frontend')).toMatchObject({
      approvalMode: 'auto-edits',
      sandbox: false,
    });
  });

  it('refuses with 409 workflow_invalid when the stored graph cannot run; no run is created', async () => {
    const s = await setupBoard({ files: FILES });
    const g = workflowTemplate('lead-only');
    const broken: WorkflowGraph = { ...g, edges: g.edges.filter((e) => e.type !== 'merge') };
    // Stored directly: the PUT would have refused it.
    createRedesignRepositories(s.db).workflow.putGraph(s.project.id, broken);
    const ticket = await s.createTicket('T');
    await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' });
    const res = await s.post(`/api/tickets/${ticket.id}/start`);
    expectError(res, 409, 'workflow_invalid');
    const detail = await s.detail(ticket.id);
    expect(detail.ticket.status).toBe('READY');
    expect(detail.currentRun).toBeNull();
    expect(detail.runs).toEqual([]);
    expect(s.fake.agents).toEqual([]);
  });

  it('a version 1 project runs its workflow migrated, with the version 1 snapshot kept', async () => {
    const s = await setupBoard({ files: FILES });
    const { runId } = await started(s);
    const snapshot = audit(s).getRunSnapshot(runId);
    const v1 = defaultProjectWorkflow(s.project.id, s.project.createdAt);
    expect(snapshot?.workflow).toEqual(v1);
    expect(snapshot?.graph).toEqual(migrateWorkflowV1(v1, { projectMode: 'auto-edits' }));
    expect(snapshot?.graphContext).toEqual({
      projectMode: 'auto-edits',
      approvalCeilings: [],
      maxConcurrentHelpers: 3,
    });
    const dto = RunWorkflowGraphDtoSchema.parse(
      (await s.get(`/api/runs/${runId}/workflow-graph`)).body,
    );
    expect(dto.graph).toEqual(snapshot?.graph);
    expect(dto.nodes.map((n) => n.nodeId)).toEqual(dto.graph.nodes.map((n) => n.id));
    expect(dto.nodes.find((n) => n.nodeId === 'ticket')?.state).toBe('done');
    expect(dto.nodes.find((n) => n.nodeId === LEAD)?.agentRunIds).toHaveLength(1);
  });

  it('GET /api/runs/:id/workflow-graph is 404 for an unknown run', async () => {
    const s = await setupBoard({ files: FILES });
    expectError(await s.get('/api/runs/nope/workflow-graph'), 404, 'not_found');
  });

  it('keeps the graph and its context across a restart, so the same program compiles', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'auto');
    const graph = withHelper(workflowTemplate('reviewer-helper-loop'), {
      id: 'frontend',
      label: 'Frontend helper',
      mode: 'manual',
    });
    await putGraph(s, graph);
    const x = await started(s, { approvalMode: 'auto-edits' });
    const before = RunWorkflowGraphDtoSchema.parse(
      (await s.get(`/api/runs/${x.runId}/workflow-graph`)).body,
    );
    await s.control.close();
    const again = await setupBoard({
      reopen: { dbPath: s.dbPath, repo: s.repo, dataDir: s.dataDir },
    });
    const after = RunWorkflowGraphDtoSchema.parse(
      (await again.get(`/api/runs/${x.runId}/workflow-graph`)).body,
    );
    expect(after.graph).toEqual(graph);
    expect(after.nodes.map((n) => [n.nodeId, n.approvalMode, n.sandbox])).toEqual(
      before.nodes.map((n) => [n.nodeId, n.approvalMode, n.sandbox]),
    );
    expect(audit(again).getRunSnapshot(x.runId)?.graphContext?.approvalCeilings).toEqual([
      'auto-edits',
    ]);
  });
});

describe('approvals per agent (ADR-0023 §5)', () => {
  it('a Manual named helper asks the owner while the Full auto pool is never parked', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'auto-edits');
    await putGraph(
      s,
      withHelper(poolMode(workflowTemplate('lead-only'), 'full-auto'), {
        id: 'frontend',
        label: 'Frontend helper',
        mode: 'manual',
      }),
    );
    const x = await started(s);
    // The gate asks (it is not auto, and the pool's Full auto does not make the plan auto).
    await approvePlan(s, x);
    const pool = await helper(s, x, { role: 'Builder' });
    const front = await helper(s, x, { role: 'Page', helper: 'frontend' });
    expect(pool.spec.fullAuto).toBeDefined();
    expect(front.spec.fullAuto).toBeUndefined();
    expect(x.lead.spec.fullAuto).toBeUndefined();

    // The pool: an escalation is denied at once; an edit in its own worktree runs (Auto edits rule).
    expect(await pool.ask('Bash', 'Bash curl', { command: 'curl https://example.test' })).toEqual({
      allow: false,
      message: FULL_AUTO_DENIED_MESSAGE,
    });
    const poolEdit = { file_path: `${s.worktree(x.runId, pool.id)}/a.ts` };
    expect(await pool.ask('Edit', 'Edit a.ts', poolEdit)).toEqual({ allow: true });

    // The Manual helper: even an edit in its own worktree waits for the owner.
    const frontEdit = { file_path: `${s.worktree(x.runId, front.id)}/b.ts` };
    const asked = front.ask('Edit', 'Edit b.ts', frontEdit);
    const pending = await pendingApprovals(s, x.runId);
    expect(pending.map((a) => a.agentRunId)).toEqual([front.id]);
    const res = await s.post(`/api/approvals/${pending[0]?.id ?? ''}`, { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(await asked).toEqual({ allow: true });
  });

  it('a helper whose node is Auto edits in a Manual-ceiling run asks for its edits', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'auto-edits');
    await putGraph(s, workflowTemplate('lead-only'));
    const x = await started(s, { approvalMode: 'manual' });
    await approvePlan(s, x);
    const pool = await helper(s, x, { role: 'Builder' });
    const asked = pool.ask('Edit', 'Edit a.ts', {
      file_path: `${s.worktree(x.runId, pool.id)}/a.ts`,
    });
    expect((await pendingApprovals(s, x.runId)).map((a) => a.agentRunId)).toEqual([pool.id]);
    await s.post(`/api/runs/${x.runId}/stop`);
    await s.settle();
    expect((await asked).allow).toBe(false);
  });

  it('the lead and a change reviewer never get Full auto and are never covered by a mode', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'full-auto');
    await putGraph(s, workflowTemplate('todays-setup'));
    const x = await started(s);
    expect(x.lead.spec.fullAuto).toBeUndefined();
    expect(x.lead.spec.sandbox).toBeUndefined();
    expect(await x.lead.ask('Edit', 'Edit x.ts', { file_path: `${s.repo}/x.ts` })).toMatchObject({
      allow: false,
    });
    expect((await run(s, x.runId)).approvals).toEqual([]);
  });

  it('a Full auto block tightened by the ticket keeps the OS sandbox in default mode; the gate asks by the tightened mode', async () => {
    const s = await setupBoard({ files: FILES });
    await projectMode(s, 'full-auto');
    await putGraph(
      s,
      withHelper(workflowTemplate('lead-only'), {
        id: 'frontend',
        label: 'Frontend helper',
        mode: 'manual',
      }),
    );
    const x = await started(s, { approvalMode: 'auto-edits' });
    await approvePlan(s, x);
    // The pool's configured mode is the project's Full auto; the ticket tightened it to Auto edits.
    const pool = await helper(s, x, { role: 'Builder' });
    expect(pool.spec.fullAuto).toBeUndefined();
    expect(pool.spec.sandbox?.tempDir).toBe(realpathSync(join(s.dataDir, 'sandbox-tmp', x.runId)));
    expect(pool.spec.sandbox?.denyRead).toContain(join(s.homeDir, '.ssh'));
    // Auto edits rules: its own edit runs; a command outside them waits for the owner (never the
    // Full auto "deny without asking").
    const edit = { file_path: `${s.worktree(x.runId, pool.id)}/a.ts` };
    expect(await pool.ask('Edit', 'Edit a.ts', edit)).toEqual({ allow: true });
    const curl = pool.ask('Bash', 'Bash curl', { command: 'curl https://example.test' });
    const pending = await pendingApprovals(s, x.runId);
    expect(pending.map((a) => a.agentRunId)).toEqual([pool.id]);
    await s.post(`/api/approvals/${pending[0]?.id ?? ''}`, { decision: 'deny' });
    expect((await curl).allow).toBe(false);
    // A block that was never Full auto starts as usual, with neither.
    const front = await helper(s, x, { role: 'Page', helper: 'frontend' });
    expect(front.spec.fullAuto).toBeUndefined();
    expect(front.spec.sandbox).toBeUndefined();
    // The lead never gets either.
    expect(x.lead.spec.fullAuto).toBeUndefined();
    expect(x.lead.spec.sandbox).toBeUndefined();
  });
});
