import { expect } from 'vitest';
import { workflowTemplateV3 } from '@acp/core';
import type {
  AgentNode,
  ApprovalMode,
  WorkflowEdge,
  WorkflowEdgeV3,
  WorkflowGraph,
  WorkflowGraphV3,
  WorkflowNode,
  WorkflowNodeId,
} from '@acp/core';
import { WorkflowGraphDtoSchema, type WorkflowGraphDto } from '@acp/core/api';
import type { Board } from './loop-helpers.js';

/**
 * Graph building blocks for the server's workflow-graph tests (ADR-0023, WG-C; version 3,
 * ADR-0037). Synthetic graphs over core's templates; node ids follow the templates (`orchestrate`
 * is the lead, `helpers` the pool, `review` the change reviewer, `plan` the planner). The version 2
 * builders stay for the tests that pin how an older client's graph is migrated; the server stores
 * and serves version 3 either way.
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

/** Saves the graph (version 2 or 3) through the route; it must be valid. */
export async function putGraph(
  s: Board,
  graph: WorkflowGraph | WorkflowGraphV3,
): Promise<WorkflowGraphDto> {
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

/**
 * The run's pending approvals once one is there. A request reaches the engine only after the
 * gate's allowlist check resolves paths on disk, which `settle` does not wait for, so this polls
 * (at most about 5 s) instead of reading once.
 */
export async function pendingApprovals(s: Board, runId: string) {
  for (let i = 0; i < 100; i++) {
    await s.settle();
    const res = await s.get(`/api/runs/${runId}`);
    const approvals = (
      res.body as { approvals: { id: string; agentRunId: string; status: string }[] }
    ).approvals;
    const pending = approvals.filter((a) => a.status === 'pending');
    if (pending.length > 0) return pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}

// ---------------------------------------------------------------- version 3 (ADR-0037)

/** A version 3 template as a custom graph (`planner`: the template's planner block `plan`). */
export function templateV3(
  id: Parameters<typeof workflowTemplateV3>[0] = 'lead-only',
  planner = false,
): WorkflowGraphV3 {
  return { ...workflowTemplateV3(id, { planner }), template: 'custom' };
}

/** A generic agent block; its role comes from the arrows drawn to and from it. */
export function agentV3(id: WorkflowNodeId, label: string, extra: Partial<AgentNode> = {}) {
  return { type: 'agent', id, label, model: null, skills: [], agent: null, ...extra } as AgentNode;
}

/** An arrow with the id `<type>-<from>-<to>` and the owner's label and purpose when given. */
export function arrowV3(
  type: Exclude<WorkflowEdgeV3['type'], 'rework'>,
  from: WorkflowNodeId,
  to: WorkflowNodeId,
  notes: { label?: string; purpose?: string } = {},
): WorkflowEdgeV3 {
  return { type, id: `${type}-${from}-${to}`.slice(0, 40), from, to, ...notes };
}

/** Adds blocks and arrows to a version 3 graph. */
export function withV3(
  graph: WorkflowGraphV3,
  nodes: readonly AgentNode[],
  edges: readonly WorkflowEdgeV3[],
): WorkflowGraphV3 {
  return {
    ...graph,
    template: 'custom',
    nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges, ...edges],
  };
}

/** A researcher block with a research arrow into `to` (the lead, a planner or an agent). */
export function withResearcherV3(
  graph: WorkflowGraphV3,
  id: WorkflowNodeId,
  label: string,
  to: WorkflowNodeId,
  notes: { label?: string; purpose?: string } = {},
): WorkflowGraphV3 {
  return withV3(graph, [agentV3(id, label)], [arrowV3('research', id, to, notes)]);
}

/** One more planner: a flow from the ticket and a plan arrow into Plan approval. */
export function withPlannerV3(
  graph: WorkflowGraphV3,
  id: WorkflowNodeId,
  label: string,
  notes: { label?: string; purpose?: string } = {},
): WorkflowGraphV3 {
  return withV3(
    graph,
    [agentV3(id, label)],
    [arrowV3('flow', 'ticket', id), arrowV3('plan', id, 'plan-approval', notes)],
  );
}

/** The plan gate's automatic approval switch on a version 3 graph. */
export function planAutoV3(graph: WorkflowGraphV3, auto: boolean): WorkflowGraphV3 {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.type === 'plan-approval' ? { ...n, auto } : n)),
  };
}
