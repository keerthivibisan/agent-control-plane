// compileWorkflow (ADR-0023 §4, README §3, WG-0 refinements 3 and 5–7): review routes a, b and c,
// the ticket and run overrides, per-node modes and the sandbox, plan auto-approval, the pool's
// limit, helper and final stage order, and "compile throws exactly when the validator has
// errors". Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  WorkflowGraphInvalidError,
  compileWorkflow,
  validateWorkflowGraph,
  type CompileContext,
  type WorkflowGraph,
} from '../../src/index.js';
import {
  base,
  e,
  finalReviewer,
  mapNode,
  rw,
  tester,
  withEdges,
  withFinalChain,
  withNamedHelper,
  withoutEdges,
} from './helpers.js';

const ctx: CompileContext = {
  projectMode: 'auto-edits',
  approvalCeilings: [],
  maxConcurrentHelpers: 3,
};

function routeOf(graph: WorkflowGraph, id: string, c: CompileContext = ctx) {
  const program = compileWorkflow(graph, c);
  const helper = program.helpers.find((h) => h.id === id);
  const stage = program.finalStages.find((s) => s.id === id);
  return helper?.review ?? (stage?.type === 'tester' ? stage.review : undefined);
}

describe('review routes', () => {
  it('(a) lead-only: the lead reviews, with its rework edge’s rounds', () => {
    expect(routeOf(base('lead-only'), 'helpers')).toEqual({ by: 'lead', leadRounds: 2 });
    const noRework = withoutEdges(base('lead-only'), 'rework-orchestrate-helpers');
    expect(routeOf(noRework, 'helpers')).toEqual({ by: 'lead', leadRounds: 0 });
  });

  it('(b) todays-setup: the reviewer’s findings go to the lead, which decides', () => {
    const program = compileWorkflow(base('todays-setup'), ctx);
    expect(program.helpers[0]?.review).toEqual({
      by: 'agent',
      reviewer: 'review',
      then: 'lead',
      leadRounds: 2,
    });
    expect(program.changeReviewers.map((r) => r.id)).toEqual(['review']);
  });

  it('(c) reviewer-helper-loop: the reviewer reworks the helper directly', () => {
    expect(routeOf(base('reviewer-helper-loop'), 'helpers')).toEqual({
      by: 'agent',
      reviewer: 'review',
      then: 'direct',
      reviewerRounds: 2,
      leadRounds: 0,
    });
    const withLead = withEdges(base('reviewer-helper-loop'), rw('orchestrate', 'helpers', 3));
    expect(routeOf(withLead, 'helpers')).toMatchObject({ then: 'direct', leadRounds: 3 });
  });

  it('gives a tester its own review route', () => {
    let g = withFinalChain(base('todays-setup'), [tester('tests')]);
    g = withEdges(g, e('review', 'tests', 'orchestrate'), rw('orchestrate', 'tests', 1));
    expect(routeOf(g, 'tests')).toEqual({ by: 'lead', leadRounds: 1 });
    expect(routeOf(g, 'helpers')).toMatchObject({ by: 'agent', then: 'lead' });
  });
});

