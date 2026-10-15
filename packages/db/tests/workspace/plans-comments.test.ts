import { describe, expect, it } from 'vitest';
import { thrown } from '../helpers.js';
import { BUDGET, count, setupWorkspace, STEPS, ticketWithRun } from './setup.js';

describe('ticket plans repository (P4-B)', () => {
  it('stores versioned plans per run and counts distinct helper roles', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const v1 = store.ws.plans.insert({
      ticketId: ticket.id,
      runId: run.id,
      summary: 'Synthetic plan',
      steps: STEPS,
    });
    expect(v1).toMatchObject({
      ticketId: ticket.id,
      runId: run.id,
      version: 1,
      status: 'proposed',
      // Frontend (case-insensitive) and QA; Lead steps are the lead's own.
      plannedHelpers: 2,
      decidedAt: null,
      steps: STEPS,
    });
    expect(store.ws.plans.getById(v1.id)).toEqual(v1);

    const sentBack = store.ws.plans.decide(v1.id, 'changes-requested');
    expect(sentBack?.status).toBe('changes-requested');
    expect(sentBack?.decidedAt).not.toBeNull();
    expect(thrown(() => store.ws.plans.decide(v1.id, 'approved'))).toMatchObject({
      code: 'conflict',
    });
    expect(store.ws.plans.decide('missing', 'approved')).toBeUndefined();

    const v2 = store.ws.plans.insert({
      ticketId: ticket.id,
      runId: run.id,
      summary: 'Synthetic plan v2',
      steps: STEPS.slice(0, 1),
    });
    expect(v2).toMatchObject({ version: 2, plannedHelpers: 1 });
    expect(store.ws.plans.approvedForRun(run.id)).toBeUndefined();
    const approved = store.ws.plans.decide(v2.id, 'approved', '2026-10-13T14:00:00+02:00');
    expect(approved?.decidedAt).toBe('2026-10-13T12:00:00.000Z');
    expect(store.ws.plans.approvedForRun(run.id)?.id).toBe(v2.id);
    expect(store.ws.plans.latestForRun(run.id)?.id).toBe(v2.id);
    expect(store.ws.plans.listForRun(run.id).map((p) => p.version)).toEqual([1, 2]);
    expect(store.ws.plans.latestForRun('none')).toBeUndefined();
  });

  it('a new version supersedes a still-proposed one; versions restart per run', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const base = { ticketId: ticket.id, runId: run.id, summary: 'S', steps: STEPS };
    const v1 = store.ws.plans.insert(base);
    const v2 = store.ws.plans.insert(base);
    expect(store.ws.plans.getById(v1.id)?.status).toBe('superseded');
    expect(v2.status).toBe('proposed');
    expect(store.ws.plans.supersedeProposed(run.id)).toBe(1);
    expect(store.ws.plans.supersedeProposed(run.id)).toBe(0);

    const rerun = store.orch.runs.insert({
      projectId: store.projectId,
      ticketId: ticket.id,
      title: 'Re-run',
      budget: BUDGET,
    });
    const r1 = store.ws.plans.insert({ ...base, runId: rerun.id });
    expect(r1.version).toBe(1);
    expect(store.ws.plans.listForTicket(ticket.id).map((p) => [p.runId, p.version])).toEqual([
      [run.id, 1],
      [run.id, 2],
      [rerun.id, 1],
    ]);
  });

  it('rejects invalid plans and runs of another ticket', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const base = { ticketId: ticket.id, runId: run.id, summary: 'S', steps: STEPS };
    for (const bad of [
      { ...base, summary: '' },
      { ...base, summary: 'x'.repeat(2001) },
      { ...base, steps: [] },
      { ...base, steps: Array.from({ length: 13 }, () => STEPS[0]) },
      { ...base, steps: [{ title: 'x'.repeat(121), role: 'R', detail: '' }] },
    ]) {
      expect(
        thrown(() =>
          // @ts-expect-error: invalid values are rejected at runtime too
          store.ws.plans.insert(bad),
        ),
      ).toMatchObject({ code: 'invalid_input' });
    }
    const plain = store.orch.runs.insert({
      projectId: store.projectId,
      title: 'No ticket',
      budget: BUDGET,
    });
    expect(thrown(() => store.ws.plans.insert({ ...base, runId: plain.id }))).toMatchObject({
      code: 'not_found',
    });
    expect(
      thrown(() =>
        // @ts-expect-error: superseded is not an owner decision
        store.ws.plans.decide('x', 'superseded'),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});

describe('ticket comments repository (P4-B)', () => {
  it('stores owner and lead comments, about the ticket, a run or a plan', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const plan = store.ws.plans.insert({
      ticketId: ticket.id,
      runId: run.id,
      summary: 'S',
      steps: STEPS,
    });
    const general = store.ws.comments.insert({
      ticketId: ticket.id,
      author: 'owner',
      body: ' Synthetic note ',
    });
    expect(general).toMatchObject({ runId: null, planId: null, body: 'Synthetic note' });
    // The plan's run is filled in.
    const onPlan = store.ws.comments.insert({
      ticketId: ticket.id,
      planId: plan.id,
      author: 'owner',
      body: 'Split the store step',
    });
    expect(onPlan).toMatchObject({ runId: run.id, planId: plan.id });
    const lead = store.ws.comments.insert({
      ticketId: ticket.id,
      runId: run.id,
      author: 'lead',
      body: 'Synthetic lead note',
    });
    expect(store.ws.comments.getById(lead.id)).toEqual(lead);
    expect(store.ws.comments.listForTicket(ticket.id).map((c) => c.id)).toEqual([
      general.id,
      onPlan.id,
      lead.id,
    ]);
    expect(store.ws.comments.listForPlan(plan.id).map((c) => c.id)).toEqual([onPlan.id]);
  });

  it('rejects bad comments and references outside the ticket', () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const other = ticketWithRun(store, 'Other');
    const otherPlan = store.ws.plans.insert({
      ticketId: other.ticket.id,
      runId: other.run.id,
      summary: 'S',
      steps: STEPS,
    });
    const base = { ticketId: ticket.id, author: 'owner' as const, body: 'B' };
    expect(thrown(() => store.ws.comments.insert({ ...base, body: '   ' }))).toMatchObject({
      code: 'invalid_input',
    });
    expect(
      thrown(() => store.ws.comments.insert({ ...base, body: 'x'.repeat(8001) })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() =>
        // @ts-expect-error: unknown author
        store.ws.comments.insert({ ...base, author: 'helper' }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => store.ws.comments.insert({ ...base, ticketId: 'nope' }))).toMatchObject({
      code: 'not_found',
    });
    expect(
      thrown(() => store.ws.comments.insert({ ...base, runId: other.run.id })),
    ).toMatchObject({ code: 'not_found' });
    expect(thrown(() => store.ws.comments.insert({ ...base, planId: otherPlan.id }))).toMatchObject(
      { code: 'not_found' },
    );
    const plan = store.ws.plans.insert({
      ticketId: ticket.id,
      runId: run.id,
      summary: 'S',
      steps: STEPS,
    });
    const rerun = store.orch.runs.insert({
      projectId: store.projectId,
      ticketId: ticket.id,
      title: 'Re-run',
      budget: BUDGET,
    });
    expect(
      thrown(() => store.ws.comments.insert({ ...base, planId: plan.id, runId: rerun.id })),
    ).toMatchObject({ code: 'invalid_input' });
  });

  it("deleting a run removes its plans and comments; the ticket's own comments stay", () => {
    const store = setupWorkspace();
    const { ticket, run } = ticketWithRun(store);
    const plan = store.ws.plans.insert({
      ticketId: ticket.id,
      runId: run.id,
      summary: 'S',
      steps: STEPS,
    });
    store.ws.comments.insert({ ticketId: ticket.id, planId: plan.id, author: 'owner', body: 'P' });
    store.ws.comments.insert({ ticketId: ticket.id, runId: run.id, author: 'lead', body: 'R' });
    const keep = store.ws.comments.insert({ ticketId: ticket.id, author: 'owner', body: 'T' });
    store.orch.runs.remove(run.id);
    expect(count(store.db, 'ticket_plans')).toBe(0);
    expect(store.ws.comments.listForTicket(ticket.id)).toEqual([keep]);
  });
});
