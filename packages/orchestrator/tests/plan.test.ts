import { TicketPlanSchema } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  approvedPlan,
  cancelRun,
  createRun,
  decidePlan,
  leadToolCall,
  ownerChat,
  pendingPlan,
  plannedHelpers,
  recoverAfterRestart,
  requestPermission,
  ticketLeadPrompt,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import {
  LEAD,
  PLAN_INPUT,
  PROJECT,
  REGISTERED,
  RUN,
  TICKET,
  event,
  makeCtx,
  ok,
  planningRun,
  refused,
  statusOf,
  submitPlanFor,
  tokens,
} from './helpers.js';

/** Plan-first ticket runs (ADR-0016, README §4.2). Synthetic data only. */

const startAgent = (state: RunState) =>
  leadToolCall(
    state,
    {
      callerAgentRunId: LEAD,
      name: 'start_agent',
      input: { role: 'UI', task: 'Add the toggle' },
      registeredProjectIds: REGISTERED,
    },
    makeCtx(5000, 'w'),
  );

const submit = (state: RunState, input: unknown = PLAN_INPUT, caller = LEAD) =>
  leadToolCall(
    state,
    { callerAgentRunId: caller, name: 'submit_plan', input, registeredProjectIds: REGISTERED },
    makeCtx(1500, 'p'),
  );

describe('ticket-aware createRun', () => {
  it('starts a ticket run in PLANNING with the lead STARTING on the ticket brief', () => {
    const r = ok(
      createRun(
        {
          runId: RUN,
          leadAgentRunId: LEAD,
          projectId: PROJECT,
          title: 'WEB-1',
          ticket: { ticketId: TICKET, leadPrompt: 'the brief' },
          registeredProjectIds: REGISTERED,
        },
        makeCtx(),
      ),
    );
    expect(r.state.run).toMatchObject({ ticketId: TICKET, status: 'PLANNING' });
    expect(statusOf(r.state, LEAD)).toBe('STARTING');
    expect(r.state.plans).toEqual([]);
    expect(r.state.limits).toEqual({ maxConcurrentHelpers: 3, maxDepth: 1 });
    expect(r.effects).toEqual([
      { type: 'start-agent', agentRunId: LEAD, kind: 'lead', role: 'Lead', prompt: 'the brief' },
    ]);
    expect(r.value).toBe(r.state);
  });

  it('keeps Phase 3 runs QUEUED without a ticket and without effects', () => {
    const r = ok(
      createRun(
        {
          runId: RUN,
          leadAgentRunId: LEAD,
          projectId: PROJECT,
          title: 'chat run',
          registeredProjectIds: REGISTERED,
        },
        makeCtx(),
      ),
    );
    expect(r.state.run).toMatchObject({ ticketId: null, status: 'QUEUED' });
    expect(r.effects).toEqual([]);
    expect(r.state.plans).toBeUndefined();
  });

  it('refuses an empty ticket id or brief', () => {
    const base = {
      runId: RUN,
      leadAgentRunId: LEAD,
      projectId: PROJECT,
      title: 't',
      registeredProjectIds: REGISTERED,
    };
    expect(
      refused(createRun({ ...base, ticket: { ticketId: '', leadPrompt: 'x' } }, makeCtx())),
    ).toBe('invalid-input');
    expect(
      refused(createRun({ ...base, ticket: { ticketId: TICKET, leadPrompt: '  ' } }, makeCtx())),
    ).toBe('invalid-input');
  });

  it('stays PLANNING once the lead runs (not RUNNING)', () => {
    const s = planningRun();
    expect(s.run.status).toBe('PLANNING');
    expect(statusOf(s, LEAD)).toBe('RUNNING');
  });
});

