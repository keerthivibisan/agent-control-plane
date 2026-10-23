import type {
  GraphIssueCode,
  WorkflowEdge,
  WorkflowEdgeType,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
} from '../workflow-graph.js';
import { isCheckBlockAt } from './check-blocks.js';
import {
  indexNodes,
  isChangeReviewer,
  isFinalStage,
  isHelperNode,
  q,
  type NodeIndex,
} from './graph-index.js';

/**
 * The edge-type matrix (ADR-0023 §3, README §2 and WG-0 refinements 1–3). The editor calls
 * `canConnect` on every drag; the validator runs the same check on every stored edge, so the two
 * can never disagree.
 *
 * - `flow` follows the plan path and the final chain only:
 *   - the plan path is `ticket → planner → plan-approval → lead` with a planner, and
 *     `ticket → lead → plan-approval` without one (the lead writes the plan itself, so the plan
 *     gate is the end of its plan path). So `ticket → lead` and `lead → plan-approval` are allowed
 *     only without a planner, and `plan-approval → lead` only with one;
 *   - `checks → ticket-merge` for the block before the lead's merge (place `merge`, the default);
 *   - the final chain: `ticket-merge` | final reviewer | tester | branch block → final reviewer |
 *     tester | branch block | `owner-merge` (never one branch block to another), then
 *     `owner-merge → done`;
 *   - a change block (ADR-0027 §5): `helper` | `helper-pool` | `tester` → change block. Nothing
 *     flows out of it: the change goes on to its review route;
 * - `assigns`: lead → `helper` | `helper-pool`;
 * - `review`: `helper` | `helper-pool` | `tester` → change reviewer | lead;
 * - `findings`: change reviewer → lead;
 * - `rework`: change reviewer | lead | change block → `helper` | `helper-pool` | `tester`;
 * - `merge`: lead → the block before the lead's merge.
 *
 * Which helper a change block may send back, and when, are path rules (`check-rework`), as is a
 * reviewer's rework without its review: the matrix looks at the two ends only.
 */

/** The issue codes an edge can fail `canConnect` with; the validator reports exactly these. */
export type ConnectIssueCode = Extract<
  GraphIssueCode,
  'edge-unknown-node' | 'self-edge' | 'edge-not-allowed' | 'duplicate-edge'
>;

export type ConnectResult = { ok: true } | { ok: false; code: ConnectIssueCode; message: string };

const OK: ConnectResult = Object.freeze({ ok: true });

function isEditor(node: WorkflowNode): boolean {
  return isHelperNode(node) || node.type === 'tester';
}

/** True when the matrix allows `type` from `from` to `to` (planner presence matters for flow). */
function allowed(
  from: WorkflowNode,
  to: WorkflowNode,
  type: WorkflowEdgeType,
  hasPlanner: boolean,
): boolean {
  switch (type) {
    case 'flow':
      if (isCheckBlockAt(to, 'change')) return isEditor(from);
      switch (from.type) {
        case 'ticket':
          return to.type === 'planner' || (to.type === 'lead' && !hasPlanner);
        case 'planner':
          return to.type === 'plan-approval';
        case 'plan-approval':
          return to.type === 'lead' && hasPlanner;
        case 'lead':
          return to.type === 'plan-approval' && !hasPlanner;
        case 'checks':
          if (isCheckBlockAt(from, 'merge')) return to.type === 'ticket-merge';
          return isCheckBlockAt(from, 'branch') && (isFinalStage(to) || to.type === 'owner-merge');
        case 'owner-merge':
          return to.type === 'done';
        default:
          return (
            (from.type === 'ticket-merge' || isFinalStage(from)) &&
            (isFinalStage(to) || to.type === 'owner-merge' || isCheckBlockAt(to, 'branch'))
          );
      }
    case 'assigns':
      return from.type === 'lead' && isHelperNode(to);
    case 'review':
      return isEditor(from) && (isChangeReviewer(to) || to.type === 'lead');
    case 'findings':
      return isChangeReviewer(from) && to.type === 'lead';
    case 'rework':
      return (
        (isChangeReviewer(from) || from.type === 'lead' || isCheckBlockAt(from, 'change')) &&
        isEditor(to)
      );
    case 'merge':
      return from.type === 'lead' && isCheckBlockAt(to, 'merge');
  }
}

