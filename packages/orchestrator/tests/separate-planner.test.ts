import { describe, expect, it } from 'vitest';
import {
  cancelRun,
  controlToolsFor,
  decidePlan,
  leadToolCall,
  ownerChat,
  recoverAfterRestart,
  requestPermission,
  stopAgent,
  ticketPlannerPrompt,
  ticketOrchestratorPrompt,
  ticketRunPrompts,
} from '../src/index.js';
import { LEAD, REGISTERED, event, makeCtx, ok, refused, statusOf, agentOf } from './helpers.js';
import {
  LEAD_BRIEF,
  PLANNER,
  PLANNER_PROMPT,
  approved,
  createWithWorkflow,
  planning,
  submitAs,
  workflow,
} from './workflow-helpers.js';

/** Separate planner mode (ADR-0019 §2). Synthetic data only. */

const SEPARATE = workflow({ plannerMode: 'separate' });

describe('separate planner: start', () => {
  it('starts the planner on the planner prompt; the lead waits QUEUED', () => {
    const r = ok(createWithWorkflow(SEPARATE));
    expect(r.state.run.status).toBe('PLANNING');
    expect(agentOf(r.state, PLANNER)).toMatchObject({
      kind: 'planner',
      role: 'Planner',
      stage: 'plan',
      status: 'STARTING',
      parentAgentRunId: null,
      task: null,
    });
    expect(agentOf(r.state, LEAD)).toMatchObject({ status: 'QUEUED', stage: 'orchestrate' });
    expect(r.effects).toEqual([
      {
        type: 'start-agent',
        agentRunId: PLANNER,
        kind: 'planner',
        role: 'Planner',
        prompt: PLANNER_PROMPT,
      },
    ]);
    expect(r.state.leadBrief).toBe(LEAD_BRIEF);
    expect(r.state.workflow).toEqual(SEPARATE);
  });

  it('talks with the planner while it plans and while the plan waits', () => {
    let s = planning(SEPARATE);
    const r = ok(ownerChat(s, 'Keep it small', makeCtx(1200)));
    expect(r.effects).toEqual([
      { type: 'chat-message', role: 'owner', text: 'Keep it small' },
      { type: 'send-to-agent', agentRunId: PLANNER, text: 'Keep it small' },
    ]);
    s = ok(submitAs(s, PLANNER)).state;
    expect(ok(ownerChat(s, 'one more', makeCtx(1700))).effects[1]).toEqual({
      type: 'send-to-agent',
      agentRunId: PLANNER,
      text: 'one more',
    });
  });

  it("publishes the planner's text as chat, under the run's agent voice", () => {
    const r = ok(event(planning(SEPARATE), PLANNER, { type: 'lead-text', text: 'A question?' }));
    expect(r.effects).toEqual([{ type: 'chat-message', role: 'lead', text: 'A question?' }]);
  });
});

describe('separate planner: plan, revise, approve', () => {
  it('only the planner submits; the lead is refused', () => {
    const s = planning(SEPARATE);
    const lead = submitAs(s, LEAD);
    expect(refused(lead)).toBe('not-lead');
    if (!lead.ok) expect(lead.refusal.message).toContain('planner writes the plan');
    const r = ok(submitAs(s, PLANNER));
    expect(r.state.run.status).toBe('PLAN_REVIEW');
    expect(r.state.plans?.[0]).toMatchObject({ version: 1, status: 'proposed' });
  });

  it('sends the change request to the planner, which revises the plan', () => {
    let s = ok(submitAs(planning(SEPARATE), PLANNER)).state;
    const r = ok(decidePlan(s, 'p-1', 'request-changes', makeCtx(1600), 'Fewer steps'));
    expect(r.state.run.status).toBe('PLANNING');
    expect(r.effects[1]).toMatchObject({ type: 'send-to-agent', agentRunId: PLANNER });
    s = ok(submitAs(r.state, PLANNER, 'q')).state;
    expect(s.plans?.map((p) => [p.version, p.status])).toEqual([
      [1, 'changes-requested'],
      [2, 'proposed'],
    ]);
  });

  it('approval stops the planner and starts the lead with its brief and the approved plan', () => {
    const s = ok(submitAs(planning(SEPARATE), PLANNER)).state;
    const r = ok(decidePlan(s, 'p-1', 'approve', makeCtx(1600), 'Ship it'));
    expect(r.state.run.status).toBe('RUNNING');
    expect(statusOf(r.state, PLANNER)).toBe('SUCCEEDED');
    expect(statusOf(r.state, LEAD)).toBe('STARTING');
    expect(r.state.leadBrief).toBeUndefined();
    expect(r.effects.map((e) => e.type)).toEqual(['plan-decided', 'abort-agent', 'start-agent']);
    expect(r.effects[1]).toEqual({ type: 'abort-agent', agentRunId: PLANNER });
    const start = r.effects[2];
    if (start?.type !== 'start-agent') throw new Error('expected start-agent');
    expect(start).toMatchObject({ agentRunId: LEAD, kind: 'lead', role: 'Lead' });
    expect(start.prompt.startsWith(LEAD_BRIEF)).toBe(true);
    expect(start.prompt).toContain('The approved plan (v1): Add a theme store');
    expect(start.prompt).toContain('1. Theme store (Store): Persist the theme.');
    expect(start.prompt).toContain("Owner's note: Ship it");
    expect(start.prompt).toContain('at most 3 at once');
  });

  it('the lead then runs helpers as in Phase 4 but cannot submit or change the plan', () => {
    const s = approved(SEPARATE);
    expect(statusOf(s, LEAD)).toBe('RUNNING');
    expect(refused(submitAs(s, LEAD, 'z'))).toBe('not-lead');
    const r = ok(
      leadToolCall(
        s,
        {
          callerAgentRunId: LEAD,
          name: 'start_agent',
          input: { role: 'UI', task: 'Add the toggle' },
          registeredProjectIds: REGISTERED,
        },
        makeCtx(2000, 'w'),
      ),
    );
    expect(agentOf(r.state, 'w-1')).toMatchObject({ kind: 'worker', stage: 'helpers' });
  });

  it('the planner has only submit_plan; other tools are refused', () => {
    const s = planning(SEPARATE);
    for (const name of ['start_agent', 'list_agents', 'request_review', 'post_review']) {
      const r = leadToolCall(
        s,
        { callerAgentRunId: PLANNER, name, input: {}, registeredProjectIds: REGISTERED },
        makeCtx(1300),
      );
      expect(refused(r)).toBe('not-lead');
    }
    expect(controlToolsFor(s, PLANNER)).toEqual(['submit_plan']);
    expect(controlToolsFor(s, LEAD)).not.toContain('submit_plan');
    expect(controlToolsFor(s, LEAD)).not.toContain('post_review');
    expect(controlToolsFor(s, LEAD)).toContain('start_agent');
  });

  it('refuses every tool use the planner asks for: it only reads', () => {
    const r = requestPermission(
      planning(SEPARATE),
      { agentRunId: PLANNER, toolName: 'Edit', toolUseId: 't1', summary: 'Edit a.ts' },
      makeCtx(1300),
    );
    expect(refused(r)).toBe('unknown-tool');
  });
});

