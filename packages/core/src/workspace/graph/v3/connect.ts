import type {
  WorkflowEdgeTypeV3,
  WorkflowEdgeV3,
  WorkflowGraphV3,
  WorkflowNodeId,
  WorkflowNodeV3,
} from '../../workflow-graph.js';
import { isCheckBlockAt } from '../check-blocks.js';
import type { ConnectIssueCode, ConnectResult } from '../connect.js';
import { q } from '../graph-index.js';
import {
  indexNodesV3,
  isChangeReviewerV3,
  isClaim,
  isEditorV3,
  isFinalStageV3,
  type NodeIndexV3,
} from './graph-index.js';
import { failureSourceKind, isWhenTarget } from './failure-routes.js';
import { ROLE_CLAIM_NAMES, claimOf } from './roles.js';

/**
 * The version 3 arrow matrix (ADR-0037 §2, docs/arrows/README.md). The roles are the derived ones
 * (`deriveRoles`), so the matrix reads the same as version 2's with block types replaced by roles:
 *
 * - `flow`: the plan path (`ticket → planner(s) → … → plan-approval → lead`, or
 *   `ticket → lead → plan-approval` without a planner), `checks → ticket-merge` for the block
 *   before the merge, the final chain (`ticket-merge` | final stage | branch block → final
 *   reviewer | branch block | `owner-merge`, never one branch block to another), `owner-merge →
 *   done`, and a helper's or tester's change into a change block;
 * - `research`: researcher → any other agent or the lead;
 * - `plan`: planner → plan-approval;
 * - `implement`: lead → helper;
 * - `review`: helper | tester → change reviewer | lead;
 * - `findings`: change reviewer → lead;
 * - `rework`: change reviewer | lead | change block → helper | tester;
 * - `test`: `ticket-merge` | final stage | branch block → tester;
 * - `custom`: agent → another agent (no role either way);
 * - `merge`: lead → the block before the merge; without one, lead → the ticket merge;
 * - `when` (ADR-0038 §4): tester | Checks block | change reviewer | ticket merge → helper | Lead |
 *   Author block. A target that is none of those is `when-target-invalid` (a When arrow never
 *   gives a role); the Author block takes no other arrow and has none out.
 *
 * An arrow that would give an agent a second role is refused (`canConnectV3` asks with the arrow
 * drawn); in a stored graph that agent is `agent-mixed-roles` instead, and its arrows are checked
 * against each of its claimed roles so the mix is reported once.
 */

function isAgent(node: WorkflowNodeV3): boolean {
  return node.type === 'agent';
}

function allowedV3(
  from: WorkflowNodeV3,
  to: WorkflowNodeV3,
  type: WorkflowEdgeTypeV3,
  index: NodeIndexV3,
): boolean {
  switch (type) {
    case 'flow':
      if (isCheckBlockAt(to, 'change')) return isEditorV3(index, from);
      switch (from.type) {
        case 'ticket':
          return isClaim(index, to, 'planner') || (to.type === 'lead' && !index.hasPlanner);
        case 'plan-approval':
          return to.type === 'lead' && index.hasPlanner;
        case 'lead':
          return to.type === 'plan-approval' && !index.hasPlanner;
        case 'checks':
          if (isCheckBlockAt(from, 'merge')) return to.type === 'ticket-merge';
          return (
            isCheckBlockAt(from, 'branch') &&
            (isClaim(index, to, 'final-reviewer') || to.type === 'owner-merge')
          );
        case 'owner-merge':
          return to.type === 'done';
        default:
          return (
            (from.type === 'ticket-merge' || isFinalStageV3(index, from)) &&
            (isClaim(index, to, 'final-reviewer') ||
              to.type === 'owner-merge' ||
              isCheckBlockAt(to, 'branch'))
          );
      }
    case 'research':
      return isClaim(index, from, 'researcher') && (isAgent(to) || to.type === 'lead');
    case 'plan':
      return isClaim(index, from, 'planner') && to.type === 'plan-approval';
    case 'implement':
      return from.type === 'lead' && isClaim(index, to, 'worker');
    case 'review':
      return isEditorV3(index, from) && (isChangeReviewerV3(index, to) || to.type === 'lead');
    case 'findings':
      return isChangeReviewerV3(index, from) && to.type === 'lead';
    case 'rework':
      return (
        (isChangeReviewerV3(index, from) ||
          from.type === 'lead' ||
          isCheckBlockAt(from, 'change')) &&
        isEditorV3(index, to)
      );
    case 'test':
      return (
        (from.type === 'ticket-merge' ||
          isFinalStageV3(index, from) ||
          isCheckBlockAt(from, 'branch')) &&
        isClaim(index, to, 'tester')
      );
    case 'custom':
      return isAgent(from) && isAgent(to);
    case 'merge':
      if (from.type !== 'lead') return false;
      return index.hasMergeBlock ? isCheckBlockAt(to, 'merge') : to.type === 'ticket-merge';
    case 'when':
      // The target is checked after the matrix, so it is reported as `when-target-invalid`.
      return failureSourceKind(index, from) !== undefined;
  }
}

