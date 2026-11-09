import type {
  WorkflowEdgeV3,
  WorkflowGraphV3,
  WorkflowNodeId,
  WorkflowNodeV3,
} from '../../workflow-graph.js';

/**
 * Roles from arrows (ADR-0037 §1). An `agent` block stores no role: this module reads it from the
 * arrows, and every layer that follows `kind` (tools, worktree, approvals, read-only rules) keeps
 * following the derived role. An arrow can only make a block one of these roles; no arrow can give
 * a read-only role edit rights.
 */

/**
 * - `planner`, `researcher`, `reviewer` and `lead` are read-only; `worker` (a helper) and `tester`
 *   edit in their own worktree;
 * - a reviewer's `scope`: `change` reviews helpers' and testers' changes (a `review` arrow in),
 *   `final` reads the merged ticket branch on the final chain (a `flow` arrow in from it);
 * - a worker's `pool`: it is the helper pool (`AgentNode.pool`).
 */
export type DerivedRole =
  | { role: 'lead' }
  | { role: 'planner' }
  | { role: 'researcher' }
  | { role: 'worker'; pool: boolean }
  | { role: 'reviewer'; scope: 'change' | 'final' }
  | { role: 'tester' };

export type GraphAgentRole = DerivedRole['role'];

/** A role name that tells a change reviewer from a final one, for claims and messages. */
export type RoleClaim =
  'planner' | 'researcher' | 'worker' | 'change-reviewer' | 'final-reviewer' | 'tester';

/**
 * One agent's derivation: its role, or why it has none. `claims` are the roles its arrows ask for,
 * in a fixed order; more than one is `agent-mixed-roles`, none is `agent-without-role`.
 */
export type RoleResult =
  | { ok: true; role: DerivedRole; claims: readonly RoleClaim[] }
  | { ok: false; code: 'agent-without-role' | 'agent-mixed-roles'; claims: readonly RoleClaim[] };

const CLAIM_ORDER: readonly RoleClaim[] = [
  'researcher',
  'planner',
  'worker',
  'change-reviewer',
  'final-reviewer',
  'tester',
];

/** Gates a final chain arrow (`flow` into a final reviewer, `test` into a tester) may leave from. */
function isChainSource(node: WorkflowNodeV3): boolean {
  return node.type === 'ticket-merge' || node.type === 'checks' || node.type === 'agent';
}

/**
 * The role an arrow claims for an agent at one of its ends, or null. Only the node types matter
 * here; whether the arrow is allowed between the two roles is `canConnectV3`'s answer.
 */
export function claimOf(
  edge: Pick<WorkflowEdgeV3, 'type'>,
  from: WorkflowNodeV3,
  to: WorkflowNodeV3,
): { nodeId: WorkflowNodeId; claim: RoleClaim } | null {
  switch (edge.type) {
    case 'research':
      return from.type === 'agent' ? { nodeId: from.id, claim: 'researcher' } : null;
    case 'plan':
      return from.type === 'agent' && to.type === 'plan-approval'
        ? { nodeId: from.id, claim: 'planner' }
        : null;
    case 'implement':
      return from.type === 'lead' && to.type === 'agent'
        ? { nodeId: to.id, claim: 'worker' }
        : null;
    case 'review':
      return from.type === 'agent' && to.type === 'agent'
        ? { nodeId: to.id, claim: 'change-reviewer' }
        : null;
    case 'flow':
      return to.type === 'agent' && from.id !== to.id && isChainSource(from)
        ? { nodeId: to.id, claim: 'final-reviewer' }
        : null;
    case 'test':
      return to.type === 'agent' && from.id !== to.id && isChainSource(from)
        ? { nodeId: to.id, claim: 'tester' }
        : null;
    case 'findings':
    case 'rework':
    case 'merge':
    case 'custom':
      return null;
  }
}

function roleOfClaim(claim: RoleClaim, node: WorkflowNodeV3): DerivedRole {
  switch (claim) {
    case 'planner':
      return { role: 'planner' };
    case 'researcher':
      return { role: 'researcher' };
    case 'worker':
      return { role: 'worker', pool: node.type === 'agent' && node.pool === true };
    case 'change-reviewer':
      return { role: 'reviewer', scope: 'change' };
    case 'final-reviewer':
      return { role: 'reviewer', scope: 'final' };
    case 'tester':
      return { role: 'tester' };
  }
}

/**
 * The derived role of every agent and the lead, by node id (gates have none). Pure. With duplicate
 * node ids the first node wins, as in every other rule. `extra` adds arrows as if drawn, which is
 * how `canConnectV3` asks what a new arrow would do.
 */
export function deriveRoles(
  graph: Pick<WorkflowGraphV3, 'nodes' | 'edges'>,
  extra: readonly Pick<WorkflowEdgeV3, 'type' | 'from' | 'to'>[] = [],
): Map<WorkflowNodeId, RoleResult> {
  const byId = new Map<WorkflowNodeId, WorkflowNodeV3>();
  for (const node of graph.nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const claims = new Map<WorkflowNodeId, Set<RoleClaim>>();
  for (const edge of [...graph.edges, ...extra]) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const claim = claimOf(edge, from, to);
    if (claim === null) continue;
    const set = claims.get(claim.nodeId) ?? new Set<RoleClaim>();
    set.add(claim.claim);
    claims.set(claim.nodeId, set);
  }
  const out = new Map<WorkflowNodeId, RoleResult>();
  for (const node of byId.values()) {
    if (node.type === 'lead') {
      out.set(node.id, { ok: true, role: { role: 'lead' }, claims: [] });
      continue;
    }
    if (node.type !== 'agent') continue;
    const set = claims.get(node.id) ?? new Set<RoleClaim>();
    const list = CLAIM_ORDER.filter((c) => set.has(c));
    const only = list[0];
    if (only === undefined) out.set(node.id, { ok: false, code: 'agent-without-role', claims: [] });
    else if (list.length > 1)
      out.set(node.id, { ok: false, code: 'agent-mixed-roles', claims: list });
    else out.set(node.id, { ok: true, role: roleOfClaim(only, node), claims: list });
  }
  return out;
}

/** What the owner calls each claimed role in messages. */
export const ROLE_CLAIM_NAMES: Readonly<Record<RoleClaim, string>> = Object.freeze({
  planner: 'planner',
  researcher: 'researcher',
  worker: 'helper',
  'change-reviewer': 'change reviewer',
  'final-reviewer': 'final reviewer',
  tester: 'tester',
});
