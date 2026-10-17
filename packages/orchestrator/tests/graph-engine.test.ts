import { validateWorkflowGraph } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  agentLaunchMode,
  checkChangeAction,
  createRun,
  deriveRunWorkflowGraph,
  effectiveMode,
  programOf,
  recordChangeDecision,
  requestPermission,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import {
  LEAD,
  PROJECT,
  REGISTERED,
  RUN,
  TICKET,
  agentOf,
  event,
  makeCtx,
  ok,
  refused,
} from './helpers.js';
import {
  FRONTEND,
  PLANNER_ID,
  POOL,
  REVIEWER,
  STEPS,
  createGraphRun,
  graphRunning,
  testGraph,
  tool,
} from './graph-helpers.js';
import type { GraphOptions, GraphRunOptions } from './graph-helpers.js';
import { changeOf, effectsOf, finishTurn, leadMessages, sealed } from './loop-helpers.js';

/** WG-B engine behaviour on workflow graphs (ADR-0023). Synthetic data only. */

function valid(o: GraphOptions) {
  const g = testGraph(o);
  const errors = validateWorkflowGraph(g, { projectMode: 'manual' }).filter(
    (i) => i.severity === 'error',
  );
  expect(errors).toEqual([]);
  return g;
}

/** Starts a helper through the lead; returns the state and its id (`<prefix>-1`). */
function start(s: RunState, input: Record<string, unknown>, prefix: string) {
  const r = ok(tool(s, LEAD, 'start_agent', { task: 'Build it.', ...input }, prefix));
  const id = `${prefix}-1`;
  const started = ok(
    event(r.state, id, { type: 'started', providerSessionId: `sess-${id}`, model: null }, 2500),
  ).state;
  return { state: started, id, effects: r.effects };
}

/** A helper ends its turn and its change is sealed; the next reconcile reviews it. */
function done(s: RunState, id: string, prefix = 'rv') {
  return sealed(ok(finishTurn(s, id)).state, id, prefix);
}

describe('graph runs: the program', () => {
  it('records node ids as stages and launches with the node config', () => {
    const g = valid({ frontendModel: 'model-x', frontendSkills: ['ui'], frontendAgent: 'fe' });
    const s = graphRunning(g);
    expect(agentOf(s, LEAD).stage).toBe('orchestrate');
    const a = start(s, { role: 'Frontend helper' }, 'fa');
    expect(agentOf(a.state, a.id).stage).toBe(FRONTEND);
    const launch = effectsOf(a.effects, 'start-agent')[0];
    expect(launch).toMatchObject({ model: 'model-x', skills: ['ui'], agent: 'fe' });
    expect(launch?.prompt).toContain('acp-skills:ui');
  });

  it('refuses an invalid graph at createRun', () => {
    const g = testGraph();
    const broken = { ...g, edges: g.edges.filter((x) => x.type !== 'merge') };
    expect(refused(createGraphRun(broken))).toBe('invalid-input');
  });

  it('refuses a graph context whose helper limit is not the run’s, and graphs off tickets', () => {
    const g = valid({});
    const input = {
      runId: RUN,
      leadAgentRunId: LEAD,
      projectId: PROJECT,
      title: 'WEB-12',
      limits: { maxConcurrentHelpers: 3, maxDepth: 1 },
      graph: g,
      registeredProjectIds: REGISTERED,
    };
    const ctx = { projectMode: 'manual' as const, approvalCeilings: [], maxConcurrentHelpers: 2 };
    const ticket = { ticketId: TICKET, leadPrompt: 'Plan first' };
    expect(refused(createRun({ ...input, ticket, graphContext: ctx }, makeCtx()))).toBe(
      'invalid-input',
    );
    const right = { ...ctx, maxConcurrentHelpers: 3 };
    expect(createRun({ ...input, ticket, graphContext: right }, makeCtx()).ok).toBe(true);
    expect(refused(createRun({ ...input, ticket }, makeCtx()))).toBe('invalid-input');
    expect(refused(createRun({ ...input, graphContext: right }, makeCtx()))).toBe('invalid-input');
  });

  it('lists the helper nodes in the lead’s brief only when there are named helpers', () => {
    const withNamed = ok(createGraphRun(valid({}))).effects;
    const prompt = effectsOf(withNamed, 'start-agent')[0]?.prompt ?? '';
    expect(prompt).toContain('Frontend helper (helper "frontend"): Builds the UI.');
    expect(prompt).toContain('Helpers (helper "helpers")');
    const poolOnly = ok(createGraphRun(valid({ named: false }))).effects;
    expect(effectsOf(poolOnly, 'start-agent')[0]?.prompt).toBe('Ticket WEB-12: plan first');
  });

  it('lists the helper nodes in the planner’s brief, and the step nodes in the lead’s', () => {
    const g = valid({ planner: true, pool: false });
    const created = ok(createGraphRun(g));
    expect(effectsOf(created.effects, 'start-agent')[0]?.prompt).toContain(
      'Give every plan step the helper id',
    );
    const s = graphRunning(g, {}, [{ title: 'Toggle', role: 'UI', detail: '', helper: FRONTEND }]);
    expect(agentOf(s, PLANNER_ID).status).toBe('SUCCEEDED');
    expect(s.planStepHelpers).toBeDefined();
  });
});

