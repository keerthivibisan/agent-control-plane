// Shared helpers for the workflow graph tests (WG-A). Synthetic data only.
import { expect } from 'vitest';
import {
  validateWorkflowGraph,
  workflowTemplate,
  type GraphIssue,
  type GraphIssueCode,
  type ValidateGraphContext,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '../../src/index.js';

/** `expect.stringContaining`, typed for object matchers (vitest types it as `any`). */
export function containing(text: string): string {
  const matcher: unknown = expect.stringContaining(text);
  return matcher as string;
}

export const AGENT = { model: null, skills: [], agent: null } as const;

export function errors(graph: WorkflowGraph, ctx?: ValidateGraphContext): GraphIssue[] {
  return validateWorkflowGraph(graph, ctx).filter((i) => i.severity === 'error');
}

export function warnings(graph: WorkflowGraph, ctx?: ValidateGraphContext): GraphIssue[] {
  return validateWorkflowGraph(graph, ctx).filter((i) => i.severity === 'warning');
}

export function errorCodes(graph: WorkflowGraph, ctx?: ValidateGraphContext): GraphIssueCode[] {
  return errors(graph, ctx).map((i) => i.code);
}

/** `lead-only` (route a) unless another template is named. */
export function base(
  id: Parameters<typeof workflowTemplate>[0] = 'lead-only',
  planner = false,
): WorkflowGraph {
  return workflowTemplate(id, { planner });
}

export function withNodes(graph: WorkflowGraph, ...nodes: WorkflowNode[]): WorkflowGraph {
  return { ...graph, nodes: [...graph.nodes, ...nodes] };
}

export function withEdges(graph: WorkflowGraph, ...edges: WorkflowEdge[]): WorkflowGraph {
  return { ...graph, edges: [...graph.edges, ...edges] };
}

export function withoutEdges(graph: WorkflowGraph, ...ids: string[]): WorkflowGraph {
  for (const id of ids) {
    if (!graph.edges.some((e) => e.id === id)) throw new Error(`test graph has no edge ${id}`);
  }
  return { ...graph, edges: graph.edges.filter((e) => !ids.includes(e.id)) };
}

export function withoutNode(graph: WorkflowGraph, id: string): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function mapNode(
  graph: WorkflowGraph,
  id: string,
  change: (n: WorkflowNode) => WorkflowNode,
): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? change(n) : n)) };
}

export function namedHelper(
  id: string,
  label: string,
  extra: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    type: 'helper',
    id,
    label,
    ...AGENT,
    skills: [],
    approvalMode: null,
    description: `${label} work`,
    maxInstances: 1,
    canStartHelpers: false,
    ...extra,
  } as WorkflowNode;
}

export function changeReviewer(id: string, label = 'Second reviewer'): WorkflowNode {
  return { type: 'reviewer', id, label, scope: 'change', ...AGENT, skills: [] };
}

export function finalReviewer(id: string, label = 'Code reviewer'): WorkflowNode {
  return { type: 'reviewer', id, label, scope: 'final', ...AGENT, skills: [] };
}

export function tester(id: string, label = 'Tester'): WorkflowNode {
  return { type: 'tester', id, label, ...AGENT, skills: [], approvalMode: null };
}

let edgeCounter = 0;
export function e(
  type: Exclude<WorkflowEdge['type'], 'rework'>,
  from: string,
  to: string,
): WorkflowEdge {
  edgeCounter++;
  return { type, id: `t-${edgeCounter}`, from, to };
}
export function rw(from: string, to: string, maxRounds: number): WorkflowEdge {
  edgeCounter++;
  return { type: 'rework', id: `t-${edgeCounter}`, from, to, maxRounds };
}

/** A named helper wired legally: assigned by the lead, reviewed by `reviewBy`. */
export function withNamedHelper(
  graph: WorkflowGraph,
  id: string,
  label: string,
  reviewBy = 'orchestrate',
): WorkflowGraph {
  return withEdges(
    withNodes(graph, namedHelper(id, label)),
    e('assigns', 'orchestrate', id),
    e('review', id, reviewBy),
  );
}

/** Inserts final stages (already in `nodes`) between the ticket merge and the owner's merge. */
export function withFinalChain(graph: WorkflowGraph, stages: WorkflowNode[]): WorkflowGraph {
  const chain = ['ticket-merge', ...stages.map((s) => s.id), 'owner-merge'];
  const flows: WorkflowEdge[] = [];
  for (let i = 0; i + 1 < chain.length; i++)
    flows.push(e('flow', chain[i] ?? '', chain[i + 1] ?? ''));
  return withEdges(
    withNodes(withoutEdges(graph, 'flow-ticket-merge-owner-merge'), ...stages),
    ...flows,
  );
}
