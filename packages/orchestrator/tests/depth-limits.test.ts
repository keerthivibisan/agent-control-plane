import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_LIMITS,
  agentDepth,
  agentRollUp,
  cancelRun,
  checkRunLimits,
  createRun,
  decidePlan,
  descendantsOf,
  leadToolCall,
  requestPermission,
  runLimits,
  runSettingsFromSetup,
  stopAgent,
} from '../src/index.js';
import type { RunLimits, RunState } from '../src/index.js';
import {
  LEAD,
  PROJECT,
  REGISTERED,
  RUN,
  agentOf,
  event,
  makeCtx,
  ok,
  planningRun,
  refused,
  runningRun,
  statusOf,
  submitPlanFor,
  tokens,
} from './helpers.js';

/** Per-run limits and depth 2 (ADR-0013 amendment). Synthetic data only. */

/** A ticket run with an approved plan, lead RUNNING, under the given limits. */
function workingRun(limits: RunLimits): RunState {
  const { state, planId } = submitPlanFor(planningRun(limits));
  return ok(decidePlan(state, planId, 'approve', makeCtx(2000))).state;
}

let seq = 0;
/** `caller` starts a helper; returns the state (helper RUNNING) and its id. */
function start(state: RunState, caller: string, role = 'Helper') {
  const prefix = `a${++seq}`;
  const r = leadToolCall(
    state,
    {
      callerAgentRunId: caller,
      name: 'start_agent',
      input: { role, task: `Task for ${role}` },
      registeredProjectIds: REGISTERED,
    },
    makeCtx(3000, prefix),
  );
  if (!r.ok) return { result: r, state, id: '' };
  const id = `${prefix}-1`;
  const s = ok(
    event(r.state, id, { type: 'started', providerSessionId: `s-${id}`, model: null }),
  ).state;
  return { result: r, state: s, id };
}

const tool = (state: RunState, caller: string, name: string, input: unknown) =>
  leadToolCall(
    state,
    { callerAgentRunId: caller, name, input, registeredProjectIds: REGISTERED },
    makeCtx(4000, 'x'),
  );

describe('run limits', () => {
  it('defaults to the Phase 3 limits and accepts the hard ceilings', () => {
    expect(DEFAULT_RUN_LIMITS).toEqual({ maxConcurrentHelpers: 3, maxDepth: 1 });
    expect(runLimits({})).toEqual(DEFAULT_RUN_LIMITS);
    expect(checkRunLimits({ maxConcurrentHelpers: 6, maxDepth: 2 })).toBeNull();
    expect(checkRunLimits({ maxConcurrentHelpers: 1, maxDepth: 1 })).toBeNull();
  });

  it('refuses limits outside 1–6 helpers and depth 1–2', () => {
    const bad: RunLimits[] = [
      { maxConcurrentHelpers: 0, maxDepth: 1 },
      { maxConcurrentHelpers: 7, maxDepth: 1 },
      { maxConcurrentHelpers: 2.5, maxDepth: 1 },
      { maxConcurrentHelpers: 3, maxDepth: 0 },
      { maxConcurrentHelpers: 3, maxDepth: 3 },
      { maxConcurrentHelpers: Number.NaN, maxDepth: 1 },
    ];
    for (const limits of bad) {
      expect(checkRunLimits(limits)?.code).toBe('invalid-input');
      const r = createRun(
        {
          runId: RUN,
          leadAgentRunId: LEAD,
          projectId: PROJECT,
          title: 't',
          limits,
          registeredProjectIds: REGISTERED,
        },
        makeCtx(),
      );
      expect(refused(r)).toBe('invalid-input');
    }
  });

  it('derives limits and budget from a project setup', () => {
    expect(
      runSettingsFromSetup({
        maxConcurrentHelpers: 5,
        maxDepth: 2,
        defaultBudgetTokensPerAgent: 80_000,
      }),
    ).toEqual({
      limits: { maxConcurrentHelpers: 5, maxDepth: 2 },
      budget: { maxTokensPerAgent: 80_000, softCostUsdPerRun: null },
    });
  });

  it('enforces maxConcurrentHelpers over the whole tree', () => {
    let s = workingRun({ maxConcurrentHelpers: 2, maxDepth: 2 });
    const a = start(s, LEAD);
    s = a.state;
    const child = start(s, a.id);
    s = child.state;
    expect(refused(start(s, LEAD).result)).toBe('too-many-agents');
    expect(refused(start(s, a.id).result)).toBe('too-many-agents');
    s = ok(stopAgent(s, child.id, makeCtx(5000))).state;
    expect(start(s, LEAD).result.ok).toBe(true);
  });

  it('allows up to 6 helpers when the project says so', () => {
    let s = workingRun({ maxConcurrentHelpers: 6, maxDepth: 1 });
    for (let i = 0; i < 6; i++) s = start(s, LEAD).state;
    expect(refused(start(s, LEAD).result)).toBe('too-many-agents');
  });

  it('Phase 3 runs keep the default 3-helper limit', () => {
    let s = runningRun();
    for (let i = 0; i < 3; i++) s = start(s, LEAD).state;
    expect(refused(start(s, LEAD).result)).toBe('too-many-agents');
  });
});

