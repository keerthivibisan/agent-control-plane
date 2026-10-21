import { APPROVAL_MODES, type ApprovalMode } from '../../workspace.js';
import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
  WorkflowNodeOf,
} from '../../workflow-graph.js';
import { isChangeReviewer, isFinalStage } from '../graph-index.js';
import type { GraphRng } from './rng.js';

/**
 * Immutable graph edits and reads for the generators and mutations. Each edit returns a new graph
 * and never changes its input.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewEdge = DistributiveOmit<WorkflowEdge, 'id'>;

/** An id with this prefix that no node or edge uses yet: `<prefix>-1`, `<prefix>-2`, … */
export function freshId(graph: WorkflowGraph, prefix: string): string {
  const used = new Set<string>([...graph.nodes.map((n) => n.id), ...graph.edges.map((e) => e.id)]);
  for (let k = 1; ; k++) {
    const id = `${prefix}-${k}`;
    if (!used.has(id)) return id;
  }
}

export function addNode(graph: WorkflowGraph, node: WorkflowNode): WorkflowGraph {
  return { ...graph, nodes: [...graph.nodes, node] };
}

export function addEdge(graph: WorkflowGraph, edge: NewEdge): WorkflowGraph {
  return {
    ...graph,
    edges: [...graph.edges, { ...edge, id: freshId(graph, 'e') }],
  };
}

export function removeEdges(
  graph: WorkflowGraph,
  drop: (edge: WorkflowEdge) => boolean,
): WorkflowGraph {
  return { ...graph, edges: graph.edges.filter((e) => !drop(e)) };
}

/** Removes every node with the id and every edge touching it. */
export function removeNode(graph: WorkflowGraph, id: WorkflowNodeId): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function updateNode(
  graph: WorkflowGraph,
  id: WorkflowNodeId,
  change: (node: WorkflowNode) => WorkflowNode,
): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? change(n) : n)) };
}

export function updateEdge(
  graph: WorkflowGraph,
  id: string,
  change: (edge: WorkflowEdge) => WorkflowEdge,
): WorkflowGraph {
  return { ...graph, edges: graph.edges.map((e) => (e.id === id ? change(e) : e)) };
}

// ---------------------------------------------------------------- reads

export function nodesOfType<T extends WorkflowNode['type']>(
  graph: WorkflowGraph,
  type: T,
): WorkflowNodeOf<T>[] {
  return graph.nodes.filter((n): n is WorkflowNodeOf<T> => n.type === type);
}

export function firstOfType<T extends WorkflowNode['type']>(
  graph: WorkflowGraph,
  type: T,
): WorkflowNodeOf<T> | undefined {
  return nodesOfType(graph, type)[0];
}

/** The lead's id; the generators only work on graphs that have one. */
export function leadId(graph: WorkflowGraph): WorkflowNodeId {
  const lead = firstOfType(graph, 'lead');
  if (lead === undefined) throw new Error('graph has no lead');
  return lead.id;
}

export function editorNodes(
  graph: WorkflowGraph,
): WorkflowNodeOf<'helper' | 'helper-pool' | 'tester'>[] {
  return graph.nodes.filter(
    (n): n is WorkflowNodeOf<'helper' | 'helper-pool' | 'tester'> =>
      n.type === 'helper' || n.type === 'helper-pool' || n.type === 'tester',
  );
}

export function helperNodes(graph: WorkflowGraph): WorkflowNodeOf<'helper' | 'helper-pool'>[] {
  return graph.nodes.filter(
    (n): n is WorkflowNodeOf<'helper' | 'helper-pool'> =>
      n.type === 'helper' || n.type === 'helper-pool',
  );
}

export function changeReviewers(graph: WorkflowGraph): WorkflowNodeOf<'reviewer'>[] {
  return graph.nodes.filter(
    (n): n is WorkflowNodeOf<'reviewer'> => n.type === 'reviewer' && isChangeReviewer(n),
  );
}

export function finalStageNodes(graph: WorkflowGraph): WorkflowNode[] {
  return graph.nodes.filter(isFinalStage);
}

/** Where a node's (first) review edge goes, or undefined without one. */
export function reviewTargetOf(
  graph: WorkflowGraph,
  id: WorkflowNodeId,
): WorkflowNodeId | undefined {
  return graph.edges.find((e) => e.type === 'review' && e.from === id)?.to;
}

export function hasEdge(
  graph: WorkflowGraph,
  type: WorkflowEdge['type'],
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): boolean {
  return graph.edges.some((e) => e.type === type && e.from === from && e.to === to);
}

/** The final chain's node ids from the ticket merge to the owner's merge, following flow edges. */
export function chainIds(graph: WorkflowGraph): WorkflowNodeId[] {
  const start = firstOfType(graph, 'ticket-merge');
  if (start === undefined) return [];
  const chain = [start.id];
  for (;;) {
    const last = chain[chain.length - 1];
    const next = graph.edges.find((e) => e.type === 'flow' && e.from === last)?.to;
    if (next === undefined || chain.includes(next)) return chain;
    chain.push(next);
    if (graph.nodes.find((n) => n.id === next)?.type === 'owner-merge') return chain;
  }
}

// ---------------------------------------------------------------- random config

const MODELS: readonly (string | null)[] = [null, null, 'sonnet', 'opus', 'haiku'];
const SKILLS: readonly string[] = ['tdd', 'react-pages', 'sql-migrations', 'docs-style'];
const AGENTS: readonly (string | null)[] = [null, null, 'frontend-dev', 'strict-review'];

export function randomAgentConfig(rng: GraphRng): {
  model: string | null;
  skills: string[];
  agent: string | null;
} {
  const skills = SKILLS.filter(() => rng.bool(0.25)).slice(0, 3);
  return { model: rng.pick(MODELS), skills, agent: rng.pick(AGENTS) };
}

export function randomMode(rng: GraphRng): ApprovalMode | null {
  return rng.pick<ApprovalMode | null>([null, null, ...APPROVAL_MODES]);
}