/** What each edge type is for, in the owner's words, to explain a refusal. */
const EDGE_RULES: Readonly<Record<WorkflowEdgeType, string>> = Object.freeze({
  flow: 'A flow link follows the plan path (Ticket, the planner or the Lead, Plan approval) or the steps after the ticket merge (final reviewers, testers and the Checks block on the ticket branch, then your merge, then Done), or takes a helper’s or tester’s change to a Checks block on the change.',
  assigns: 'Only the Lead assigns work, to a helper block.',
  review: 'A helper or tester sends its change for review to a change reviewer or to the Lead.',
  findings: 'A change reviewer sends its findings to the Lead.',
  rework:
    'A change reviewer, the Lead or a Checks block on the change sends a helper’s or tester’s change back for rework.',
  merge: 'Only the Lead merges, through the Checks block before the merge.',
});

const EDGE_VERBS: Readonly<Record<WorkflowEdgeType, string>> = Object.freeze({
  flow: 'flow to',
  assigns: 'assign work to',
  review: 'send its change for review to',
  findings: 'send findings to',
  rework: 'send work back to',
  merge: 'merge through',
});

function planHint(from: WorkflowNode, to: WorkflowNode, hasPlanner: boolean): string {
  if (hasPlanner && from.type === 'ticket' && to.type === 'lead') {
    return ' With a planner, the ticket goes to the planner first.';
  }
  if (hasPlanner && from.type === 'lead' && to.type === 'plan-approval') {
    return ' With a planner, the plan goes from the planner to Plan approval, then to the Lead.';
  }
  if (!hasPlanner && from.type === 'plan-approval' && to.type === 'lead') {
    return ' Without a planner, the Lead writes the plan and sends it to Plan approval.';
  }
  return '';
}

/**
 * The edge check against the nodes and the first `upTo` edges. The validator checks edge `i`
 * against the edges before it, as if the owner had drawn them in order; the editor checks a new
 * edge against all of them.
 */
export function checkConnection(
  index: NodeIndex,
  edges: readonly WorkflowEdge[],
  upTo: number,
  fromId: WorkflowNodeId,
  toId: WorkflowNodeId,
  type: WorkflowEdgeType,
): ConnectResult {
  const from = index.byId.get(fromId);
  const to = index.byId.get(toId);
  if (from === undefined || to === undefined) {
    const missing = from === undefined ? fromId : toId;
    return {
      ok: false,
      code: 'edge-unknown-node',
      message: `A ${type} link points to a block that is not in the workflow ("${missing}").`,
    };
  }
  if (fromId === toId) {
    return {
      ok: false,
      code: 'self-edge',
      message: `${q(from)} cannot be linked to itself.`,
    };
  }
  if (!allowed(from, to, type, index.hasPlanner)) {
    return {
      ok: false,
      code: 'edge-not-allowed',
      message: `${q(from)} cannot ${EDGE_VERBS[type]} ${q(to)}. ${EDGE_RULES[type]}${planHint(from, to, index.hasPlanner)}`,
    };
  }
  for (let i = 0; i < upTo; i++) {
    const e = edges[i];
    if (e !== undefined && e.type === type && e.from === fromId && e.to === toId) {
      return {
        ok: false,
        code: 'duplicate-edge',
        message: `${q(from)} already has a ${type} link to ${q(to)}.`,
      };
    }
  }
  return OK;
}

/**
 * Whether the owner may draw a `type` edge from `fromId` to `toId` in `graph`: both nodes exist,
 * the edge is not a self edge, the matrix allows it, and the graph has no such edge yet.
 */
export function canConnect(
  graph: Pick<WorkflowGraph, 'nodes' | 'edges'>,
  fromId: WorkflowNodeId,
  toId: WorkflowNodeId,
  type: WorkflowEdgeType,
): ConnectResult {
  return checkConnection(
    indexNodes(graph.nodes),
    graph.edges,
    graph.edges.length,
    fromId,
    toId,
    type,
  );
}