describe('depth 2', () => {
  it('at depth 1 a helper cannot start helpers or use lead tools', () => {
    const { state, id } = start(workingRun({ maxConcurrentHelpers: 3, maxDepth: 1 }), LEAD);
    expect(refused(start(state, id).result)).toBe('depth-exceeded');
    expect(refused(tool(state, id, 'list_agents', {}))).toBe('not-lead');
  });

  it('marks a helper that may start helpers, and lets it start a child', () => {
    const s = workingRun({ maxConcurrentHelpers: 4, maxDepth: 2 });
    const parent = start(s, LEAD, 'Parent');
    expect(parent.result.ok && parent.result.effects[0]).toMatchObject({
      type: 'start-agent',
      kind: 'worker',
      canStartHelpers: true,
    });
    const child = start(parent.state, parent.id, 'Child');
    expect(child.result.ok).toBe(true);
    if (child.result.ok) expect(child.result.effects[0]).not.toHaveProperty('canStartHelpers');
    const c = agentOf(child.state, child.id);
    expect(c.parentAgentRunId).toBe(parent.id);
    expect(agentDepth(child.state, c)).toBe(2);
    // Depth 3 is never allowed.
    expect(refused(start(child.state, child.id).result)).toBe('depth-exceeded');
  });

  it('a parent helper manages only its own children; never plans or reviews', () => {
    let s = workingRun({ maxConcurrentHelpers: 5, maxDepth: 2 });
    const p1 = start(s, LEAD, 'P1');
    const p2 = start(p1.state, LEAD, 'P2');
    const c1 = start(p2.state, p1.id, 'C1');
    s = c1.state;

    expect(ok(tool(s, p1.id, 'list_agents', {})).value).toBe(`- ${c1.id}: C1, RUNNING`);
    expect(ok(tool(s, p2.id, 'list_agents', {})).value).toBe('No agents started yet.');
    expect(ok(tool(s, p1.id, 'agent_status', { agentId: c1.id })).value).toContain('C1: RUNNING');
    expect(refused(tool(s, p2.id, 'agent_status', { agentId: c1.id }))).toBe('unknown-agent');
    expect(refused(tool(s, p1.id, 'stop_agent', { agentId: p2.id }))).toBe('unknown-agent');
    expect(refused(tool(s, p1.id, 'message_agent', { agentId: LEAD, text: 'hi' }))).toBe(
      'unknown-agent',
    );
    expect(ok(tool(s, p1.id, 'message_agent', { agentId: c1.id, text: 'hi' })).effects).toEqual([
      { type: 'send-to-agent', agentRunId: c1.id, text: 'hi' },
    ]);
    expect(refused(tool(s, p1.id, 'submit_plan', { summary: 's', steps: [] }))).toBe('not-lead');
    expect(refused(tool(s, p1.id, 'request_review', {}))).toBe('not-lead');

    // The lead sees and manages the whole tree.
    const all = ok(tool(s, LEAD, 'list_agents', {})).value;
    expect(all).toContain(`${c1.id}: C1, RUNNING (helper of ${p1.id})`);
    expect(ok(tool(s, LEAD, 'stop_agent', { agentId: c1.id })).value).toBe('Stopped C1.');
  });

  it('stopping a parent helper stops its children first', () => {
    const s = workingRun({ maxConcurrentHelpers: 5, maxDepth: 2 });
    const p = start(s, LEAD, 'P');
    const c1 = start(p.state, p.id, 'C1');
    const c2 = start(c1.state, p.id, 'C2');
    const r = ok(tool(c2.state, LEAD, 'stop_agent', { agentId: p.id }));
    expect(r.effects).toEqual([
      { type: 'abort-agent', agentRunId: c1.id },
      { type: 'abort-agent', agentRunId: c2.id },
      { type: 'abort-agent', agentRunId: p.id },
    ]);
    for (const id of [p.id, c1.id, c2.id]) expect(statusOf(r.state, id)).toBe('CANCELLED');
  });

  it('Stop all aborts deepest first and the lead last', () => {
    const s = workingRun({ maxConcurrentHelpers: 5, maxDepth: 2 });
    const p = start(s, LEAD, 'P');
    const q = start(p.state, LEAD, 'Q');
    const c = start(q.state, p.id, 'C');
    const r = ok(cancelRun(c.state, makeCtx(9000)));
    expect(r.effects.filter((e) => e.type === 'abort-agent').map((e) => e.agentRunId)).toEqual([
      c.id,
      p.id,
      q.id,
      LEAD,
    ]);
  });

  it('rolls status and budget up for display; caps stay per agent', () => {
    let s = workingRun({ maxConcurrentHelpers: 5, maxDepth: 2 });
    const p = start(s, LEAD, 'P');
    const c = start(p.state, p.id, 'C');
    s = ok(event(c.state, p.id, { type: 'usage', messageId: 'm1', tokens: tokens(100) })).state;
    s = ok(event(s, c.id, { type: 'usage', messageId: 'm2', tokens: tokens(200) })).state;
    s = ok(
      requestPermission(
        s,
        { agentRunId: c.id, toolName: 'Edit', toolUseId: 't', summary: 'Edit a.ts' },
        makeCtx(5000, 'ap'),
      ),
    ).state;
    expect(agentRollUp(s, p.id)).toEqual({
      agentRunId: p.id,
      descendants: 1,
      liveDescendants: 1,
      pendingApprovals: 1,
      budgetTokensUsed: 110,
      subtreeBudgetTokensUsed: 320,
    });
    expect(agentRollUp(s, LEAD)?.descendants).toBe(2);
    expect(agentRollUp(s, 'nope')).toBeUndefined();
    expect(descendantsOf(s, LEAD).map((a) => a.id)).toEqual([p.id, c.id]);
    // Each agent keeps its own cap (1000): the child's 210 does not block the parent.
    expect(statusOf(s, p.id)).toBe('RUNNING');
  });
});

