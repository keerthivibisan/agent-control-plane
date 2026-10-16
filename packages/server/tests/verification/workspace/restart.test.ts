import { afterEach, describe, expect, it } from 'vitest';
import {
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  TicketDetailDtoSchema,
} from '@acp/core/api';
import { tempDir } from '../../workspace/helpers.js';
import {
  boardOf,
  bootWorkspace,
  columnOf,
  createProject,
  createTicket,
  expectError,
  expectStatus,
  setupBody,
  startTicket,
  submitPlan,
  ticketDetail,
  waitFor,
  type WorkspaceServer,
} from './harness.js';

/*
 * P4-H: stop and start the server mid-run (README §6.2, ADR-0013 §7, P4-D handoff). One ticket's
 * run is planning, another's plan waits for review. After the restart both runs are NEEDS_REVIEW
 * (stage In review), nothing is relaunched, the plan is still there but can no longer be decided,
 * the board and both tickets load, and the owner can cancel and re-run.
 */

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

describe('P4-H restart mid-run', () => {
  it('planning and plan-review runs become NEEDS_REVIEW; nothing relaunches; board and tickets load; cancel and re-run work', async () => {
    const dataDir = tempDir('acp-p4h-data-');
    const claudeDir = tempDir('acp-p4h-claude-');
    const first = await bootWorkspace({ dataDir, claudeDir });
    open.push(first);
    const project = await createProject(first, 'shop');
    expectStatus(await first.put(`/api/projects/${project.id}/setup`, setupBody('SHOP')), 200);
    const planning = await createTicket(first, project.id, { title: 'Still planning' });
    const reviewing = await createTicket(first, project.id, { title: 'Plan waiting' });
    const a = await startTicket(first, planning.id);
    const b = await startTicket(first, reviewing.id);
    const proposed = await submitPlan(first, reviewing.id, b.lead, 'A plan to keep');
    const planId = proposed.plans[0]?.id ?? '';
    const before = await boardOf(first, project.id);
    expect(columnOf(before, planning.id)).toBe('PLANNING');
    expect(columnOf(before, reviewing.id)).toBe('PLAN_REVIEW');
    await first.close();
    // Both leads were stopped by the shutdown, without recording an outcome.
    expect(first.fake.agents.every((agent) => agent.ended)).toBe(true);

    const second = await bootWorkspace({ dataDir, claudeDir });
    open.push(second);
    for (const [ticketId, runId] of [
      [planning.id, a.runId],
      [reviewing.id, b.runId],
    ] as const) {
      const d = await ticketDetail(second, ticketId);
      expect(d.currentRun?.id).toBe(runId);
      expect(d.currentRun?.status).toBe('NEEDS_REVIEW');
      expect(d.currentRun?.agents.map((x) => [x.kind, x.status])).toEqual([
        ['lead', 'NEEDS_REVIEW'],
      ]);
      expect(d.ticket).toMatchObject({ status: 'ACTIVE', stage: 'IN_REVIEW' });
    }
    const kept = await ticketDetail(second, reviewing.id);
    expect(kept.plans).toMatchObject([
      { id: planId, version: 1, status: 'proposed', summary: 'A plan to keep' },
    ]);
    expectError(
      await second.post(`/api/tickets/${reviewing.id}/plans/${planId}/decision`, {
        decision: 'approve',
      }),
      409,
      'plan_not_pending',
    );
    // ADR-0020: the owner's message brings the ended lead back for one answers-only turn (an
    // owner action, never a relaunch); the run stays NEEDS_REVIEW.
    const chat = expectStatus(
      await second.post(`/api/runs/${a.runId}/chat`, { text: 'are you there?' }),
      200,
    );
    expect(chat).toMatchObject({ followUp: true });
    const followUp = await waitFor(() => second.fake.agents[0], 'the follow-up turn');
    expect(followUp.spec.followUp).toBeDefined();
    followUp.finish();
    expect((await ticketDetail(second, planning.id)).currentRun?.status).toBe('NEEDS_REVIEW');

    // The board, the setup and the harness still load.
    const board = await boardOf(second, project.id);
    expect(columnOf(board, planning.id)).toBe('IN_REVIEW');
    expect(columnOf(board, reviewing.id)).toBe('IN_REVIEW');
    expect(board.stats.runningRuns).toBe(0);
    expect(
      ProjectAgentSetupDtoSchema.parse(
        expectStatus(await second.get(`/api/projects/${project.id}/setup`), 200),
      ).projectKey,
    ).toBe('SHOP');
    expect(
      HarnessStatusDtoSchema.parse(
        expectStatus(await second.get(`/api/projects/${project.id}/harness`), 200),
      ).state,
    ).toBe('none');
    // Nothing was relaunched by the new process (only the owner's follow-up turn ran).
    expect(second.fake.agents.filter((x) => x.spec.followUp === undefined)).toEqual([]);

    // The owner cancels the interrupted ticket and starts it again: only then does a lead start.
    expectStatus(
      await second.post(`/api/tickets/${planning.id}/move`, { status: 'CANCELLED' }),
      200,
    );
    expect((await ticketDetail(second, planning.id)).ticket.stage).toBe('CANCELLED');
    const rerun = TicketDetailDtoSchema.parse(
      expectStatus(await second.post(`/api/tickets/${planning.id}/start`), 200),
    );
    expect(rerun.runs).toHaveLength(2);
    expect(rerun.currentRun?.status).toBe('PLANNING');
    expect(rerun.ticket.stage).toBe('PLANNING');
    const fresh = () => second.fake.agents.filter((x) => x.spec.followUp === undefined);
    await waitFor(() => (fresh().length > 0 ? true : undefined), 'the new lead');
    expect(fresh().map((x) => x.spec.kind)).toEqual(['lead']);
  }, 60_000);
});