describe('separate planner: endings', () => {
  it('a planner that ends before approval fails the run and cancels the waiting lead', () => {
    const r = ok(
      event(planning(SEPARATE), PLANNER, {
        type: 'finished',
        outcome: 'error',
        reportedCostUsd: null,
      }),
    );
    expect(r.state.run.status).toBe('FAILED');
    expect(statusOf(r.state, LEAD)).toBe('CANCELLED');
    // The lead never started, so there is nothing to abort.
    expect(r.effects).toEqual([]);
  });

  it('stopping the waiting lead fails the run and aborts the planner', () => {
    const r = ok(stopAgent(planning(SEPARATE), LEAD, makeCtx(1300)));
    expect(r.state.run.status).toBe('FAILED');
    expect(statusOf(r.state, PLANNER)).toBe('CANCELLED');
    expect(r.effects).toContainEqual({ type: 'abort-agent', agentRunId: PLANNER });
  });

  it('refuses approval when the lead is gone', () => {
    const s = ok(submitAs(planning(SEPARATE), PLANNER)).state;
    const gone = {
      ...s,
      agents: s.agents.map((a) => (a.id === LEAD ? { ...a, status: 'CANCELLED' as const } : a)),
    };
    expect(refused(decidePlan(gone, 'p-1', 'approve', makeCtx(1600)))).toBe('agent-not-live');
  });

  it('Stop all during planning aborts the planner, then the lead', () => {
    const r = ok(cancelRun(planning(SEPARATE), makeCtx(1300)));
    expect(r.state.run.status).toBe('CANCELLING');
    expect(r.effects.filter((e) => e.type === 'abort-agent')).toEqual([
      { type: 'abort-agent', agentRunId: PLANNER },
      { type: 'abort-agent', agentRunId: LEAD },
    ]);
  });

  it('a restart while planning relaunches nothing', () => {
    const r = ok(recoverAfterRestart(planning(SEPARATE), makeCtx(1300)));
    expect(r.state.run.status).toBe('NEEDS_REVIEW');
    expect(statusOf(r.state, PLANNER)).toBe('NEEDS_REVIEW');
    expect(statusOf(r.state, LEAD)).toBe('NEEDS_REVIEW');
    expect(r.effects).toEqual([]);
  });
});

describe('ticket prompts per planner mode', () => {
  const ticket = {
    key: 'WEB-1',
    title: 'Dark mode',
    type: 'feature' as const,
    priority: 'high' as const,
    description: 'Add a dark theme.',
  };
  const limits = { maxConcurrentHelpers: 2, maxDepth: 2 };

  it('builds the planner and lead prompts for separate mode', () => {
    const planner = ticketPlannerPrompt(ticket, limits);
    expect(planner).toContain('Ticket WEB-1 (feature, high priority): Dark mode');
    expect(planner).toContain('You are the planner');
    expect(planner).toContain('Helpers may start helpers of their own.');
    const lead = ticketOrchestratorPrompt(ticket, limits);
    expect(lead).toContain('You cannot change the plan.');
    expect(ticketRunPrompts(ticket, limits, { plannerMode: 'separate' })).toEqual({
      leadPrompt: lead,
      plannerPrompt: planner,
    });
  });

  it('gives the Phase 4 lead prompt in lead mode or without a workflow', () => {
    const plain = ticketRunPrompts(ticket, limits);
    expect(Object.keys(plain)).toEqual(['leadPrompt']);
    expect(plain.leadPrompt).toContain('Plan first.');
    expect(ticketRunPrompts(ticket, limits, { plannerMode: 'lead' })).toEqual(plain);
  });
});
