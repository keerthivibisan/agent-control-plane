import { afterEach, describe, expect, it } from 'vitest';
import { defaultProjectWorkflow } from '@acp/core';
import {
  approveLatestPlan,
  bootWorkspace,
  createProject,
  createTicket,
  expectStatus,
  startTicket,
  submitPlan,
  waitFor,
  type WorkspaceServer,
} from '../workspace/harness.js';

/*
 * RL-B regression (coordinator review, e2e `workspace.spec`): a lead starts helpers the moment it
 * learns that the plan was approved. The ticket branch is created at approval, so the server must
 * not tell the lead (lead mode: the approval message; separate-planner mode: the lead's start)
 * before the branch exists, or `start_agent` is refused with `ticket-branch-pending`. Real server
 * composition, fake managed adapter, real git.
 */

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

describe('RL-B: the lead hears of the approval only once the ticket branch exists', () => {
  it('lead mode: start_agent right after the approval message succeeds', async () => {
    const b = await bootWorkspace({ reviewLoop: true });
    open.push(b);
    const project = await createProject(b, 'race');
    const ticket = await createTicket(b, project.id, { title: 'Start helpers at once' });
    const { lead } = await startTicket(b, ticket.id);
    await submitPlan(b, ticket.id, lead, 'One helper');
    await approveLatestPlan(b, ticket.id);
    // What a real lead does: act on the approval message without waiting for anything else.
    await waitFor(
      () => (lead.sent.some((m) => m.includes('approved plan')) ? true : undefined),
      'the approval message',
    );
    expect(await lead.callLead('start_agent', { role: 'Builder', task: 'Build it' })).toContain(
      'Started agent',
    );
  }, 60_000);

  it('separate-planner mode: the lead starts after the branch; its first start_agent succeeds', async () => {
    const b = await bootWorkspace({ reviewLoop: true });
    open.push(b);
    const project = await createProject(b, 'racesep');
    const stages = defaultProjectWorkflow('x', '2026-10-17T09:00:00.000Z').stages;
    expectStatus(
      await b.put(`/api/projects/${project.id}/workflow`, { plannerMode: 'separate', stages }),
      200,
    );
    const ticket = await createTicket(b, project.id, { title: 'Start helpers at once' });
    expectStatus(await b.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' }), 200);
    expectStatus(await b.post(`/api/tickets/${ticket.id}/start`), 200);
    const planner = await waitFor(
      () => b.fake.agents.find((a) => a.spec.kind === 'planner'),
      'the planner',
    );
    planner.started();
    await submitPlan(b, ticket.id, planner, 'One helper');
    await approveLatestPlan(b, ticket.id);
    const lead = await waitFor(() => b.fake.agents.find((a) => a.spec.kind === 'lead'), 'the lead');
    lead.started();
    expect(await lead.callLead('start_agent', { role: 'Builder', task: 'Build it' })).toContain(
      'Started agent',
    );
  }, 60_000);
});