describe('overrides', () => {
  const mixed = withNamedHelper(base('reviewer-helper-loop'), 'fe', 'Frontend helper');

  it('reviewer "lead" sends every change to the lead, with the lead rework edge’s rounds', () => {
    const g = withEdges(mixed, rw('orchestrate', 'fe', 4));
    const program = compileWorkflow(g, { ...ctx, reviewer: 'lead' });
    expect(program.helpers.map((h) => [h.id, h.review])).toEqual([
      ['fe', { by: 'lead', leadRounds: 4 }],
      // no lead rework edge to the pool: 0 rounds
      ['helpers', { by: 'lead', leadRounds: 0 }],
    ]);
    expect(program.changeReviewers).toEqual([]);
  });

  it('reviewer "lead" with maxReworkRounds uses the override everywhere', () => {
    const program = compileWorkflow(mixed, { ...ctx, reviewer: 'lead', maxReworkRounds: 5 });
    expect(program.helpers.map((h) => h.review)).toEqual([
      { by: 'lead', leadRounds: 5 },
      { by: 'lead', leadRounds: 5 },
    ]);
  });

  it('reviewer "agent" changes nothing', () => {
    expect(compileWorkflow(mixed, { ...ctx, reviewer: 'agent' })).toEqual(
      compileWorkflow(mixed, ctx),
    );
  });

  it('maxReworkRounds replaces every existing rework edge’s rounds and adds none', () => {
    const c = { ...ctx, maxReworkRounds: 4 };
    expect(routeOf(base('todays-setup'), 'helpers', c)).toMatchObject({ leadRounds: 4 });
    expect(routeOf(base('reviewer-helper-loop'), 'helpers', c)).toEqual({
      by: 'agent',
      reviewer: 'review',
      then: 'direct',
      reviewerRounds: 4,
      leadRounds: 0,
    });
    expect(routeOf(base('lead-only'), 'helpers', { ...ctx, maxReworkRounds: 0 })).toEqual({
      by: 'lead',
      leadRounds: 0,
    });
  });
});

describe('approval modes and plan auto-approval', () => {
  let g = withNamedHelper(base('lead-only'), 'fe', 'Frontend helper');
  g = mapNode(g, 'fe', (n) => ({ ...n, approvalMode: 'full-auto' }) as typeof n);
  g = withFinalChain(g, [tester('tests')]);
  g = withEdges(g, e('review', 'tests', 'orchestrate'));
  g = mapNode(g, 'tests', (n) => ({ ...n, approvalMode: 'manual' }) as typeof n);

  it('uses the node’s mode, else the project’s, for every editing node', () => {
    const program = compileWorkflow(g, ctx);
    expect({ ...program.nodeModes }).toEqual({
      fe: { mode: 'full-auto', sandbox: true },
      helpers: { mode: 'auto-edits', sandbox: false },
      tests: { mode: 'manual', sandbox: false },
    });
    expect(program.helpers.map((h) => h.mode)).toEqual([
      program.nodeModes.fe,
      program.nodeModes.helpers,
    ]);
  });

  it('tightens with the ceilings and keeps the sandbox of a Full auto node', () => {
    const program = compileWorkflow(g, { ...ctx, approvalCeilings: ['auto', 'manual'] });
    expect(program.nodeModes.fe).toEqual({ mode: 'manual', sandbox: true });
    expect(program.nodeModes.helpers).toEqual({ mode: 'manual', sandbox: false });
    // a ceiling never loosens
    const looser = compileWorkflow(g, { ...ctx, approvalCeilings: ['full-auto'] });
    expect(looser.nodeModes.helpers).toEqual({ mode: 'auto-edits', sandbox: false });
    // a Full auto project gives the sandbox to nodes without their own mode
    const fullAuto = compileWorkflow(g, {
      ...ctx,
      projectMode: 'full-auto',
      approvalCeilings: ['auto'],
    });
    expect(fullAuto.nodeModes.helpers).toEqual({ mode: 'auto', sandbox: true });
  });

  it('approves plans automatically only when the gate is auto and every ceiling is Full auto', () => {
    const auto = mapNode(g, 'plan-approval', (n) => ({ ...n, auto: true }) as typeof n);
    expect(compileWorkflow(g, ctx).planAutoApprove).toBe(false);
    expect(compileWorkflow(auto, ctx).planAutoApprove).toBe(true);
    expect(compileWorkflow(auto, { ...ctx, approvalCeilings: ['full-auto'] }).planAutoApprove).toBe(
      true,
    );
    expect(
      compileWorkflow(auto, { ...ctx, approvalCeilings: ['full-auto', 'auto'] }).planAutoApprove,
    ).toBe(false);
  });
});

