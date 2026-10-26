// canConnect: the edge-type matrix the editor checks on every drag (ADR-0023 §3, README §2,
// WG-0 refinements 1–3, ADR-0027 §5 for the Checks blocks' places). Every (from type, to type,
// edge type) triple is asserted against the explicit table below, with and without a planner.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_EDGE_TYPES,
  canConnect,
  type WorkflowEdgeType,
  type WorkflowGraph,
  type WorkflowNode,
} from '../../src/index.js';
import { AGENT, containing } from './helpers.js';

/** Node variants: the node types, with the reviewer split by scope. */
const VARIANTS = [
  'planner',
  'lead',
  'helper-pool',
  'helper',
  'change-reviewer',
  'final-reviewer',
  'tester',
  'ticket',
  'plan-approval',
  'checks',
  'change-checks',
  'branch-checks',
  'ticket-merge',
  'owner-merge',
  'done',
] as const;
type Variant = (typeof VARIANTS)[number];

function node(variant: Variant, id: string): WorkflowNode {
  const label = `${variant} ${id}`;
  switch (variant) {
    case 'planner':
    case 'lead':
      return { type: variant, id, label, ...AGENT, skills: [] };
    case 'helper-pool':
      return {
        type: variant,
        id,
        label,
        ...AGENT,
        skills: [],
        approvalMode: null,
        canStartHelpers: false,
      };
    case 'helper':
      return {
        type: variant,
        id,
        label,
        ...AGENT,
        skills: [],
        approvalMode: null,
        description: '',
        maxInstances: 1,
        canStartHelpers: false,
      };
    case 'change-reviewer':
      return { type: 'reviewer', id, label, scope: 'change', ...AGENT, skills: [] };
    case 'final-reviewer':
      return { type: 'reviewer', id, label, scope: 'final', ...AGENT, skills: [] };
    case 'tester':
      return { type: variant, id, label, ...AGENT, skills: [], approvalMode: null };
    case 'plan-approval':
      return { type: variant, id, label, auto: false };
    case 'change-checks':
      return { type: 'checks', id, label, place: 'change' };
    case 'branch-checks':
      return { type: 'checks', id, label, place: 'branch', onFailure: 'owner' };
    default:
      return { type: variant, id, label };
  }
}

/** Two nodes of every variant (`<variant>-a`, `<variant>-b`) so same-type pairs are distinct. */
function matrixGraph(withPlanner: boolean): WorkflowGraph {
  const variants = VARIANTS.filter((v) => withPlanner || v !== 'planner');
  return {
    version: 2,
    template: 'custom',
    nodes: variants.flatMap((v) => [node(v, `${v}-a`), node(v, `${v}-b`)]),
    edges: [],
  };
}

const EDITORS: Variant[] = ['helper', 'helper-pool', 'tester'];
const FINAL: Variant[] = ['final-reviewer', 'tester'];

/** The allowed triples, `type from->to`, by planner context. Everything else is refused. */
function allowedTable(withPlanner: boolean): Set<string> {
  const rows: string[] = [];
  const add = (type: WorkflowEdgeType, froms: Variant[], tos: Variant[]) => {
    for (const f of froms) for (const t of tos) rows.push(`${type} ${f}->${t}`);
  };
  if (withPlanner) {
    add('flow', ['ticket'], ['planner']);
    add('flow', ['planner'], ['plan-approval']);
    add('flow', ['plan-approval'], ['lead']);
  } else {
    add('flow', ['ticket'], ['lead']);
    add('flow', ['lead'], ['plan-approval']);
  }
  add('flow', ['checks'], ['ticket-merge']);
  add('flow', ['ticket-merge', ...FINAL], [...FINAL, 'owner-merge']);
  add('flow', ['owner-merge'], ['done']);
  // ADR-0027 §5: a change block takes an editing node's change; a branch block sits in the final
  // chain (never one branch block straight to another)
  add('flow', EDITORS, ['change-checks']);
  add('flow', ['ticket-merge', ...FINAL], ['branch-checks']);
  add('flow', ['branch-checks'], [...FINAL, 'owner-merge']);
  add('assigns', ['lead'], ['helper', 'helper-pool']);
  add('review', EDITORS, ['change-reviewer', 'lead']);
  add('findings', ['change-reviewer'], ['lead']);
  add('rework', ['change-reviewer', 'lead', 'change-checks'], EDITORS);
  add('merge', ['lead'], ['checks']);
  return new Set(rows);
}

