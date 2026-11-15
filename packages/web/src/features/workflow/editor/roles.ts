import {
  deriveRoles,
  type RoleResult,
  type WorkflowGraphV3,
  type WorkflowNodeId,
  type WorkflowNodeV3,
} from '@acp/core';

/**
 * What each agent block is, as the editor shows it (ADR-0037 §1). An `agent` block stores no role:
 * core's `deriveRoles` reads it from the arrows, and this module turns its answer into the editor's
 * words, sizes and rows. The roles are always read from the stored graph (never the Finish view,
 * whose redrawn links would hide the final chain's arrows).
 *
 * - `helper` / `helper-pool`: a worker (an `implement` arrow in), the pool when `pool` is set;
 * - `reviewer-change` / `reviewer-final`: a `review` arrow in, or the final chain's flow in;
 * - `agent`: no arrow gives it a role yet (`agent-without-role`);
 * - `mixed`: its arrows ask for two roles (`agent-mixed-roles`).
 */
export type AgentKind =
  | 'researcher'
  | 'planner'
  | 'helper'
  | 'helper-pool'
  | 'reviewer-change'
  | 'reviewer-final'
  | 'tester'
  | 'agent'
  | 'mixed';

/** What a block is: the lead, a gate (its own type), or an agent's derived kind. */
export type BlockKind = AgentKind | Exclude<WorkflowNodeV3['type'], 'agent'>;

export interface GraphRoles {
  /** Core's answer per agent and the lead. */
  results: ReadonlyMap<WorkflowNodeId, RoleResult>;
  /** The editor's kind per agent block. */
  kinds: ReadonlyMap<WorkflowNodeId, AgentKind>;
}

function kindOf(result: RoleResult | undefined): AgentKind {
  if (result === undefined || !result.ok) {
    return result?.ok === false && result.code === 'agent-mixed-roles' ? 'mixed' : 'agent';
  }
  const role = result.role;
  switch (role.role) {
    case 'researcher':
    case 'planner':
    case 'tester':
      return role.role;
    case 'worker':
      return role.pool ? 'helper-pool' : 'helper';
    case 'reviewer':
      return role.scope === 'change' ? 'reviewer-change' : 'reviewer-final';
    case 'lead':
      // Never for an agent block; kept total.
      return 'agent';
  }
}

// One derivation per graph object: the reducer never mutates a graph, so its identity is its value.
const cache = new WeakMap<Pick<WorkflowGraphV3, 'nodes' | 'edges'>, GraphRoles>();

/** Every agent block's role, derived once per graph (pure; cached by the graph's identity). */
export function graphRoles(graph: Pick<WorkflowGraphV3, 'nodes' | 'edges'>): GraphRoles {
  const hit = cache.get(graph);
  if (hit !== undefined) return hit;
  const results = deriveRoles(graph);
  const kinds = new Map<WorkflowNodeId, AgentKind>();
  for (const node of graph.nodes) {
    if (node.type === 'agent') kinds.set(node.id, kindOf(results.get(node.id)));
  }
  const roles = { results, kinds };
  cache.set(graph, roles);
  return roles;
}

/** A block's kind in `roles` (an agent's derived kind, else its type). */
export function kindIn(roles: GraphRoles, node: WorkflowNodeV3): BlockKind {
  return node.type === 'agent' ? (roles.kinds.get(node.id) ?? 'agent') : node.type;
}

/** A block's kind in `graph`. */
export function blockKind(
  graph: Pick<WorkflowGraphV3, 'nodes' | 'edges'>,
  node: WorkflowNodeV3,
): BlockKind {
  return kindIn(graphRoles(graph), node);
}

/** Kinds that change files in their own worktree (and so have an approval mode). */
export function isEditingKind(kind: BlockKind): boolean {
  return kind === 'helper' || kind === 'helper-pool' || kind === 'tester';
}

/** An agent block with no role or two: the editor shows it in its error state. */
export function isRoleProblem(kind: BlockKind): boolean {
  return kind === 'agent' || kind === 'mixed';
}

/** A final-chain kind: a final reviewer or a tester. */
export function isFinalKind(kind: BlockKind): boolean {
  return kind === 'reviewer-final' || kind === 'tester';
}
