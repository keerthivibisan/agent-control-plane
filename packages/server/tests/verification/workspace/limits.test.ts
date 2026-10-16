import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@acp/db';
import { leadToolCall } from '@acp/orchestrator';
import { PARENT_HELPER_NOTE } from '../../../src/control/service.js';
import { createRunStore } from '../../../src/control/store.js';
import {
  approveLatestPlan,
  bootWorkspace,
  createProject,
  createTicket,
  expectStatus,
  logLines,
  runDetail,
  setupBody,
  startHelper,
  startTicket,
  submitPlan,
  ticketDetail,
  waitFor,
  waitForRun,
  type WorkspaceServer,
} from './harness.js';

/*
 * P4-H: the agent tree's limits through the server (README §4.2 step 4, ADR-0013 amendment,
 * ADR-0016): plan first (`plan_not_approved` while planning and in plan review), depth 2 (a parent
 * helper starts its own helper and is told when it ends), and the refusals: deeper than the
 * project's `maxDepth`, more live helpers than `maxConcurrentHelpers`.
 */

const open: WorkspaceServer[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

const refusals = (b: WorkspaceServer, code: string) =>
  logLines(b.logs, 'lead tool refused').filter((l) => l['code'] === code);

describe('P4-H agent tree limits', () => {
  it('refuses helpers before plan approval; depth 2 parent starts a child and hears when it ends; depth and helper limits refuse', async () => {
    const b = await bootWorkspace();
    open.push(b);
    const project = await createProject(b, 'tree');
    expectStatus(
      await b.put(
        `/api/projects/${project.id}/setup`,
        setupBody('TREE', { maxDepth: 2, maxConcurrentHelpers: 2 }),
      ),
      200,
    );
    const ticket = await createTicket(b, project.id, { title: 'Split the work' });
    const { runId, lead } = await startTicket(b, ticket.id);

    // Plan first: refused while planning and while the plan waits for the owner.
    await expect(lead.callLead('start_agent', { role: 'Early', task: 'x' })).rejects.toThrow(
      /Plan first/,
    );
    await submitPlan(b, ticket.id, lead, 'Two levels', [
      { title: 'Split', role: 'Parent', detail: 'Starts a child' },
    ]);
    await expect(lead.callLead('start_agent', { role: 'Early', task: 'x' })).rejects.toThrow(
      /waiting for the owner/,
    );
    expect(refusals(b, 'plan-not-approved')).toHaveLength(2);
    expect(b.fake.workers()).toEqual([]);
    expect((await runDetail(b, runId)).agents.map((a) => a.kind)).toEqual(['lead']);
    await approveLatestPlan(b, ticket.id);

    // Depth 2: the parent helper gets the child tools and the note; its child gets neither.
    const parent = await startHelper(b, runId, lead, 'Parent', 'Split the work');
    expect(parent.spec.canStartHelpers).toBe(true);
    expect(parent.spec.leadTools).toBeDefined();
    expect(parent.spec.prompt).toBe(`Split the work\n\n${PARENT_HELPER_NOTE}`);
    const child = await startHelper(b, runId, parent, 'Child', 'Do one part');
    expect(child.spec.canStartHelpers).toBeUndefined();
    expect(child.spec.leadTools).toBeUndefined();
    let run = await runDetail(b, runId);
    const leadId = lead.id;
    expect(run.agents.map((a) => [a.role, a.parentAgentRunId])).toEqual([
      [expect.any(String), null],
      ['Parent', leadId],
      ['Child', parent.id],
    ]);

    // Helpers at once: two are live (the child counts), so a third is refused for both callers.
    await expect(lead.callLead('start_agent', { role: 'Third', task: 'x' })).rejects.toThrow(
      /At most 2 agents/,
    );
    await expect(parent.callLead('start_agent', { role: 'Sibling', task: 'x' })).rejects.toThrow(
      /At most 2 agents/,
    );
    expect(refusals(b, 'too-many-agents')).toHaveLength(2);

    // Deeper than maxDepth 2: the child has no tools at all (above); and the engine refuses a
    // start from it on the run's own state. Limits are not stored yet (P4-D proposal: migration
    // 0004), so the loaded state gets the project's limits back, as the live run holds them.
    const db = openDatabase(b.databasePath);
    try {
      const stored = createRunStore({ db, now: () => new Date() }).load(runId);
      if (stored === undefined) throw new Error('run not stored');
      const state = { ...stored, limits: { maxConcurrentHelpers: 6, maxDepth: 2 } };
      const fromChild = leadToolCall(
        state,
        {
          callerAgentRunId: child.id,
          name: 'start_agent',
          input: { role: 'Grandchild', task: 'x' },
          registeredProjectIds: [project.id],
        },
        { now: new Date(), newId: () => 'never-used' },
      );
      expect(fromChild).toMatchObject({
        ok: false,
        refusal: {
          code: 'depth-exceeded',
          message: 'Helpers of helpers cannot start more agents.',
        },
      });
    } finally {
      db.close();
    }

    // The child ends: its parent is told, and a slot frees up.
    child.finish('success');
    await waitFor(
      () =>
        parent.sent.some((m) => m.includes(`Your helper "Child" (${child.id}) finished.`))
          ? true
          : undefined,
      'the parent to hear that its child finished',
    );
    const third = await startHelper(b, runId, lead, 'Third', 'Another part');
    run = await waitForRun(
      b,
      runId,
      (r) => r.agents.filter((a) => a.kind === 'worker').length === 3,
      'three helpers',
    );
    expect(run.agents.find((a) => a.id === third.id)?.parentAgentRunId).toBe(leadId);
    const card = (await ticketDetail(b, ticket.id)).ticket;
    expect(card.stage).toBe('WORKING');
  }, 60_000);

  it('depth 1 (the default): helpers get no child tools', async () => {
    const b = await bootWorkspace();
    open.push(b);
    const project = await createProject(b, 'flat');
    const ticket = await createTicket(b, project.id, { title: 'One level' });
    const { runId, lead } = await startTicket(b, ticket.id);
    await submitPlan(b, ticket.id, lead, 'One helper');
    await approveLatestPlan(b, ticket.id);
    const helper = await startHelper(b, runId, lead, 'Builder', 'Build');
    expect(helper.spec.canStartHelpers).toBeUndefined();
    expect(helper.spec.leadTools).toBeUndefined();
    expect(helper.spec.prompt).toBe('Build');
  }, 60_000);
});
