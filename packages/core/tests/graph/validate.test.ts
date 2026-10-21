// validateWorkflowGraph: one named test per rule, each with a valid and an invalid example
// (ADR-0023 §3, README §2 and the WG-0 refinements). Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  GraphIssueSchema,
  HARD_MAX_HELPERS,
  RESERVED_HELPER_LABELS,
  validateWorkflowGraph,
  type WorkflowGraph,
} from '../../src/index.js';
import {
  AGENT,
  base,
  changeReviewer,
  containing,
  e,
  errorCodes,
  errors,
  finalReviewer,
  mapNode,
  namedHelper,
  rw,
  tester,
  warnings,
  withEdges,
  withFinalChain,
  withNamedHelper,
  withNodes,
  withoutEdges,
  withoutNode,
} from './helpers.js';

/** Route (b): the pool's change goes to a reviewer, whose findings go to the lead. */
const routeB = base('todays-setup');
/** Route (c): the reviewer reworks the pool directly. */
const routeC = base('reviewer-helper-loop');

describe('valid graphs', () => {
  it('accepts every template, with and without a planner, with no issue at all', () => {
    for (const id of ['lead-only', 'todays-setup', 'reviewer-helper-loop'] as const) {
      for (const planner of [false, true]) {
        expect(validateWorkflowGraph(base(id, planner), { projectMode: 'auto-edits' })).toEqual([]);
      }
    }
  });

  it('accepts named helpers, a tester and a final reviewer on the chain', () => {
    let g = withNamedHelper(routeB, 'frontend', 'Frontend helper', 'review');
    g = withNamedHelper(g, 'docs', 'Docs helper');
    const t = tester('tests');
    g = withFinalChain(g, [finalReviewer('final'), t]);
    g = withEdges(g, e('review', 'tests', 'review'), rw('review', 'tests', 1));
    expect(errors(g)).toEqual([]);
  });

  it('returns issues that satisfy GraphIssueSchema', () => {
    const broken = withoutNode(withoutEdges(routeB, 'findings-review-orchestrate'), 'done');
    const issues = validateWorkflowGraph(broken);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(GraphIssueSchema.parse(issue)).toEqual(issue);
  });
});

describe('shape rules', () => {
  it('duplicate-node-id: two blocks with one id', () => {
    const g = withNodes(routeB, { type: 'done', id: 'done', label: 'Done again' });
    expect(errors(g).find((i) => i.code === 'duplicate-node-id')).toMatchObject({
      nodeId: 'done',
      message: containing('"Done again"'),
    });
  });

  it('duplicate-edge-id: two links with one id', () => {
    const g = withEdges(routeB, {
      type: 'rework',
      id: 'merge-orchestrate-checks',
      from: 'review',
      to: 'helpers',
      maxRounds: 1,
    });
    expect(errors(g).find((i) => i.code === 'duplicate-edge-id')).toMatchObject({
      edgeId: 'merge-orchestrate-checks',
    });
  });

  it('edge codes: every stored edge is checked like a drag, in order, and reported once', () => {
    const g = withEdges(
      routeB,
      { type: 'flow', id: 'bad-flow', from: 'helpers', to: 'checks' },
      { type: 'merge', id: 'ghost', from: 'orchestrate', to: 'nowhere' },
      { type: 'rework', id: 'self', from: 'orchestrate', to: 'orchestrate', maxRounds: 1 },
      { type: 'review', id: 'dup', from: 'helpers', to: 'review' },
    );
    const edgeIssues = errors(g).filter((i) => i.edgeId !== undefined);
    expect(edgeIssues.map((i) => [i.edgeId, i.code])).toEqual([
      ['bad-flow', 'edge-not-allowed'],
      ['ghost', 'edge-unknown-node'],
      ['self', 'self-edge'],
      ['dup', 'duplicate-edge'],
    ]);
    // the duplicate review edge is not counted again as a second review route
    expect(errorCodes(g)).not.toContain('many-review-routes');
  });
});