describe('program shape', () => {
  it('lists named helpers in graph order, then the pool with the project’s limit', () => {
    let g = withNamedHelper(base('lead-only'), 'zz', 'Second in graph? no, first');
    g = withNamedHelper(g, 'aa', 'Docs helper');
    const program = compileWorkflow(g, { ...ctx, maxConcurrentHelpers: 5 });
    expect(program.helpers.map((h) => [h.id, h.type, h.maxInstances])).toEqual([
      ['zz', 'helper', 1],
      ['aa', 'helper', 1],
      ['helpers', 'helper-pool', 5],
    ]);
    expect(program.helpers[2]?.description).toBe('');
    expect(program.helpers[0]?.description).toBe('Second in graph? no, first work');
  });

  it('lists final stages in chain order, not node order', () => {
    const t = tester('tests');
    const r = finalReviewer('final');
    // nodes: tester before reviewer; chain: reviewer then tester
    let g = withFinalChain(base('lead-only'), [r, t]);
    g = { ...g, nodes: [...g.nodes.filter((n) => n.id !== 'final'), r] };
    g = withEdges(g, e('review', 'tests', 'orchestrate'));
    const program = compileWorkflow(g, ctx);
    expect(program.finalStages.map((s) => [s.id, s.type])).toEqual([
      ['final', 'reviewer'],
      ['tests', 'tester'],
    ]);
  });

  it('copies launch fields: label, kind, model, skills and agent file', () => {
    let g = mapNode(
      base('todays-setup', true),
      'plan',
      (n) => ({ ...n, model: 'opus', skills: ['plan-well'] }) as typeof n,
    );
    g = mapNode(g, 'review', (n) => ({ ...n, agent: 'strict-review' }) as typeof n);
    const program = compileWorkflow(g, ctx);
    expect(program.planner).toEqual({
      id: 'plan',
      type: 'planner',
      kind: 'planner',
      label: 'Planner',
      model: 'opus',
      skills: ['plan-well'],
      agent: null,
    });
    expect(program.lead).toMatchObject({ id: 'orchestrate', kind: 'lead', model: null });
    expect(program.changeReviewers[0]).toMatchObject({ kind: 'reviewer', agent: 'strict-review' });
    expect(program.helpers[0]).toMatchObject({ kind: 'worker', canStartHelpers: true });
    // the program never shares arrays with the graph
    const planner = g.nodes.find((n) => n.id === 'plan');
    expect(planner?.type === 'planner' && program.planner?.skills !== planner.skills).toBe(true);
    expect(compileWorkflow(base(), ctx).planner).toBeNull();
  });
});

describe('compile and the validator agree', () => {
  it('throws WorkflowGraphInvalidError with the validator’s errors (no warnings)', () => {
    const broken = withoutEdges(base('todays-setup'), 'findings-review-orchestrate');
    const errs = validateWorkflowGraph(broken).filter((i) => i.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
    let thrown: unknown;
    try {
      compileWorkflow(broken, { ...ctx, projectMode: 'full-auto' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WorkflowGraphInvalidError);
    const error = thrown as WorkflowGraphInvalidError;
    expect(error.code).toBe('workflow_invalid');
    expect(error.issues).toEqual(errs);
    expect(error.message).toContain('reviewer-no-findings');
  });

  it('compiles a graph that has only warnings', () => {
    const g = mapNode(base(), 'plan-approval', (n) => ({ ...n, auto: true }) as typeof n);
    expect(validateWorkflowGraph(g, { projectMode: 'manual' }).map((i) => i.severity)).toEqual([
      'warning',
    ]);
    expect(() => compileWorkflow(g, { ...ctx, projectMode: 'manual' })).not.toThrow();
  });

  it('is pure: the same graph and context give the same program', () => {
    const g = base('reviewer-helper-loop', true);
    const before = JSON.stringify(g);
    expect(compileWorkflow(g, ctx)).toEqual(compileWorkflow(g, ctx));
    expect(JSON.stringify(g)).toBe(before);
  });
});