describe('depth 2: a parent helper that finishes while its helpers work', () => {
  function tree() {
    const s = workingRun({ maxConcurrentHelpers: 5, maxDepth: 2 });
    const p = start(s, LEAD, 'P');
    const c = start(p.state, p.id, 'C');
    return { state: c.state, p: p.id, c: c.id };
  }
  const finish = (state: RunState, id: string, outcome: 'success' | 'error' | 'cancelled') =>
    ok(event(state, id, { type: 'finished', outcome, reportedCostUsd: 0.05 }, 6000)).state;

  it('stays RUNNING until its last helper ends, then SUCCEEDED', () => {
    const { state, p, c } = tree();
    const held = finish(state, p, 'success');
    expect(statusOf(held, p)).toBe('RUNNING');
    expect(agentOf(held, p).awaitingHelpers).toBe(true);
    expect(agentOf(held, p).reportedCostUsd).toBe(0.05);
    expect(held.run.status).toBe('RUNNING');
    // Nothing can be sent to its ended process.
    expect(refused(tool(held, LEAD, 'message_agent', { agentId: p, text: 'hi' }))).toBe(
      'agent-not-live',
    );
    const after = finish(held, c, 'success');
    expect(statusOf(after, c)).toBe('SUCCEEDED');
    expect(statusOf(after, p)).toBe('SUCCEEDED');
    expect(agentOf(after, p).awaitingHelpers).toBe(false);
    expect(agentOf(after, p).review).toBe('pending');
  });

  it('also ends once its helper is stopped', () => {
    const { state, p, c } = tree();
    const held = finish(state, p, 'success');
    const r = ok(stopAgent(held, c, makeCtx(7000)));
    expect(statusOf(r.state, p)).toBe('SUCCEEDED');
  });

  it('ends at once on an error, leaving its helpers to the lead', () => {
    const { state, p, c } = tree();
    const failed = finish(state, p, 'error');
    expect(statusOf(failed, p)).toBe('FAILED');
    expect(statusOf(failed, c)).toBe('RUNNING');
    expect(ok(tool(failed, LEAD, 'stop_agent', { agentId: c })).value).toBe('Stopped C.');
  });

  it('a helper without live helpers finishes normally', () => {
    const { state, p, c } = tree();
    const s = finish(finish(state, c, 'success'), p, 'success');
    expect(statusOf(s, p)).toBe('SUCCEEDED');
    expect(agentOf(s, p).awaitingHelpers).toBeUndefined();
  });

  it('Stop all still ends a held parent after its helpers', () => {
    const { state, p, c } = tree();
    const r = ok(cancelRun(finish(state, p, 'success'), makeCtx(8000)));
    expect(r.effects.filter((e) => e.type === 'abort-agent').map((e) => e.agentRunId)).toEqual([
      c,
      p,
      LEAD,
    ]);
    expect(statusOf(r.state, p)).toBe('CANCELLED');
  });
});