describe('count rules', () => {
  it('missing-node: every required gate and the lead', () => {
    for (const id of [
      'ticket',
      'plan-approval',
      'orchestrate',
      'checks',
      'ticket-merge',
      'owner-merge',
      'done',
    ]) {
      expect(errorCodes(withoutNode(routeB, id))).toContain('missing-node');
    }
    expect(errorCodes(routeB)).not.toContain('missing-node');
    const lead = errors(withoutNode(routeB, 'orchestrate')).find((i) => i.code === 'missing-node');
    expect(lead?.message).toBe('The workflow needs a Lead block.');
  });

  it('too-many-nodes: a second lead, planner, pool or gate', () => {
    const g = withNodes(routeB, {
      type: 'lead',
      id: 'lead-2',
      label: 'Other lead',
      ...AGENT,
      skills: [],
    });
    expect(errors(g).find((i) => i.code === 'too-many-nodes')).toMatchObject({ nodeId: 'lead-2' });
    const pool2 = withNodes(routeB, {
      type: 'helper-pool',
      id: 'pool-2',
      label: 'More',
      ...AGENT,
      skills: [],
      approvalMode: null,
      canStartHelpers: false,
    });
    expect(errorCodes(pool2)).toContain('too-many-nodes');
    const testers = withNodes(routeB, tester('t1'), tester('t2'), tester('t3'));
    expect(errors(testers).find((i) => i.code === 'too-many-nodes')?.nodeId).toBe('t3');
  });

  it('no-helpers: neither a pool nor a named helper', () => {
    const g = withoutNode(base('lead-only'), 'helpers');
    expect(errorCodes(g)).toContain('no-helpers');
    expect(errorCodes(withNamedHelper(g, 'api', 'API helper'))).toEqual([]);
  });

  it('too-many-helpers: more named helpers than HARD_MAX_HELPERS', () => {
    let g = base('lead-only');
    for (let k = 1; k <= HARD_MAX_HELPERS; k++)
      g = withNamedHelper(g, `h${k}`, `Helper number ${k}`);
    expect(errorCodes(g)).toEqual([]);
    g = withNamedHelper(g, 'h-extra', 'One too many');
    expect(errors(g).find((i) => i.code === 'too-many-helpers')).toMatchObject({
      nodeId: 'h-extra',
    });
  });

  it('duplicate-helper-label: compared trimmed and ignoring case', () => {
    let g = withNamedHelper(base(), 'fe', 'Frontend helper');
    g = withNamedHelper(g, 'fe2', '  frontend   HELPER ');
    expect(errors(g).find((i) => i.code === 'duplicate-helper-label')).toMatchObject({
      nodeId: 'fe2',
    });
    // the pool's label is not a named helper's
    expect(errorCodes(withNamedHelper(base(), 'x', 'Helpers2'))).toEqual([]);
  });

  it('reserved-helper-label: a coordinator or role word', () => {
    for (const word of RESERVED_HELPER_LABELS) {
      const g = withNamedHelper(base(), 'named', word.toUpperCase());
      expect(errorCodes(g)).toEqual(['reserved-helper-label']);
    }
    expect(errorCodes(withNamedHelper(base(), 'named', 'Lead designer'))).toEqual([]);
  });
});