describe('canConnect: the edge-type matrix', () => {
  for (const withPlanner of [true, false]) {
    it(`matches the explicit table for every triple (${withPlanner ? 'with' : 'without'} a planner)`, () => {
      const graph = matrixGraph(withPlanner);
      const table = allowedTable(withPlanner);
      const variants = VARIANTS.filter((v) => withPlanner || v !== 'planner');
      const mismatches: string[] = [];
      let allowedCount = 0;
      for (const type of WORKFLOW_EDGE_TYPES) {
        for (const from of variants) {
          for (const to of variants) {
            const key = `${type} ${from}->${to}`;
            const result = canConnect(graph, `${from}-a`, `${to}-b`, type);
            if (result.ok) allowedCount++;
            if (result.ok !== table.has(key))
              mismatches.push(`${key}: got ${result.ok ? 'ok' : 'refused'}`);
            if (!result.ok && result.code !== 'edge-not-allowed')
              mismatches.push(`${key}: ${result.code}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
      expect(allowedCount).toBe(table.size);
    });
  }

  it('explains a refusal with both labels and what the edge type is for', () => {
    const result = canConnect(matrixGraph(false), 'helper-a', 'checks-b', 'flow');
    expect(result).toEqual({
      ok: false,
      code: 'edge-not-allowed',
      message: containing('"helper helper-a" cannot flow to "checks checks-b"'),
    });
  });

  it('reads a block without a place as the block before the merge', () => {
    const graph = matrixGraph(false);
    const explicit: WorkflowGraph = {
      ...graph,
      nodes: [...graph.nodes, { type: 'checks', id: 'merge-x', label: 'Merge', place: 'merge' }],
    };
    for (const [from, to, type] of [
      ['lead-a', 'merge-x', 'merge'],
      ['merge-x', 'ticket-merge-a', 'flow'],
    ] as const) {
      expect(canConnect(explicit, from, to, type)).toEqual({ ok: true });
    }
    expect(canConnect(explicit, 'helper-a', 'merge-x', 'flow').ok).toBe(false);
    expect(canConnect(explicit, 'merge-x', 'helper-a', 'rework').ok).toBe(false);
  });

  it('explains a refused Checks block link', () => {
    const result = canConnect(matrixGraph(false), 'lead-a', 'change-checks-b', 'merge');
    expect(result).toMatchObject({ ok: false, code: 'edge-not-allowed' });
    if (!result.ok) expect(result.message).toContain('through the Checks block before the merge');
  });

  it('tells the owner why the plan path changed with a planner', () => {
    const result = canConnect(matrixGraph(true), 'ticket-a', 'lead-b', 'flow');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('the ticket goes to the planner first');
  });
});

describe('canConnect: shape refusals', () => {
  const graph = matrixGraph(false);

  it('refuses a self edge before the matrix', () => {
    expect(canConnect(graph, 'lead-a', 'lead-a', 'rework')).toMatchObject({
      ok: false,
      code: 'self-edge',
    });
    // even a pair the matrix allows between two nodes of the type
    expect(canConnect(graph, 'tester-a', 'tester-a', 'flow')).toMatchObject({
      ok: false,
      code: 'self-edge',
    });
  });

  it('refuses an edge to or from an unknown node', () => {
    expect(canConnect(graph, 'lead-a', 'ghost', 'merge')).toMatchObject({
      ok: false,
      code: 'edge-unknown-node',
    });
    expect(canConnect(graph, 'ghost', 'lead-a', 'findings')).toMatchObject({
      ok: false,
      code: 'edge-unknown-node',
    });
  });

  it('refuses a duplicate (from, to, type), but not the same ends with another type', () => {
    const withMerge: WorkflowGraph = {
      ...graph,
      edges: [{ type: 'review', id: 'r1', from: 'helper-a', to: 'lead-a' }],
    };
    expect(canConnect(withMerge, 'helper-a', 'lead-a', 'review')).toMatchObject({
      ok: false,
      code: 'duplicate-edge',
    });
    expect(canConnect(withMerge, 'helper-b', 'lead-a', 'review')).toEqual({ ok: true });
    expect(canConnect(withMerge, 'lead-a', 'helper-a', 'rework')).toEqual({ ok: true });
  });
});