describe('submit_plan', () => {
  it('files plan v1 and moves PLANNING → PLAN_REVIEW', () => {
    const r = ok(submit(planningRun()));
    expect(r.state.run.status).toBe('PLAN_REVIEW');
    expect(r.value).toContain('Plan v1 submitted');
    const plan = pendingPlan(r.state);
    expect(plan).toMatchObject({
      id: 'p-1',
      ticketId: TICKET,
      runId: RUN,
      version: 1,
      status: 'proposed',
      plannedHelpers: 2,
      decidedAt: null,
    });
    expect(TicketPlanSchema.safeParse(plan).success).toBe(true);
    expect(r.effects).toEqual([{ type: 'plan-submitted', planId: 'p-1' }]);
  });

  it('validates input with LeadToolInputs.submit_plan', () => {
    expect(refused(submit(planningRun(), { summary: 'x', steps: [] }))).toBe('invalid-input');
    expect(refused(submit(planningRun(), { summary: '', steps: PLAN_INPUT.steps }))).toBe(
      'invalid-input',
    );
  });

  it('is refused while a plan waits, outside planning, and for non-ticket runs', () => {
    const { state } = submitPlanFor(planningRun());
    expect(refused(submit(state))).toBe('run-not-active');
    const phase3 = ok(ownerChat(createPhase3(), 'go', makeCtx(10))).state;
    expect(refused(submit(phase3))).toBe('run-not-active');
  });

  it('is refused for unknown callers and while the run is stopping', () => {
    const s = planningRun();
    expect(refused(submit(s, PLAN_INPUT, 'nobody'))).toBe('unknown-agent');
    const stopping = ok(cancelRun(s, makeCtx(10))).state;
    expect(refused(submit(stopping))).toBe('run-cancelling');
  });

  it('counts distinct helper roles, ignoring case and the lead', () => {
    expect(
      plannedHelpers([{ role: 'UI' }, { role: 'ui' }, { role: 'Lead' }, { role: ' lead ' }]),
    ).toBe(1);
  });
});

function createPhase3(): RunState {
  return ok(
    createRun(
      {
        runId: RUN,
        leadAgentRunId: LEAD,
        projectId: PROJECT,
        title: 't',
        registeredProjectIds: REGISTERED,
      },
      makeCtx(),
    ),
  ).state;
}

describe('plan decisions', () => {
  it('approve: PLAN_REVIEW → RUNNING, the lead is told to start', () => {
    const { state, planId } = submitPlanFor(planningRun());
    const r = ok(decidePlan(state, planId, 'approve', makeCtx(2000), 'Keep it small'));
    expect(r.state.run.status).toBe('RUNNING');
    expect(r.value).toMatchObject({ status: 'approved', decidedAt: '2026-10-11T10:00:02.000Z' });
    expect(approvedPlan(r.state)?.id).toBe(planId);
    expect(r.effects[0]).toEqual({ type: 'plan-decided', planId, status: 'approved' });
    expect(r.effects[1]).toMatchObject({ type: 'send-to-agent', agentRunId: LEAD });
    const text = (r.effects[1] as { text: string }).text;
    expect(text).toContain('approved plan v1');
    expect(text).toContain("Owner's note: Keep it small");
    expect(text).toContain('at most 3 at once');
  });

  it('request changes: PLAN_REVIEW → PLANNING, the comment goes to the lead, v2 follows', () => {
    const { state, planId } = submitPlanFor(planningRun());
    const r = ok(decidePlan(state, planId, 'request-changes', makeCtx(2000), 'Split the store'));
    expect(r.state.run.status).toBe('PLANNING');
    expect(r.value.status).toBe('changes-requested');
    expect(r.effects).toEqual([
      { type: 'plan-decided', planId, status: 'changes-requested' },
      {
        type: 'send-to-agent',
        agentRunId: LEAD,
        text: 'The owner asked for changes to plan v1:\n\nSplit the store\n\nRevise the plan and call submit_plan again.',
      },
    ]);
    const v2 = submitPlanFor(r.state, 'q');
    expect(v2.state.run.status).toBe('PLAN_REVIEW');
    expect(pendingPlan(v2.state)).toMatchObject({ id: 'q-1', version: 2 });
    expect(v2.state.plans?.map((p) => p.status)).toEqual(['changes-requested', 'proposed']);
  });

  it('request changes needs a comment', () => {
    const { state, planId } = submitPlanFor(planningRun());
    expect(refused(decidePlan(state, planId, 'request-changes', makeCtx(2000)))).toBe(
      'invalid-input',
    );
    expect(refused(decidePlan(state, planId, 'request-changes', makeCtx(2000), '   '))).toBe(
      'invalid-input',
    );
  });

  it('refuses unknown plans, decided plans, and decisions outside PLAN_REVIEW', () => {
    const { state, planId } = submitPlanFor(planningRun());
    expect(refused(decidePlan(state, 'nope', 'approve', makeCtx(2000)))).toBe('plan-not-found');
    const approved = ok(decidePlan(state, planId, 'approve', makeCtx(2000))).state;
    expect(refused(decidePlan(approved, planId, 'approve', makeCtx(3000)))).toBe(
      'plan-not-pending',
    );
    const stopping = ok(cancelRun(state, makeCtx(2000))).state;
    expect(refused(decidePlan(stopping, planId, 'approve', makeCtx(3000)))).toBe('run-cancelling');
  });

  it('refuses a decision while the lead is over budget', () => {
    const { state, planId } = submitPlanFor(planningRun(undefined, 100));
    const over = ok(
      event(state, LEAD, { type: 'usage', messageId: 'm1', tokens: tokens(200) }, 1800),
    ).state;
    expect(statusOf(over, LEAD)).toBe('BLOCKED');
    expect(over.run.status).toBe('PLAN_REVIEW');
    expect(refused(decidePlan(over, planId, 'approve', makeCtx(2000)))).toBe('over-budget');
  });
});

