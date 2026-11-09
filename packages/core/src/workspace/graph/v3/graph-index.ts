import type {
  WorkflowEdgeTypeV3,
  WorkflowEdgeV3,
  WorkflowGraphV3,
  WorkflowNodeId,
  WorkflowNodeTypeV3,
  WorkflowNodeV3,
  WorkflowNodeV3Of,
} from '../../workflow-graph.js';
import { deriveRoles, type RoleClaim, type RoleResult } from './roles.js';

/** Read helpers shared by `canConnectV3`, the version 3 validator and compiler. Internal. */

export const NODE_TYPE_NAMES_V3: Readonly<Record<WorkflowNodeTypeV3, string>> = Object.freeze({
  agent: 'Agent',
  lead: 'Lead',
  ticket: 'Ticket',
  'plan-approval': 'Plan approval',
  checks: 'Checks',
  'ticket-merge': 'Ticket merge',
  'owner-merge': 'Owner merge',
  done: 'Done',
});

export interface NodeIndexV3 {
  readonly byId: ReadonlyMap<WorkflowNodeId, WorkflowNodeV3>;
  /** The nodes with distinct ids, in graph order (the first node with an id wins). */
  readonly unique: readonly WorkflowNodeV3[];
  /** Each agent's and the lead's derivation (`deriveRoles`). */
  readonly roles: ReadonlyMap<WorkflowNodeId, RoleResult>;
  /** Some agent is a planner (its own role, or one of its mixed claims). */
  readonly hasPlanner: boolean;
  /** ADR-0028 §2: the graph has a Checks block before the lead's merge. */
  readonly hasMergeBlock: boolean;
}

export function indexNodesV3(
  graph: Pick<WorkflowGraphV3, 'nodes' | 'edges'>,
  extra: readonly Pick<WorkflowEdgeV3, 'type' | 'from' | 'to'>[] = [],
): NodeIndexV3 {
  const byId = new Map<WorkflowNodeId, WorkflowNodeV3>();
  const unique: WorkflowNodeV3[] = [];
  for (const node of graph.nodes) {
    if (byId.has(node.id)) continue;
    byId.set(node.id, node);
    unique.push(node);
  }
  const roles = deriveRoles(graph, extra);
  return {
    byId,
    unique,
    roles,
    hasPlanner: [...roles.values()].some((r) => r.claims.includes('planner')),
    hasMergeBlock: graph.nodes.some((n) => n.type === 'checks' && (n.place ?? 'merge') === 'merge'),
  };
}

/**
 * The roles a node may act as for the arrow matrix: its derived role, or every role it claims when
 * they are mixed (that is `agent-mixed-roles`, reported once, not again on each arrow). A gate or
 * an agent without a role has none.
 */
export function claimsOf(index: NodeIndexV3, node: WorkflowNodeV3): readonly RoleClaim[] {
  return index.roles.get(node.id)?.claims ?? [];
}

export function isClaim(index: NodeIndexV3, node: WorkflowNodeV3, claim: RoleClaim): boolean {
  return node.type === 'agent' && claimsOf(index, node).includes(claim);
}

/** A helper or tester: an agent whose change is reviewed. */
export function isEditorV3(index: NodeIndexV3, node: WorkflowNodeV3): boolean {
  return isClaim(index, node, 'worker') || isClaim(index, node, 'tester');
}

export function isChangeReviewerV3(index: NodeIndexV3, node: WorkflowNodeV3): boolean {
  return isClaim(index, node, 'change-reviewer');
}

/** A node that runs after the ticket merge: a final reviewer or a tester. */
export function isFinalStageV3(index: NodeIndexV3, node: WorkflowNodeV3): boolean {
  return isClaim(index, node, 'final-reviewer') || isClaim(index, node, 'tester');
}

/** The node's single derived role claim, or undefined without one or with mixed roles. */
export function roleClaimOf(index: NodeIndexV3, node: WorkflowNodeV3): RoleClaim | undefined {
  const r = index.roles.get(node.id);
  return r?.ok === true ? r.claims[0] : undefined;
}

/** The agents whose single role is `claim`, in graph order. */
export function agentsWithRole(index: NodeIndexV3, claim: RoleClaim): WorkflowNodeV3Of<'agent'>[] {
  return index.unique.filter(
    (n): n is WorkflowNodeV3Of<'agent'> => n.type === 'agent' && roleClaimOf(index, n) === claim,
  );
}

export function edgesOfTypeV3<T extends WorkflowEdgeTypeV3>(
  edges: readonly WorkflowEdgeV3[],
  type: T,
): Extract<WorkflowEdgeV3, { type: T }>[] {
  return edges.filter((e): e is Extract<WorkflowEdgeV3, { type: T }> => e.type === type);
}

/** The single node of a type, or undefined when there is none or more than one. */
export function singleOfTypeV3<T extends WorkflowNodeTypeV3>(
  graph: Pick<WorkflowGraphV3, 'nodes'>,
  type: T,
): WorkflowNodeV3Of<T> | undefined {
  const all = graph.nodes.filter((n): n is WorkflowNodeV3Of<T> => n.type === type);
  return all.length === 1 ? all[0] : undefined;
}