describe('typed refusals around limits and depth', () => {
  it('start_agent: project-not-registered, run-cancelling, agent-not-live, over-budget', () => {
    const s = workingRun({ maxConcurrentHelpers: 3, maxDepth: 2 });
    const notRegistered = leadToolCall(
      s,
      {
        callerAgentRunId: LEAD,
        name: 'start_agent',
        input: { role: 'X', task: 'y' },
        registeredProjectIds: [],
      },
      makeCtx(3000, 'z'),
    );
    expect(refused(notRegistered)).toBe('project-not-registered');
    expect(refused(start(ok(cancelRun(s, makeCtx(3000))).state, LEAD).result)).toBe(
      'run-cancelling',
    );
    const p = start(s, LEAD, 'P');
    const ended = ok(
      event(p.state, p.id, { type: 'finished', outcome: 'error', reportedCostUsd: null }),
    ).state;
    expect(refused(start(ended, p.id).result)).toBe('agent-not-live');
    const over = ok(
      event(p.state, p.id, { type: 'usage', messageId: 'big', tokens: tokens(5000) }),
    ).state;
    expect(refused(start(over, p.id).result)).toBe('over-budget');
  });

  it('a depth-1 helper cannot submit a plan or request review', () => {
    const { state, id } = start(workingRun({ maxConcurrentHelpers: 3, maxDepth: 1 }), LEAD);
    expect(refused(tool(state, id, 'submit_plan', { summary: 's', steps: [] }))).toBe('not-lead');
    expect(refused(tool(state, id, 'request_review', {}))).toBe('not-lead');
  });
});