describe('path rules', () => {
  it('plan-path: ticket → lead → plan approval without a planner', () => {
    const g = withoutEdges(base(), 'flow-orchestrate-plan-approval');
    expect(errors(g).find((i) => i.code === 'plan-path')).toMatchObject({
      nodeId: 'orchestrate',
      message: containing('from "Lead" to "Plan approval"'),
    });
  });

  it('plan-path: ticket → planner → plan approval → lead with a planner', () => {
    const g = base('lead-only', true);
    expect(errorCodes(g)).toEqual([]);
    for (const id of [
      'flow-ticket-plan',
      'flow-plan-plan-approval',
      'flow-plan-approval-orchestrate',
    ]) {
      expect(errorCodes(withoutEdges(g, id))).toContain('plan-path');
    }
    // a planner added without rewiring: the old lead plan path is refused and the new one is missing
    const added = withNodes(base(), {
      type: 'planner',
      id: 'plan',
      label: 'Planner',
      ...AGENT,
      skills: [],
    });
    expect(errorCodes(added)).toEqual(expect.arrayContaining(['edge-not-allowed', 'plan-path']));
  });

  it('no-review-route: every helper, pool and tester needs one', () => {
    expect(
      errors(withoutEdges(base(), 'review-helpers-orchestrate', 'rework-orchestrate-helpers')),
    ).toMatchObject([{ code: 'no-review-route', nodeId: 'helpers' }]);
    const t = withFinalChain(base(), [tester('tests')]);
    expect(errors(t)).toMatchObject([{ code: 'no-review-route', nodeId: 'tests' }]);
    expect(errorCodes(withEdges(t, e('review', 'tests', 'orchestrate')))).toEqual([]);
  });

  it('many-review-routes: exactly one route per editing node', () => {
    const g = withEdges(routeB, e('review', 'helpers', 'orchestrate'));
    expect(errors(g)).toMatchObject([{ code: 'many-review-routes', nodeId: 'helpers' }]);
  });

  it('reviewer-no-findings: a change reviewer must send findings to the lead', () => {
    const g = withoutEdges(routeC, 'findings-review-orchestrate');
    expect(errorCodes(g)).toEqual(['reviewer-no-findings']);
    // with a lead rework edge, the lead no longer sees the review either
    const b = withoutEdges(routeB, 'findings-review-orchestrate');
    expect(errorCodes(b)).toEqual(['reviewer-no-findings', 'rework-without-review']);
  });

  it('reviewer-unused: a change reviewer nothing reviews to', () => {
    const g = withEdges(
      withNodes(routeB, changeReviewer('idle')),
      e('findings', 'idle', 'orchestrate'),
    );
    // nothing links to it, so it is unreachable too
    expect(errors(g)).toMatchObject([
      { code: 'reviewer-unused', nodeId: 'idle' },
      { code: 'unreachable', nodeId: 'idle' },
    ]);
  });

  it('rework-without-review: a reviewer reworks only what it reviews', () => {
    let g = withEdges(
      withNodes(routeB, changeReviewer('other')),
      e('findings', 'other', 'orchestrate'),
    );
    g = withNamedHelper(g, 'fe', 'Frontend helper', 'other');
    expect(errorCodes(withEdges(g, rw('other', 'fe', 2)))).toEqual([]);
    const wrong = rw('other', 'helpers', 2);
    expect(errors(withEdges(g, wrong))).toMatchObject([
      { code: 'rework-without-review', edgeId: wrong.id },
    ]);
  });

  it('rework-without-review: the lead reworks what it reviews or gets findings for', () => {
    // route (a): lead-reviewed; route (b): the reviewer sends findings to the lead
    expect(errorCodes(base('lead-only'))).toEqual([]);
    expect(errorCodes(routeB)).toEqual([]);
    expect(errorCodes(withEdges(routeC, rw('orchestrate', 'helpers', 1)))).toEqual([]);
  });

  it('not-assigned: the lead must assign every helper block', () => {
    const g = withoutEdges(base(), 'assigns-orchestrate-helpers');
    expect(errors(g).find((i) => i.code === 'not-assigned')).toMatchObject({ nodeId: 'helpers' });
    const named = withEdges(
      withNodes(base(), namedHelper('fe', 'Frontend helper')),
      e('review', 'fe', 'orchestrate'),
    );
    expect(errorCodes(named)).toEqual(['not-assigned', 'unreachable']);
  });

  it('merge-path: the lead merges through the checks into the ticket merge', () => {
    expect(
      errors(withoutEdges(routeB, 'merge-orchestrate-checks')).find((i) => i.code === 'merge-path'),
    ).toMatchObject({
      nodeId: 'orchestrate',
    });
    expect(
      errors(withoutEdges(routeB, 'flow-checks-ticket-merge')).find((i) => i.code === 'merge-path'),
    ).toMatchObject({
      nodeId: 'checks',
    });
  });

  it('final-chain: one line from the ticket merge through final stages to your merge, then done', () => {
    const r = finalReviewer('final');
    const ok = withFinalChain(routeB, [r]);
    expect(errorCodes(ok)).toEqual([]);
    // branching: the ticket merge has two next steps
    const branch = withEdges(
      withNodes(ok, finalReviewer('final-2', 'Second')),
      e('flow', 'ticket-merge', 'final-2'),
      e('flow', 'final-2', 'owner-merge'),
    );
    expect(errors(branch).find((i) => i.code === 'final-chain')).toMatchObject({
      nodeId: 'ticket-merge',
    });
    // a final reviewer off the chain
    const off = withNodes(routeB, finalReviewer('lost', 'Lost reviewer'));
    expect(errors(off).find((i) => i.code === 'final-chain')).toMatchObject({
      nodeId: 'lost',
      message: containing('"Lost reviewer" is not on the line'),
    });
    // your merge must lead to done
    expect(
      errors(withoutEdges(routeB, 'flow-owner-merge-done')).find((i) => i.code === 'final-chain'),
    ).toMatchObject({
      nodeId: 'owner-merge',
    });
    // a cut chain: your merge and done are no longer reached
    expect(errorCodes(withoutEdges(routeB, 'flow-ticket-merge-owner-merge'))).toEqual([
      'final-chain',
      'unreachable',
      'unreachable',
    ]);
  });

  it('cycle: flow and merge links never go round; the change loop is not a cycle', () => {
    let g = withFinalChain(routeB, [
      finalReviewer('a', 'Reviewer A'),
      finalReviewer('b', 'Reviewer B'),
    ]);
    expect(errorCodes(g)).toEqual([]);
    g = withEdges(g, e('flow', 'b', 'a'));
    const cycle = errors(g).find((i) => i.code === 'cycle');
    expect(cycle).toMatchObject({
      nodeId: 'a',
      message: containing('"Reviewer A", "Reviewer B"'),
    });
    // review → findings → assigns, and rework, go back to the helper by design
    expect(errorCodes(routeC)).toEqual([]);
  });

  it('unreachable: every block is reachable from the ticket', () => {
    const g = withNodes(routeB, finalReviewer('island', 'Island'));
    expect(errors(g).find((i) => i.code === 'unreachable')).toMatchObject({ nodeId: 'island' });
    expect(errorCodes(routeB)).not.toContain('unreachable');
  });
});