const EDGE_RULES_V3: Readonly<Record<WorkflowEdgeTypeV3, string>> = Object.freeze({
  flow: 'A flow link follows the plan path (Ticket, the planners or the Lead, Plan approval) or the steps after the ticket merge (final reviewers, testers and the Checks block on the ticket branch, then your merge, then Done), or takes a helper’s or tester’s change to a Checks block on the change.',
  research: 'A research link goes from a researcher to another agent or to the Lead.',
  plan: 'A plan link goes from a planner to Plan approval.',
  implement: 'Only the Lead gives work to an agent, which makes it a helper.',
  review: 'A helper or tester sends its change for review to a change reviewer or to the Lead.',
  findings: 'A change reviewer sends its findings to the Lead.',
  rework:
    'A change reviewer, the Lead or a Checks block on the change sends a helper’s or tester’s change back for rework.',
  test: 'A test link goes from the ticket merge or a step after it to a tester.',
  custom: 'A custom link goes from one agent to another.',
  merge:
    'Only the Lead merges, through the Checks block before the merge, or straight into the ticket branch when the workflow has no such block.',
  when: 'A When link goes from where a failure happens (a tester, a Checks block, a change reviewer or the ticket merge) to who fixes it (a helper, the Lead or the Author block).',
});

const EDGE_VERBS_V3: Readonly<Record<WorkflowEdgeTypeV3, string>> = Object.freeze({
  flow: 'flow to',
  research: 'research for',
  plan: 'send a plan to',
  implement: 'give work to',
  review: 'send its change for review to',
  findings: 'send findings to',
  rework: 'send work back to',
  test: 'hand the ticket branch for tests to',
  custom: 'hand off to',
  merge: 'merge through',
  when: 'send failures to',
});

function edgeHintV3(
  from: WorkflowNodeV3,
  to: WorkflowNodeV3,
  type: WorkflowEdgeTypeV3,
  index: NodeIndexV3,
): string {
  if (type === 'merge' && from.type === 'lead' && to.type === 'ticket-merge') {
    return ' The workflow has a Checks block before the merge, so the Lead merges through it.';
  }
  if (index.hasPlanner && from.type === 'ticket' && to.type === 'lead') {
    return ' With a planner, the ticket goes to the planners first.';
  }
  if (index.hasPlanner && from.type === 'lead' && to.type === 'plan-approval') {
    return ' With a planner, the plan goes from the planners to Plan approval, then to the Lead.';
  }
  if (!index.hasPlanner && from.type === 'plan-approval' && to.type === 'lead') {
    return ' Without a planner, the Lead writes the plan and sends it to Plan approval.';
  }
  return '';
}

function refuse(code: ConnectIssueCode, message: string): ConnectResult {
  return { ok: false, code, message };
}

/**
 * The arrow check against the nodes and the first `upTo` arrows (for duplicates), with the roles
 * of `index`. The validator checks arrow `i` with the whole graph's roles; the editor asks
 * `canConnectV3`, which first derives the roles with the new arrow drawn.
 */
export function checkConnectionV3(
  index: NodeIndexV3,
  edges: readonly WorkflowEdgeV3[],
  upTo: number,
  fromId: WorkflowNodeId,
  toId: WorkflowNodeId,
  type: WorkflowEdgeTypeV3,
): ConnectResult {
  const from = index.byId.get(fromId);
  const to = index.byId.get(toId);
  if (from === undefined || to === undefined) {
    const missing = from === undefined ? fromId : toId;
    return refuse(
      'edge-unknown-node',
      `A ${type} link points to a block that is not in the workflow ("${missing}").`,
    );
  }
  if (fromId === toId) return refuse('self-edge', `${q(from)} cannot be linked to itself.`);
  if (!allowedV3(from, to, type, index)) {
    return refuse(
      'edge-not-allowed',
      `${q(from)} cannot ${EDGE_VERBS_V3[type]} ${q(to)}. ${EDGE_RULES_V3[type]}${edgeHintV3(from, to, type, index)}`,
    );
  }
  if (type === 'when' && !isWhenTarget(index, to)) {
    return refuse(
      'when-target-invalid',
      `${q(to)} cannot fix the failures ${q(from)} sends. A When link goes to a helper, the Lead or the Author block, and never gives a block a role: make ${q(to)} a helper first, or choose another block.`,
    );
  }
  for (let i = 0; i < upTo; i++) {
    const e = edges[i];
    if (e !== undefined && e.type === type && e.from === fromId && e.to === toId) {
      return refuse('duplicate-edge', `${q(from)} already has a ${type} link to ${q(to)}.`);
    }
  }
  return { ok: true };
}

/**
 * Whether the owner may draw a `type` arrow from `fromId` to `toId` in `graph`: both nodes exist,
 * it is not a self arrow, it would not give an agent a second role, the matrix allows it with the
 * roles it gives, and the graph has no such arrow yet.
 */
export function canConnectV3(
  graph: Pick<WorkflowGraphV3, 'nodes' | 'edges'>,
  fromId: WorkflowNodeId,
  toId: WorkflowNodeId,
  type: WorkflowEdgeTypeV3,
): ConnectResult {
  const index = indexNodesV3(graph, [{ type, from: fromId, to: toId }]);
  const from = index.byId.get(fromId);
  const to = index.byId.get(toId);
  if (from !== undefined && to !== undefined && fromId !== toId) {
    const claim = claimOf({ type }, from, to);
    const target = claim === null ? undefined : index.byId.get(claim.nodeId);
    const result = claim === null ? undefined : index.roles.get(claim.nodeId);
    if (target !== undefined && result !== undefined && result.ok === false) {
      const others = result.claims.filter((c) => c !== claim?.claim);
      return refuse(
        'edge-not-allowed',
        `${q(target)} is already a ${others.map((c) => ROLE_CLAIM_NAMES[c]).join(' and ')}; this link would also make it a ${claim === null ? '' : ROLE_CLAIM_NAMES[claim.claim]}. An agent has one role: add another agent block instead.`,
      );
    }
  }
  return checkConnectionV3(index, graph.edges, graph.edges.length, fromId, toId, type);
}