describe('plan_not_approved refusals', () => {
  it('refuses start_agent in PLANNING and PLAN_REVIEW, allows it after approval', () => {
    const s = planningRun();
    const r1 = startAgent(s);
    expect(refused(r1)).toBe('plan-not-approved');
    const { state, planId } = submitPlanFor(s);
    expect(refused(startAgent(state))).toBe('plan-not-approved');
    const approved = ok(decidePlan(state, planId, 'approve', makeCtx(2000))).state;
    expect(ok(startAgent(approved)).state.agents).toHaveLength(2);
  });

  it('refuses non-read-only tool use while planning (the server denies it)', () => {
    const r = requestPermission(
      planningRun(),
      { agentRunId: LEAD, toolName: 'Edit', toolUseId: 't1', summary: 'Edit a.ts' },
      makeCtx(1000),
    );
    expect(refused(r)).toBe('plan-not-approved');
    if (!r.ok) expect(r.refusal.message).toContain('submit_plan');
  });
});

describe('planning edge cases', () => {
  it('lets the owner chat with the lead while planning and while the plan waits', () => {
    const s = planningRun();
    const r = ok(ownerChat(s, 'Also check mobile', makeCtx(1000)));
    expect(r.effects).toEqual([
      { type: 'chat-message', role: 'owner', text: 'Also check mobile' },
      { type: 'send-to-agent', agentRunId: LEAD, text: 'Also check mobile' },
    ]);
    const { state } = submitPlanFor(s);
    expect(ok(ownerChat(state, 'why?', makeCtx(2000))).state.run.status).toBe('PLAN_REVIEW');
  });

  it('fails the run when the lead ends before an approved plan', () => {
    const s = planningRun();
    const failed = ok(
      event(s, LEAD, { type: 'finished', outcome: 'error', reportedCostUsd: null }),
    ).state;
    expect(failed.run.status).toBe('FAILED');
    const { state } = submitPlanFor(planningRun());
    const ended = ok(
      event(state, LEAD, { type: 'finished', outcome: 'success', reportedCostUsd: 0.1 }),
    ).state;
    expect(ended.run.status).toBe('FAILED');
  });

  it('Stop all works from PLANNING and PLAN_REVIEW', () => {
    const s = planningRun();
    expect(ok(cancelRun(s, makeCtx(1000))).state.run.status).toBe('CANCELLING');
    const { state } = submitPlanFor(s);
    const r = ok(cancelRun(state, makeCtx(2000)));
    expect(r.state.run.status).toBe('CANCELLING');
    expect(r.effects).toEqual([{ type: 'abort-agent', agentRunId: LEAD }]);
  });

  it('a restart in planning marks the run NEEDS_REVIEW and relaunches nothing', () => {
    const { state } = submitPlanFor(planningRun());
    const r = ok(recoverAfterRestart(state, makeCtx(5000)));
    expect(r.state.run.status).toBe('NEEDS_REVIEW');
    expect(statusOf(r.state, LEAD)).toBe('NEEDS_REVIEW');
    expect(r.effects).toEqual([]);
    expect(r.state.plans).toHaveLength(1);
  });

  it('keeps plans through unrelated commands', () => {
    const { state } = submitPlanFor(planningRun());
    const after = ok(event(state, LEAD, { type: 'activity', summary: 'Read a.ts' })).state;
    expect(after.plans).toEqual(state.plans);
  });
});

describe('ticketLeadPrompt', () => {
  it('includes the ticket, the plan-first instruction and the limits', () => {
    const text = ticketLeadPrompt(
      {
        key: 'WEB-12',
        title: 'Dark mode',
        type: 'feature',
        priority: 'high',
        description: 'Add a toggle.',
      },
      { maxConcurrentHelpers: 4, maxDepth: 2 },
    );
    expect(text).toContain('Ticket WEB-12 (feature, high priority): Dark mode');
    expect(text).toContain('Add a toggle.');
    expect(text).toContain('submit_plan');
    expect(text).toContain('up to 4 helpers');
    expect(text).toContain('Helpers may start helpers of their own.');
    const noDesc = ticketLeadPrompt(
      { key: 'WEB-1', title: 't', type: 'bug', priority: 'low', description: ' ' },
      { maxConcurrentHelpers: 1, maxDepth: 1 },
    );
    expect(noDesc).toContain('(No description.)');
    expect(noDesc).toContain('Helpers cannot start helpers of their own.');
  });
});
