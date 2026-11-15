import { describe, expect, it } from 'vitest';
import {
  WorkflowGraphV3Schema,
  compileWorkflowV3,
  describeWorkflow,
  downgradeWorkflowV3,
  skippingTicketTypes,
  specialiseForTicket,
  validateWorkflowGraphV3,
  workflowTemplateV3,
  type CompileContext,
  type TicketType,
  type WorkflowGraphV3,
  type WorkflowNodeV3,
} from '../../../src/index.js';

/*
 * ADR-0039: blocks that run only for some ticket types, and the BDD template built on them.
 */

const ctx: CompileContext = {
  projectMode: 'auto-edits',
  approvalCeilings: [],
  maxConcurrentHelpers: 3,
};
const TYPES: readonly TicketType[] = ['feature', 'bug', 'chore', 'harness'];

const ids = (g: WorkflowGraphV3) => g.nodes.map((n) => n.id);
const errors = (g: WorkflowGraphV3) =>
  validateWorkflowGraphV3(g, { projectMode: 'auto-edits' }).filter((i) => i.severity === 'error');

function withTypes(g: WorkflowGraphV3, types: Record<string, TicketType[]>): WorkflowGraphV3 {
  return WorkflowGraphV3Schema.parse({
    ...g,
    nodes: g.nodes.map((n: WorkflowNodeV3) =>
      n.type === 'agent' && types[n.id] !== undefined ? { ...n, ticketTypes: types[n.id] } : n,
    ),
  });
}

describe('specialiseForTicket', () => {
  it('returns a graph without ticket types unchanged', () => {
    const g = workflowTemplateV3('lead-only');
    expect(specialiseForTicket(g, 'bug')).toEqual({ graph: g, skipped: [] });
    expect(skippingTicketTypes(g)).toEqual([]);
  });

  it('keeps a block for its own types and drops it with every arrow for the others', () => {
    const g = workflowTemplateV3('bdd');
    const feature = specialiseForTicket(g, 'feature');
    expect(feature.skipped).toEqual([]);
    expect(feature.graph).toBe(g);
    const bug = specialiseForTicket(g, 'bug');
    expect(bug.skipped.map((n) => n.id)).toEqual(['behaviour', 'scenario-tests']);
    expect(ids(bug.graph)).not.toContain('behaviour');
    expect(ids(bug.graph)).not.toContain('scenario-tests');
    expect(
      bug.graph.edges.some(
        (e) =>
          ['behaviour', 'scenario-tests'].includes(e.from) ||
          ['behaviour', 'scenario-tests'].includes(e.to),
      ),
    ).toBe(false);
  });

  it('drops a researcher whose only target was skipped, and redraws the plan path without planners', () => {
    // The analyst researches for a planner that runs only for feature tickets.
    const g = withTypes(workflowTemplateV3('bdd', { planner: true }), { plan: ['feature'] });
    const bug = specialiseForTicket(g, 'chore');
    expect(bug.skipped.map((n) => n.id).sort()).toEqual(['behaviour', 'plan', 'scenario-tests']);
    const flows = bug.graph.edges.filter((e) => e.type === 'flow').map((e) => `${e.from}>${e.to}`);
    expect(flows).toContain('ticket>orchestrate');
    expect(flows).toContain('orchestrate>plan-approval');
    expect(errors(bug.graph)).toEqual([]);
  });

  it('drops a change reviewer left with no change to review', () => {
    const base = workflowTemplateV3('reviewer-helper-loop');
    const g = WorkflowGraphV3Schema.parse({
      ...base,
      nodes: [
        ...base.nodes,
        {
          type: 'agent',
          id: 'docs',
          label: 'Docs',
          model: null,
          skills: [],
          agent: null,
          ticketTypes: ['feature'],
        },
        {
          type: 'agent',
          id: 'docs-review',
          label: 'Docs review',
          model: null,
          skills: [],
          agent: null,
        },
      ],
      edges: [
        ...base.edges,
        { type: 'implement', id: 'implement-docs', from: 'orchestrate', to: 'docs' },
        { type: 'review', id: 'review-docs', from: 'docs', to: 'docs-review' },
        { type: 'findings', id: 'findings-docs', from: 'docs-review', to: 'orchestrate' },
      ],
    });
    expect(errors(g)).toEqual([]);
    const bug = specialiseForTicket(g, 'bug');
    expect(bug.skipped.map((n) => n.id)).toEqual(['docs', 'docs-review']);
    expect(ids(bug.graph)).toContain('review');
    expect(errors(bug.graph)).toEqual([]);
  });

  it('steps over a skipped tester in the final chain, keeping the next tester a tester', () => {
    const base = workflowTemplateV3('bdd');
    const g = WorkflowGraphV3Schema.parse({
      ...base,
      nodes: [
        ...base.nodes,
        {
          type: 'agent',
          id: 'e2e',
          label: 'End-to-end',
          model: null,
          skills: [],
          agent: null,
          ticketTypes: ['feature'],
        },
      ],
      edges: [
        ...base.edges.filter((e) => !(e.type === 'test' && e.to === 'unit-tests')),
        { type: 'test', id: 'test-e2e', from: 'ticket-merge', to: 'e2e' },
        { type: 'review', id: 'review-e2e', from: 'e2e', to: 'orchestrate' },
        { type: 'test', id: 'test-e2e-unit', from: 'e2e', to: 'unit-tests' },
      ],
    });
    expect(errors(g)).toEqual([]);
    const bug = specialiseForTicket(g, 'bug');
    expect(bug.skipped.map((n) => n.id)).toEqual(['behaviour', 'scenario-tests', 'e2e']);
    const step = bug.graph.edges.find((e) => e.from === 'ticket-merge' && e.to === 'unit-tests');
    expect(step?.type).toBe('test');
    expect(errors(bug.graph)).toEqual([]);
    expect(compileWorkflowV3(bug.graph, ctx).finalStages.map((s) => s.id)).toEqual(['unit-tests']);
  });

  it('drops a When arrow to a skipped helper, so that failure goes to the lead', () => {
    const base = workflowTemplateV3('bdd');
    const g = WorkflowGraphV3Schema.parse({
      ...base,
      nodes: base.nodes.filter((n) => n.type !== 'author'),
      edges: [
        ...base.edges.filter((e) => e.type !== 'when'),
        {
          type: 'when',
          id: 'when-tests',
          from: 'unit-tests',
          to: 'scenario-tests',
          on: ['tests-failed'],
          maxRounds: 2,
        },
      ],
    });
    expect(errors(g)).toEqual([]);
    const bug = specialiseForTicket(g, 'bug').graph;
    expect(bug.edges.some((e) => e.type === 'when')).toBe(false);
    expect(compileWorkflowV3(bug, ctx).failureRoutes ?? []).toEqual([]);
  });
});

