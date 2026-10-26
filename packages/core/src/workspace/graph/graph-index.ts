import type {
  WorkflowEdge,
  WorkflowEdgeType,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
  WorkflowNodeType,
} from '../workflow-graph.js';

/**
 * Read helpers shared by `canConnect`, the validator and the compiler. Internal to the graph
 * module: nothing here is part of the public API.
 */

/** What the owner calls each node type in messages ("The workflow needs a Lead block."). */
export const NODE_TYPE_NAMES: Readonly<Record<WorkflowNodeType, string>> = Object.freeze({
  planner: 'Planner',
  lead: 'Lead',
  'helper-pool': 'Helper pool',
  helper: 'Named helper',
  reviewer: 'Reviewer',
  tester: 'Tester',
  ticket: 'Ticket',
  'plan-approval': 'Plan approval',
  checks: 'Checks',
  'ticket-merge': 'Ticket merge',
  'owner-merge': 'Owner merge',
  done: 'Done',
});

/**
 * Nodes by id. With duplicate ids (an error of its own) the first node with the id wins, so every
 * rule sees the same node for an id.
 */
export interface NodeIndex {
  readonly byId: ReadonlyMap<WorkflowNodeId, WorkflowNode>;
  /** The nodes with distinct ids, in graph order. */
  readonly unique: readonly WorkflowNode[];
  readonly hasPlanner: boolean;
  /**
   * ADR-0028 §2: the graph has a Checks block before the lead's merge, so the lead merges through
   * it; without one the lead merges straight into the ticket merge.
   */
  readonly hasMergeBlock: boolean;
}

export function indexNodes(nodes: readonly WorkflowNode[]): NodeIndex {
  const byId = new Map<WorkflowNodeId, WorkflowNode>();
  const unique: WorkflowNode[] = [];
  for (const node of nodes) {
    if (byId.has(node.id)) continue;
    byId.set(node.id, node);
    unique.push(node);
  }
  return {
    byId,
    unique,
    hasPlanner: nodes.some((n) => n.type === 'planner'),
    // The same test as `isCheckBlockAt(n, 'merge')`, which imports this module's types.
    hasMergeBlock: nodes.some((n) => n.type === 'checks' && (n.place ?? 'merge') === 'merge'),
  };
}

/** The node's label in quotes, for messages. */
export function q(node: Pick<WorkflowNode, 'label'>): string {
  return `"${node.label}"`;
}

/** Messages are at most 500 characters (`GraphIssueSchema`). */
export function clip(message: string): string {
  return message.length <= 500 ? message : `${message.slice(0, 499)}…`;
}

export function isChangeReviewer(node: WorkflowNode): boolean {
  return node.type === 'reviewer' && node.scope === 'change';
}

/** A node that runs after the ticket merge: a final reviewer or a tester. */
export function isFinalStage(node: WorkflowNode): boolean {
  return (node.type === 'reviewer' && node.scope === 'final') || node.type === 'tester';
}

export function isHelperNode(node: WorkflowNode): boolean {
  return node.type === 'helper' || node.type === 'helper-pool';
}

/** The edges of a type, in graph order. */
export function edgesOfType<T extends WorkflowEdgeType>(
  edges: readonly WorkflowEdge[],
  type: T,
): Extract<WorkflowEdge, { type: T }>[] {
  return edges.filter((e): e is Extract<WorkflowEdge, { type: T }> => e.type === type);
}

/** The single node of a type, or undefined when there is none or more than one. */
export function singleOfType(
  graph: Pick<WorkflowGraph, 'nodes'>,
  type: WorkflowNodeType,
): WorkflowNode | undefined {
  const all = graph.nodes.filter((n) => n.type === type);
  return all.length === 1 ? all[0] : undefined;
}
