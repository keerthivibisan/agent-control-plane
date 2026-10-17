import { expect } from 'vitest';
import type {
  ApprovalMode,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
} from '@acp/core';
import { WorkflowGraphDtoSchema, type WorkflowGraphDto } from '@acp/core/api';
import type { Board } from './loop-helpers.js';

/**
 * Graph building blocks for the server's workflow-graph tests (ADR-0023, WG-C). Synthetic graphs
 * over core's templates; node ids follow the templates (`orchestrate` is the lead, `helpers` the
 * pool, `review` the change reviewer).
 */

export const LEAD = 'orchestrate';
export const POOL = 'helpers';

/** The project's approval mode (and command allowlist) on its setup. */
export async function projectMode(s: Board, mode: ApprovalMode, commands: object[] = []) {
  const setup = {
    projectKey: 'WEBAPP',
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 100_000,
    model: null,
    approvals: { mode, commands },
    contextFiles: [],
  };
  expect((await s.send('put', `/api/projects/${s.project.id}/setup`, setup)).status).toBe(200);
}

/** Saves the graph through the route; it must be valid. */
export async function putGraph(s: Board, graph: WorkflowGraph): Promise<WorkflowGraphDto> {
  const res = await s.send('put', `/api/projects/${s.project.id}/workflow-graph`, { graph });
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
  return WorkflowGraphDtoSchema.parse(res.body);
}

export function mapNodes(
  graph: WorkflowGraph,
  f: (n: WorkflowNode) => WorkflowNode,
): WorkflowGraph {
  return { ...graph, template: 'custom', nodes: graph.nodes.map(f) };
}

/** The pool's own approval mode. */
export function poolMode(graph: WorkflowGraph, mode: ApprovalMode | null): WorkflowGraph {
  return mapNodes(graph, (n) => (n.type === 'helper-pool' ? { ...n, approvalMode: mode } : n));
}

/** The plan gate's automatic approval switch. */
export function planAuto(graph: WorkflowGraph, auto: boolean): WorkflowGraph {
  return mapNodes(graph, (n) => (n.type === 'plan-approval' ? { ...n, auto } : n));
}

export interface NamedHelper {
  id: WorkflowNodeId;
  label: string;
  mode?: ApprovalMode | null;
  maxInstances?: number;
  /** Who reviews its change: the lead (route a, default) or a change reviewer. */
  reviewBy?: WorkflowNodeId;
  /** Rework rounds of the reviewer's direct rework edge (route c) or of the lead's. */
  rounds?: number;
}

/** Adds a named helper the lead assigns, with its review route. */
export function withHelper(graph: WorkflowGraph, h: NamedHelper): WorkflowGraph {
  const reviewBy = h.reviewBy ?? LEAD;
  const edges: WorkflowEdge[] = [
    { type: 'assigns', id: `assigns-${h.id}`, from: LEAD, to: h.id },
    { type: 'review', id: `review-${h.id}`, from: h.id, to: reviewBy },
  ];
  if (h.rounds !== undefined) {
    edges.push({
      type: 'rework',
      id: `rework-${h.id}`,
      from: reviewBy,
      to: h.id,
      maxRounds: h.rounds,
    });
  }
  return {
    ...graph,
    template: 'custom',
    nodes: [
      ...graph.nodes,
      {
        type: 'helper',
        id: h.id,
        label: h.label,
        description: `${h.label} work`,
        model: null,
        skills: [],
        agent: null,
        approvalMode: h.mode ?? null,
        maxInstances: h.maxInstances ?? 1,
        canStartHelpers: false,
      },
    ],
    edges: [...graph.edges, ...edges],
  };
}

/** Puts a tester between the ticket merge and the owner's merge; the lead reviews its change. */
export function withTester(graph: WorkflowGraph, mode: ApprovalMode | null): WorkflowGraph {
  const edges = graph.edges.filter(
    (e) => !(e.type === 'flow' && e.from === 'ticket-merge' && e.to === 'owner-merge'),
  );
  return {
    ...graph,
    template: 'custom',
    nodes: [
      ...graph.nodes,
      {
        type: 'tester',
        id: 'unit-tests',
        label: 'Tester',
        model: null,
        skills: [],
        agent: null,
        approvalMode: mode,
      },
    ],
    edges: [
      ...edges,
      { type: 'flow', id: 'flow-merge-tester', from: 'ticket-merge', to: 'unit-tests' },
      { type: 'flow', id: 'flow-tester-owner', from: 'unit-tests', to: 'owner-merge' },
      { type: 'review', id: 'review-tester', from: 'unit-tests', to: LEAD },
    ],
  };
}