describe('validation: every ticket type must still run', () => {
  it('refuses a workflow whose only helper runs for feature tickets', () => {
    const g = withTypes(workflowTemplateV3('lead-only'), { helpers: ['feature'] });
    const issues = errors(g);
    expect(issues.map((i) => i.code)).toEqual([
      'ticket-type-breaks-workflow',
      'ticket-type-breaks-workflow',
      'ticket-type-breaks-workflow',
    ]);
    expect(issues[0]?.nodeId).toBe('helpers');
    expect(issues[0]?.message).toMatch(/^For bug tickets, without "Helpers": /);
  });

  it('refuses the same ticket type twice and an empty list at the schema', () => {
    const g = workflowTemplateV3('lead-only');
    const bad = (types: unknown) =>
      WorkflowGraphV3Schema.safeParse({
        ...g,
        nodes: g.nodes.map((n) => (n.id === 'helpers' ? { ...n, ticketTypes: types } : n)),
      }).success;
    expect(bad([])).toBe(false);
    expect(bad(['bug', 'bug'])).toBe(false);
    expect(bad(['bug'])).toBe(true);
  });
});

describe('the BDD template', () => {
  for (const planner of [false, true]) {
    it(`is valid and runs for every ticket type${planner ? ' (with a planner)' : ''}`, () => {
      const g = workflowTemplateV3('bdd', { planner });
      expect(validateWorkflowGraphV3(g, { projectMode: 'auto-edits' })).toEqual([]);
      for (const type of TYPES) {
        const runs = specialiseForTicket(g, type).graph;
        expect(errors(runs)).toEqual([]);
        const program = compileWorkflowV3(runs, ctx);
        const helpers = program.helpers.map((h) => h.id);
        const researchers = program.researchers.map((r) => r.id);
        if (type === 'feature') {
          expect(helpers).toEqual(['scenario-tests', 'developer']);
          expect(researchers).toEqual(['behaviour']);
        } else {
          expect(helpers).toEqual(['developer']);
          expect(researchers).toEqual([]);
        }
        expect(program.finalStages.map((s) => s.id)).toEqual(['unit-tests']);
        expect(program.failureRoutes?.map((r) => r.events)).toEqual([['tests-failed']]);
      }
    });
  }

  it('says in words which blocks run only for feature tickets', () => {
    const text = describeWorkflow(workflowTemplateV3('bdd'))
      .filter((s) => s.text.includes('runs only for'))
      .map((s) => s.nodeId);
    expect(text).toEqual(['behaviour', 'scenario-tests']);
  });

  it('cannot go back to version 2', () => {
    expect(downgradeWorkflowV3(workflowTemplateV3('bdd'))).toEqual({
      ok: false,
      reason: '"Behaviour analyst" runs only for some ticket types',
    });
  });
});