describe('graph runs: named helpers', () => {
  it('resolves an explicit helper id, a label equal to the role, else the pool', () => {
    let s = graphRunning(valid({}));
    const a = start(s, { role: 'Anything', helper: FRONTEND }, 'fa');
    expect(agentOf(a.state, a.id).stage).toBe(FRONTEND);
    s = a.state;
    const b = start(s, { role: '  frontend   HELPER ' }, 'fb');
    expect(agentOf(b.state, b.id).stage).toBe(FRONTEND);
    s = b.state;
    const c = start(s, { role: 'Store' }, 'fc');
    expect(agentOf(c.state, c.id).stage).toBe(POOL);
  });

  it('refuses an unknown helper id and a role no node takes, listing the helper nodes', () => {
    const s = graphRunning(valid({ pool: false }), {}, [{ ...STEPS[0] }]);
    const unknown = tool(s, LEAD, 'start_agent', { role: 'UI', task: 'x', helper: 'backend' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.refusal.code).toBe('invalid-input');
      expect(unknown.refusal.message).toContain('There is no helper "backend"');
      expect(unknown.refusal.message).toContain('- Frontend helper (helper "frontend")');
    }
    const role = tool(s, LEAD, 'start_agent', { role: 'Store', task: 'x' });
    expect(role.ok).toBe(false);
    if (!role.ok) expect(role.refusal.message).toContain('no helper pool');
  });

  it('refuses a plan step no helper node can take, with the list', () => {
    const g = valid({ pool: false });
    let s = ok(createGraphRun(g)).state;
    s = ok(event(s, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
    const r = tool(s, LEAD, 'submit_plan', { summary: 'x', steps: STEPS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.message).toContain('Step "Store" has no helper node');
      expect(r.refusal.message).toContain('Frontend helper (helper "frontend")');
    }
    const fixed = tool(s, LEAD, 'submit_plan', {
      summary: 'x',
      steps: [{ ...STEPS[1], helper: FRONTEND }],
    });
    expect(fixed.ok).toBe(true);
  });

  it('holds each named helper to its maxInstances, on top of the run limit', () => {
    let s = graphRunning(valid({ maxInstances: 1 }));
    const a = start(s, { role: 'Frontend helper' }, 'fa');
    s = a.state;
    const second = tool(s, LEAD, 'start_agent', { role: 'Frontend helper', task: 'x' });
    expect(refused(second)).toBe('too-many-agents');
    // The pool still has room.
    s = start(s, { role: 'Store' }, 'fb').state;
    // Once the first one's turn ended, the node has room again.
    s = ok(finishTurn(s, a.id)).state;
    expect(tool(s, LEAD, 'start_agent', { role: 'Frontend helper', task: 'x' }).ok).toBe(true);
  });

  it('lets only nodes with canStartHelpers start helpers of their own', () => {
    const limits = { maxConcurrentHelpers: 4, maxDepth: 2 };
    let s = graphRunning(valid({ frontendCanStartHelpers: false }), { limits });
    const fe = start(s, { role: 'Frontend helper' }, 'fa');
    expect(effectsOf(fe.effects, 'start-agent')[0]?.canStartHelpers).toBeUndefined();
    s = fe.state;
    expect(refused(tool(s, fe.id, 'start_agent', { role: 'Sub', task: 'x' }))).toBe(
      'depth-exceeded',
    );
    const pool = start(s, { role: 'Store' }, 'fb');
    expect(effectsOf(pool.effects, 'start-agent')[0]?.canStartHelpers).toBe(true);
    // A pool helper's own helper belongs to the pool's node.
    const sub = ok(tool(pool.state, pool.id, 'start_agent', { role: 'Sub', task: 'x' }, 'sb'));
    expect(agentOf(sub.state, 'sb-1').stage).toBe(POOL);
  });
});

describe('graph runs: review routes', () => {
  it('route a: the lead reviews the change itself', () => {
    let s = graphRunning(valid({ route: 'lead' }));
    const a = start(s, { role: 'Frontend helper' }, 'fa');
    s = ok(done(a.state, a.id)).state;
    expect(changeOf(s, a.id)).toMatchObject({ state: 'reviewing', reviewer: 'lead' });
  });

  it('route b: a review agent of the reviewer node, then the lead decides', () => {
    let s = graphRunning(valid({ route: 'agent' }));
    const a = start(s, { role: 'Frontend helper' }, 'fa');
    const r = ok(done(a.state, a.id));
    s = r.state;
    expect(agentOf(s, 'rv-1')).toMatchObject({ kind: 'reviewer', stage: REVIEWER });
    s = ok(
      tool(s, 'rv-1', 'submit_review', { verdict: 'rework', findings: 'Fix it.' }, 'sr'),
    ).state;
    expect(changeOf(s, a.id).state).toBe('decision');
  });

  function directRun(o: GraphOptions = {}, run: GraphRunOptions = {}) {
    let s = graphRunning(valid({ route: 'direct', ...o }), run);
    const a = start(s, { role: 'Frontend helper' }, 'fa');
    s = ok(done(a.state, a.id)).state;
    return { s, id: a.id };
  }

  it('route c: the reviewer sends the change back itself and the lead is told', () => {
    const { s, id } = directRun();
    const r = ok(
      tool(s, 'rv-1', 'submit_review', { verdict: 'rework', findings: 'Handle empty.' }, 'sr'),
    );
    const change = changeOf(r.state, id);
    expect(change).toMatchObject({ state: 'rework', round: 1, reviewerRounds: 1 });
    expect(agentOf(r.state, id).status).toBe('STARTING');
    const rounds = effectsOf(r.effects, 'change-round');
    expect(rounds.at(-1)).toMatchObject({
      decision: 'rework',
      decidedBy: 'reviewer',
      reviewer: 'agent',
    });
    // The findings are the review agent's ticket comment; no second note.
    expect(effectsOf(r.effects, 'review-comment')).toHaveLength(1);
    expect(effectsOf(r.effects, 'change-comment')).toHaveLength(0);
    const launch = effectsOf(r.effects, 'start-agent')[0];
    expect(launch?.prompt).toContain('The review agent reviewed your change');
    expect(launch?.prompt).toContain('Handle empty.');
    const told = leadMessages(r.effects);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('back to it for rework (round 1 of 2)');
    expect(told[0]).not.toContain('Handle empty.');
  });

  it('route c: an approved change, or one out of reviewer rounds, goes to the lead', () => {
    const run = directRun({ reviewerRounds: 1 });
    const id = run.id;
    let s = run.s;
    s = ok(tool(s, 'rv-1', 'submit_review', { verdict: 'rework', findings: 'Again.' }, 'sr')).state;
    s = ok(
      event(s, id, { type: 'started', providerSessionId: `sess-${id}`, model: null }, 5200),
    ).state;
    s = ok(
      sealed(ok(finishTurn(s, id, 'success', 5400)).state, id, 'rw', true, 'abc1235', 5600),
    ).state;
    const second = changeOf(s, id).reviewerAgentRunId ?? '';
    const r = ok(tool(s, second, 'submit_review', { verdict: 'rework', findings: 'Still.' }, 'sx'));
    expect(changeOf(r.state, id)).toMatchObject({ state: 'decision', reviewerRounds: 1 });
    expect(leadMessages(r.effects)[0]).toContain('no rework round left');
    // The lead's own rounds are separate: it may still send it back.
    expect(checkChangeAction(r.state, id, 'rework', 'lead')).toBeNull();

    const fresh = directRun();
    const approved = ok(
      tool(fresh.s, 'rv-1', 'submit_review', { verdict: 'approve', findings: 'Good.' }, 'sr'),
    );
    expect(changeOf(approved.state, fresh.id).state).toBe('decision');
  });

  it('the lead’s rework is limited by its own rounds; the owner can still grant one', () => {
    const { s, id } = directRun({ leadRounds: null });
    const d = ok(
      tool(s, 'rv-1', 'submit_review', { verdict: 'approve', findings: 'Ok.' }, 'sr'),
    ).state;
    expect(checkChangeAction(d, id, 'rework', 'lead')?.code).toBe('rework-limit');
    const asked = ok(tool(d, LEAD, 'ask_owner', { agentId: id, question: 'Rework?' }, 'ao')).state;
    const r = recordChangeDecision(
      asked,
      id,
      { decision: 'rework', by: 'owner', comments: 'One more.' },
      makeCtx(8000),
    );
    expect(changeOf(ok(r).state, id).round).toBe(1);
  });

  it('the run’s reviewer override sends every change to the lead', () => {
    let s = graphRunning(valid({ route: 'direct' }), { reviewer: 'lead' });
    const a = start(s, { role: 'Frontend helper' }, 'fa');
    s = ok(done(a.state, a.id)).state;
    expect(changeOf(s, a.id)).toMatchObject({ state: 'reviewing', reviewer: 'lead' });
  });

  it('a tester’s change follows the tester node’s route', () => {
    const g = valid({ route: 'direct', finals: ['tester'] });
    const tester = programOf({
      graph: g,
      graphContext: { projectMode: 'manual', approvalCeilings: [], maxConcurrentHelpers: 3 },
    }).finalStages[0];
    expect(tester?.type === 'tester' ? tester.review : null).toMatchObject({
      by: 'agent',
      then: 'direct',
    });
  });
});

describe('graph runs: approval modes per agent', () => {
  const approvals = { mode: 'full-auto' as const, commands: [] };

  it('gives each editing agent its node’s mode; the lead and reviewers none', () => {
    const g = valid({ frontendMode: 'manual', poolMode: null, route: 'agent' });
    let s = graphRunning(g, { approvals });
    const fe = start(s, { role: 'Frontend helper' }, 'fa');
    s = fe.state;
    const pool = start(s, { role: 'Store' }, 'fb');
    s = pool.state;
    expect(effectiveMode(s, agentOf(s, fe.id))).toBe('manual');
    expect(effectiveMode(s, agentOf(s, pool.id))).toBe('full-auto');
    expect(effectiveMode(s, agentOf(s, LEAD))).toBeUndefined();
    expect(agentLaunchMode(s, agentOf(s, LEAD))).toEqual({ autoMode: false, sandbox: false });
    expect(effectsOf(fe.effects, 'start-agent')[0]?.autoMode).toBeUndefined();
    expect(effectsOf(pool.effects, 'start-agent')[0]).toMatchObject({
      autoMode: true,
      sandbox: true,
    });
    // The engine re-checks a pre-approval against the agent's own mode.
    const verdict = { allowed: true as const, rule: 'edit-in-own-worktree' as const };
    const ask = (id: string) =>
      ok(
        requestPermission(
          s,
          { agentRunId: id, toolName: 'Edit', toolUseId: `t-${id}`, summary: 'Edit' },
          makeCtx(3000, `ap-${id}`),
          { allowlist: verdict },
        ),
      ).value.status;
    expect(ask(fe.id)).toBe('pending');
    expect(ask(pool.id)).toBe('approved');
  });

  it('a ticket ceiling tightens a Full auto node but keeps its sandbox', () => {
    const g = valid({ poolMode: 'full-auto', named: false });
    let s = graphRunning(g, {
      approvals: { mode: 'manual', commands: [] },
      ceilings: ['auto-edits'],
    });
    const pool = start(s, { role: 'Store' }, 'fb');
    s = pool.state;
    expect(agentLaunchMode(s, agentOf(s, pool.id))).toEqual({
      mode: 'auto-edits',
      autoMode: false,
      sandbox: true,
    });
    expect(effectsOf(pool.effects, 'start-agent')[0]).toMatchObject({ sandbox: true });
    expect(effectsOf(pool.effects, 'start-agent')[0]?.autoMode).toBeUndefined();
  });
});

describe('graph runs: plan auto-approval follows the plan gate', () => {
  function submitted(o: GraphOptions, run: GraphRunOptions) {
    let s = ok(createGraphRun(valid(o), run)).state;
    s = ok(event(s, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
    return ok(tool(s, LEAD, 'submit_plan', { summary: 'x', steps: STEPS }, 'p'));
  }
  const fullAuto = { approvals: { mode: 'full-auto' as const, commands: [] } };

  it('approves the plan when the gate is automatic and nothing tightens it', () => {
    const r = submitted({ planAuto: true }, {});
    expect(r.state.run.status).toBe('RUNNING');
    expect(r.state.plans?.[0]?.decidedBy).toBe('auto');
  });

  it('asks the owner when the gate asks, even in a Full auto project', () => {
    expect(submitted({ planAuto: false }, fullAuto).state.run.status).toBe('PLAN_REVIEW');
  });

  it('asks the owner when a ticket or run mode is stricter than Full auto', () => {
    const r = submitted({ planAuto: true }, { ...fullAuto, ceilings: ['auto'] });
    expect(r.state.run.status).toBe('PLAN_REVIEW');
    const ok2 = submitted({ planAuto: true }, { ...fullAuto, ceilings: ['full-auto'] });
    expect(ok2.state.run.status).toBe('RUNNING');
  });
});

describe('deriveRunWorkflowGraph', () => {
  it('gives every node a state, its agents, and editing nodes their mode', () => {
    const g = valid({ frontendMode: 'manual', route: 'agent' });
    let s = graphRunning(g, { approvals: { mode: 'auto-edits', commands: [] } });
    const a = start(s, { role: 'Frontend helper' }, 'fa');
    s = a.state;
    const view = deriveRunWorkflowGraph(s);
    expect(view.nodes.map((n) => n.nodeId)).toEqual(g.nodes.map((n) => n.id));
    const byId = new Map(view.nodes.map((n) => [n.nodeId, n]));
    expect(byId.get(FRONTEND)).toMatchObject({
      state: 'active',
      agentRunIds: [a.id],
      approvalMode: 'manual',
      sandbox: false,
    });
    expect(byId.get(POOL)).toMatchObject({ state: 'waiting', approvalMode: 'auto-edits' });
    expect(byId.get('plan-approval')?.state).toBe('done');
    expect(byId.get('orchestrate')).toMatchObject({ state: 'active', agentRunIds: [LEAD] });
    expect(byId.get(REVIEWER)?.state).toBe('waiting');
    expect(byId.get('owner-merge')?.state).toBe('waiting');
    expect(view.review).toBeDefined();
    s = ok(done(s, a.id)).state;
    expect(
      new Map(deriveRunWorkflowGraph(s).nodes.map((n) => [n.nodeId, n])).get(REVIEWER),
    ).toMatchObject({ state: 'active', agentRunIds: ['rv-1'] });
  });
});
