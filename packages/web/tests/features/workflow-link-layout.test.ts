import { WorkflowGraphV3Schema, type WorkflowGraphV3 } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { toFlowEdges } from '../../src/features/workflow/editor/flow';
import { layoutGraph } from '../../src/features/workflow/editor/layout';
import { graphRoles } from '../../src/features/workflow/editor/roles';
import {
  countConflicts,
  drawnLinks,
  labelOverlaps,
  labelPoint,
  planLinks,
} from '../../src/features/workflow/editor/routing';
import { finishView } from '../../src/features/workflow/finish';

/*
 * Link labels on the editor canvas: placed so they cover no block and no other label. The first
 * graph is an owner's draft as drawn on 2026-11-15 (blocks moved by hand, a Lead ↔ tester pair of
 * labelled links), whose two labels used to sit on top of each other.
 */

const at = (x: number, y: number) => ({ x: Math.round(x * 0.854), y: Math.round(y * 0.854) });
const agent = { model: null, skills: [], agent: null };

function draft(): WorkflowGraphV3 {
  return WorkflowGraphV3Schema.parse({
    version: 3,
    template: 'custom',
    nodes: [
      { type: 'ticket', id: 'ticket', label: 'Ticket', position: at(1018, 432) },
      {
        type: 'plan-approval',
        id: 'plan-approval',
        label: 'Plan approval',
        auto: true,
        position: at(1303, 432),
      },
      { type: 'lead', id: 'orchestrate', label: 'Lead', ...agent, position: at(806, 778) },
      { type: 'checks', id: 'checks', label: 'Checks', position: at(957, 1150) },
      { type: 'ticket-merge', id: 'ticket-merge', label: 'Ticket branch' },
      { type: 'owner-merge', id: 'owner-merge', label: 'Your merge', position: at(1258, 1143) },
      { type: 'done', id: 'done', label: 'Done' },
      { type: 'agent', id: 'agent-1', label: 'Agent 1', ...agent, position: at(1431, 631) },
      { type: 'agent', id: 'tester', label: 'tester', ...agent, position: at(278, 537) },
    ],
    edges: [
      { type: 'flow', id: 'f1', from: 'ticket', to: 'orchestrate' },
      { type: 'flow', id: 'f2', from: 'orchestrate', to: 'plan-approval' },
      { type: 'merge', id: 'm1', from: 'orchestrate', to: 'checks' },
      { type: 'flow', id: 'f3', from: 'checks', to: 'ticket-merge' },
      { type: 'flow', id: 'f4', from: 'ticket-merge', to: 'owner-merge' },
      { type: 'flow', id: 'f5', from: 'owner-merge', to: 'done' },
      { type: 'implement', id: 'i1', from: 'orchestrate', to: 'agent-1' },
      { type: 'review', id: 'r1', from: 'agent-1', to: 'orchestrate' },
      {
        type: 'implement',
        id: 'i2',
        from: 'orchestrate',
        to: 'tester',
        label: 'To test the changes',
      },
      {
        type: 'review',
        id: 'r2',
        from: 'tester',
        to: 'orchestrate',
        label: 'Test Resul with context',
      },
    ],
  });
}

function labelsOf(g: WorkflowGraphV3): Map<string, string> {
  return new Map(g.edges.flatMap((e) => (e.label !== undefined ? [[e.id, e.label] as const] : [])));
}

describe('link labels on the canvas', () => {
  it('keeps the two labels of a Lead ↔ tester pair apart, where they used to overlap', () => {
    const stored = draft();
    const g = finishView(stored).graph;
    const pos = layoutGraph(stored);
    const roles = graphRoles(stored);
    const labels = labelsOf(g);
    const unplaced = planLinks(g, pos, roles);
    expect(labelOverlaps(g, pos, labels, unplaced, roles).labels).toBeGreaterThan(0);
    const plan = planLinks(g, pos, roles, labels);
    expect(labelOverlaps(g, pos, labels, plan, roles)).toEqual({ blocks: 0, labels: 0 });
    // Placing labels never moves a route.
    expect(countConflicts(drawnLinks(g, pos, plan, roles))).toBe(
      countConflicts(drawnLinks(g, pos, unplaced, roles)),
    );
  });

  it('hands the planned label spot to the canvas, with the owner’s label text', () => {
    const edges = toFlowEdges(draft(), [], null);
    const pair = edges.filter((e) => e.id === 'i2' || e.id === 'r2');
    expect(pair.map((e) => e.label)).toEqual(['To test the changes', 'Test Resul with context']);
    for (const e of pair) expect(e.data?.route.labelAt).toBeDefined();
    expect(edges.find((e) => e.id === 'f1')?.data?.route.labelAt).toBeUndefined();
  });

  it('labels every link of a busy default layout without one label covering another', () => {
    const stored = draft();
    const plain = WorkflowGraphV3Schema.parse({
      ...stored,
      nodes: stored.nodes.map(({ position: _drop, ...n }) => n),
      edges: stored.edges.map((e) => ({ ...e, label: e.label ?? `Link ${e.id}` })),
    });
    const g = finishView(plain).graph;
    const pos = layoutGraph(plain);
    // A link between blocks 40px apart has no room for its label beside the blocks, but no label
    // ever covers another.
    expect(labelOverlaps(g, pos, labelsOf(g)).labels).toBe(0);
  });

  it('falls back to the middle of the middle run when a dragged block straightens a route', () => {
    const bent = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 20 },
    ];
    expect(labelPoint(bent, { segment: 1, t: 0.25 })).toEqual({ x: 10, y: 10 });
    const straight = [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ];
    expect(labelPoint(straight, { segment: 1, t: 0.25 })).toEqual({ x: 0, y: 10 });
  });
});