describe('warnings', () => {
  const g = mapNode(
    base(),
    'helpers',
    (n) => ({ ...n, skills: ['tdd', 'react'], agent: 'frontend-dev' }) as typeof n,
  );

  it('missing-skill and missing-agent-file only when the project lists are given', () => {
    expect(warnings(g)).toEqual([]);
    expect(warnings(g, { skills: ['tdd'], agents: [] })).toMatchObject([
      { code: 'missing-skill', nodeId: 'helpers', message: containing('"react"') },
      { code: 'missing-agent-file', nodeId: 'helpers' },
    ]);
    expect(warnings(g, { skills: ['tdd', 'react'], agents: ['frontend-dev'] })).toEqual([]);
  });

  it('full-auto-plan-manual: an editing node in Full auto while the plan gate asks', () => {
    expect(warnings(base(), { projectMode: 'full-auto' })).toMatchObject([
      { code: 'full-auto-plan-manual', nodeId: 'helpers' },
    ]);
    const own = mapNode(
      base(),
      'helpers',
      (n) => ({ ...n, approvalMode: 'full-auto' }) as typeof n,
    );
    expect(warnings(own).map((w) => w.code)).toEqual(['full-auto-plan-manual']);
  });

  it('plan-auto-without-full-auto: the gate is automatic but nothing runs in Full auto', () => {
    const auto = mapNode(base(), 'plan-approval', (n) => ({ ...n, auto: true }) as typeof n);
    expect(warnings(auto, { projectMode: 'auto-edits' })).toMatchObject([
      { code: 'plan-auto-without-full-auto', nodeId: 'plan-approval' },
    ]);
    expect(warnings(auto, { projectMode: 'full-auto' })).toEqual([]);
    // the project mode unknown and the node uses it: no guess, no warning
    expect(warnings(auto)).toEqual([]);
  });

  it('instances-over-limit: a named helper allowing more than the project limit', () => {
    const many = withNamedHelper(base(), 'fe', 'Frontend helper');
    const g2 = mapNode(many, 'fe', (n) => ({ ...n, maxInstances: 4 }) as typeof n);
    expect(warnings(g2)).toEqual([]);
    expect(warnings(g2, { maxConcurrentHelpers: 4 })).toEqual([]);
    expect(warnings(g2, { maxConcurrentHelpers: 3 })).toMatchObject([
      { code: 'instances-over-limit', nodeId: 'fe' },
    ]);
  });

  it('warnings never block: a graph with only warnings has no errors', () => {
    expect(errors(g, { skills: [], agents: [], projectMode: 'full-auto' })).toEqual([]);
  });
});

describe('order', () => {
  it('is deterministic and fixed: edges, counts, paths, then warnings', () => {
    const broken: WorkflowGraph = withEdges(
      withNodes(routeB, finalReviewer('lost')),
      { type: 'flow', id: 'bad', from: 'helpers', to: 'checks' },
      { type: 'review', id: 'second', from: 'helpers', to: 'orchestrate' },
    );
    const ctx = { projectMode: 'full-auto' as const };
    const first = validateWorkflowGraph(broken, ctx);
    expect(validateWorkflowGraph(JSON.parse(JSON.stringify(broken)) as WorkflowGraph, ctx)).toEqual(
      first,
    );
    expect(first.map((i) => i.code)).toEqual([
      'edge-not-allowed',
      'many-review-routes',
      'final-chain',
      'unreachable',
      'full-auto-plan-manual',
    ]);
  });
});
