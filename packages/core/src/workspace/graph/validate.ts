import type { ApprovalMode, HarnessManifest } from '../workspace.js';
import { HARD_MAX_HELPERS } from '../workspace.js';
import { checkSelectionIssues } from '../harness-select.js';
import {
  CHECK_FAILURE_ROUTES,
  NODE_CAPABILITIES,
  WORKFLOW_NODE_TYPES,
  isAgentNode,
  isEditorNode,
  type GraphIssue,
  type GraphIssueCode,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeId,
  type WorkflowNodeOf,
} from '../workflow-graph.js';
import {
  CHECK_FAILURE_ROUTE_NAMES,
  CHECK_PLACE_NAMES,
  checkBlockOf,
  isCheckBlockAt,
} from './check-blocks.js';
import { checkConnection } from './connect.js';
import {
  NODE_TYPE_NAMES,
  clip,
  edgesOfType,
  indexNodes,
  isChangeReviewer,
  isFinalStage,
  isHelperNode,
  q,
  singleOfType,
  type NodeIndex,
} from './graph-index.js';

/** What the validator may know besides the graph. Each check runs only when its field is given. */
export interface ValidateGraphContext {
  /** The project's skill names: a node naming another one gets `missing-skill`. */
  skills?: readonly string[];
  /** The project's agent file names: a node naming another one gets `missing-agent-file`. */
  agents?: readonly string[];
  /** The project's helper limit: a named helper allowing more gets `instances-over-limit`. */
  maxConcurrentHelpers?: number;
  /** The project's approval mode, used for editing nodes without their own (mode warnings). */
  projectMode?: ApprovalMode;
  /**
   * The project's harness file, or null when it has none: each Checks block's selection is
   * checked against it (`checkSelectionIssues`, warnings only). Absent: not checked.
   */
  harness?: Pick<HarnessManifest, 'checks'> | null;
}

/**
 * Words a named helper may not be called, compared trimmed, ignoring case and repeated spaces.
 * A plan step or `start_agent` names a helper by its label (ADR-0023 §7), so a helper called like
 * a coordinator or another role would be ambiguous: these are the coordinator words the engine
 * refuses as plan-step roles (`isNonHelperRole`), the other node types, the owner, and the pool's
 * generic names.
 */
export const RESERVED_HELPER_LABELS: readonly string[] = Object.freeze([
  'lead',
  'the lead',
  'lead agent',
  'planner',
  'orchestrator',
  'coordinator',
  'reviewer',
  'change reviewer',
  'code reviewer',
  'tester',
  'owner',
  'you',
  'helper',
  'helpers',
  'helper pool',
  'pool',
]);

function normalLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isReservedHelperLabel(label: string): boolean {
  return RESERVED_HELPER_LABELS.includes(normalLabel(label));
}

/** Builds issues with optional ids, which `exactOptionalPropertyTypes` wants left out, not undefined. */
class Issues {
  readonly list: GraphIssue[] = [];
  error(code: GraphIssueCode, message: string, ids: { nodeId?: string; edgeId?: string } = {}) {
    this.push('error', code, message, ids);
  }
  warning(code: GraphIssueCode, message: string, ids: { nodeId?: string; edgeId?: string } = {}) {
    this.push('warning', code, message, ids);
  }
  private push(
    severity: GraphIssue['severity'],
    code: GraphIssueCode,
    message: string,
    ids: { nodeId?: string; edgeId?: string },
  ) {
    this.list.push({
      code,
      severity,
      message: clip(message),
      ...(ids.nodeId !== undefined ? { nodeId: ids.nodeId } : {}),
      ...(ids.edgeId !== undefined ? { edgeId: ids.edgeId } : {}),
    });
  }
}

/** The shared state of one validation: the node index and the edges that passed `canConnect`. */
interface Scope {
  readonly graph: WorkflowGraph;
  readonly index: NodeIndex;
  /** Edges that pass the edge check; every path rule reads only these. */
  readonly valid: readonly WorkflowEdge[];
  readonly issues: Issues;
}

function has(
  valid: readonly WorkflowEdge[],
  type: WorkflowEdge['type'],
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): boolean {
  return valid.some((e) => e.type === type && e.from === from && e.to === to);
}

// ---------------------------------------------------------------- rules, in report order

function checkIds(graph: WorkflowGraph, issues: Issues): void {
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.error('duplicate-node-id', `Two blocks share the id "${node.id}" (${q(node)}).`, {
        nodeId: node.id,
      });
    }
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.error('duplicate-edge-id', `Two links share the id "${edge.id}".`, {
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);
  }
}

/** Every edge against `canConnect`'s matrix; returns the edges that pass. */
function checkEdges(graph: WorkflowGraph, index: NodeIndex, issues: Issues): WorkflowEdge[] {
  const valid: WorkflowEdge[] = [];
  graph.edges.forEach((edge, i) => {
    const result = checkConnection(index, graph.edges, i, edge.from, edge.to, edge.type);
    if (result.ok) valid.push(edge);
    else issues.error(result.code, result.message, { edgeId: edge.id });
  });
  return valid;
}

function checksNodes(nodes: readonly WorkflowNode[]): WorkflowNodeOf<'checks'>[] {
  return nodes.filter((n): n is WorkflowNodeOf<'checks'> => n.type === 'checks');
}

/**
 * ADR-0027 §5: exactly one block before the lead's merge (the mandatory block, so no graph merges
 * a change without checks), at most one on the ticket branch. Change blocks are bounded by the
 * editing nodes (each flows into at most one, `many-check-blocks`) and the graph's node limit.
 */
function checkBlockCounts(graph: WorkflowGraph, issues: Issues): void {
  const blocks = checksNodes(graph.nodes);
  const merge = blocks.filter((n) => isCheckBlockAt(n, 'merge'));
  if (merge.length === 0) {
    issues.error(
      'missing-node',
      blocks.length === 0
        ? 'The workflow needs a Checks block.'
        : 'The workflow needs a Checks block before the Lead’s merge, so no change is merged without checks.',
    );
  }
  const extraMerge = merge[1];
  if (extraMerge !== undefined) {
    issues.error(
      'too-many-nodes',
      blocks.length === merge.length
        ? `The workflow can have only one Checks block; ${q(extraMerge)} is one too many.`
        : `The workflow can have only one Checks block before the Lead’s merge; ${q(extraMerge)} is one too many.`,
      { nodeId: extraMerge.id },
    );
  }
  const extraBranch = blocks.filter((n) => isCheckBlockAt(n, 'branch'))[1];
  if (extraBranch !== undefined) {
    issues.error(
      'too-many-nodes',
      `The workflow can have only one Checks block on the ticket branch; ${q(extraBranch)} is one too many.`,
      { nodeId: extraBranch.id },
    );
  }
}

function checkCounts(graph: WorkflowGraph, issues: Issues): void {
  for (const type of WORKFLOW_NODE_TYPES) {
    if (type === 'checks') {
      checkBlockCounts(graph, issues);
      continue;
    }
    const all = graph.nodes.filter((n) => n.type === type);
    const { minPerGraph, maxPerGraph } = NODE_CAPABILITIES[type];
    if (all.length < minPerGraph) {
      issues.error('missing-node', `The workflow needs a ${NODE_TYPE_NAMES[type]} block.`);
    }
    const extra = all[maxPerGraph];
    if (extra === undefined) continue;
    if (type === 'helper') {
      issues.error(
        'too-many-helpers',
        `The workflow has ${all.length} named helpers; at most ${HARD_MAX_HELPERS} are allowed.`,
        { nodeId: extra.id },
      );
    } else {
      issues.error(
        'too-many-nodes',
        maxPerGraph === 1
          ? `The workflow can have only one ${NODE_TYPE_NAMES[type]} block; ${q(extra)} is one too many.`
          : `The workflow can have at most ${maxPerGraph} ${NODE_TYPE_NAMES[type]} blocks; ${q(extra)} is one too many.`,
        { nodeId: extra.id },
      );
    }
  }
  if (!graph.nodes.some(isHelperNode)) {
    issues.error(
      'no-helpers',
      'The workflow needs at least one helper block (the helper pool or a named helper) to do the work.',
    );
  }
  const labels = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type !== 'helper') continue;
    const label = normalLabel(node.label);
    if (isReservedHelperLabel(node.label)) {
      issues.error(
        'reserved-helper-label',
        `A named helper cannot be called ${q(node)}: that name belongs to another role. Choose a name like "Frontend helper".`,
        { nodeId: node.id },
      );
    }
    if (labels.has(label)) {
      issues.error(
        'duplicate-helper-label',
        `Two named helpers are called ${q(node)}. Each named helper needs its own name, so plan steps can name it.`,
        { nodeId: node.id },
      );
    }
    labels.add(label);
  }
}

function checkPlanPath({ graph, valid, issues }: Scope): void {
  const ticket = singleOfType(graph, 'ticket');
  const lead = singleOfType(graph, 'lead');
  const gate = singleOfType(graph, 'plan-approval');
  const planners = graph.nodes.filter((n) => n.type === 'planner');
  if (ticket === undefined || lead === undefined || gate === undefined || planners.length > 1) {
    return; // counted above
  }
  const planner = planners[0];
  const path: WorkflowNode[] =
    planner === undefined ? [ticket, lead, gate] : [ticket, planner, gate, lead];
  const shape =
    planner === undefined
      ? 'Ticket → Lead → Plan approval (the Lead writes the plan)'
      : 'Ticket → Planner → Plan approval → Lead';
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i];
    const to = path[i + 1];
    if (from === undefined || to === undefined) continue;
    if (!has(valid, 'flow', from.id, to.id)) {
      issues.error(
        'plan-path',
        `The plan path needs a flow link from ${q(from)} to ${q(to)}. The plan path is ${shape}.`,
        { nodeId: from.id },
      );
    }
  }
}

function checkReviewRoutes({ index, valid, issues }: Scope): void {
  for (const node of index.unique) {
    if (!isEditorNode(node)) continue;
    const routes = valid.filter((e) => e.type === 'review' && e.from === node.id);
    if (routes.length === 0) {
      issues.error(
        'no-review-route',
        `${q(node)} has no review link. Link it to a change reviewer or to the Lead, so its changes are reviewed.`,
        { nodeId: node.id },
      );
    } else if (routes.length > 1) {
      issues.error(
        'many-review-routes',
        `${q(node)} has ${routes.length} review links. Keep exactly one: a change reviewer or the Lead.`,
        { nodeId: node.id, ...(routes[1] !== undefined ? { edgeId: routes[1].id } : {}) },
      );
    }
  }
}

function checkChangeReviewers({ index, valid, issues }: Scope): void {
  for (const node of index.unique) {
    if (!isChangeReviewer(node)) continue;
    const findings = valid.some(
      (e) => e.type === 'findings' && e.from === node.id && index.byId.get(e.to)?.type === 'lead',
    );
    if (!findings) {
      issues.error(
        'reviewer-no-findings',
        `${q(node)} has no findings link to the Lead. The Lead decides every change, so the reviewer must send it its findings.`,
        { nodeId: node.id },
      );
    }
    if (!valid.some((e) => e.type === 'review' && e.to === node.id)) {
      issues.error(
        'reviewer-unused',
        `No helper or tester sends its change to ${q(node)}. Link a review from one, or remove the reviewer.`,
        { nodeId: node.id },
      );
    }
  }
}

/** True when `nodeId`'s review route (any of them) reaches the lead: directly, or via findings. */
function leadSeesReviewOf(scope: Scope, nodeId: WorkflowNodeId): boolean {
  return scope.valid.some((route) => {
    if (route.type !== 'review' || route.from !== nodeId) return false;
    const target = scope.index.byId.get(route.to);
    if (target?.type === 'lead') return true;
    return scope.valid.some(
      (f) =>
        f.type === 'findings' && f.from === route.to && scope.index.byId.get(f.to)?.type === 'lead',
    );
  });
}

function checkRework(scope: Scope): void {
  const { index, valid, issues } = scope;
  for (const edge of edgesOfType(valid, 'rework')) {
    const from = index.byId.get(edge.from);
    const to = index.byId.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from.type === 'checks') continue; // a Checks block's rework: `checkCheckBlocks`
    if (from.type === 'lead') {
      if (!leadSeesReviewOf(scope, to.id)) {
        issues.error(
          'rework-without-review',
          `The Lead can send ${q(to)} back only when it sees that block's review: link ${q(to)}'s review to the Lead, or to a reviewer that sends findings to the Lead.`,
          { edgeId: edge.id },
        );
      }
    } else if (!has(valid, 'review', to.id, from.id)) {
      issues.error(
        'rework-without-review',
        `${q(from)} can send ${q(to)} back only if it reviews ${q(to)}'s changes. Add a review link from ${q(to)} to ${q(from)}, or remove the rework link.`,
        { edgeId: edge.id },
      );
    }
  }
}

function checkAssigned({ index, valid, issues }: Scope): void {
  for (const node of index.unique) {
    if (!isHelperNode(node)) continue;
    const assigned = valid.some(
      (e) => e.type === 'assigns' && e.to === node.id && index.byId.get(e.from)?.type === 'lead',
    );
    if (!assigned) {
      issues.error(
        'not-assigned',
        `The Lead has no assigns link to ${q(node)}, so it could never start it.`,
        { nodeId: node.id },
      );
    }
  }
}

function checkMergePath({ graph, valid, issues }: Scope): void {
  const lead = singleOfType(graph, 'lead');
  const mergeBlocks = graph.nodes.filter((n) => isCheckBlockAt(n, 'merge'));
  const checks = mergeBlocks.length === 1 ? mergeBlocks[0] : undefined;
  const ticketMerge = singleOfType(graph, 'ticket-merge');
  if (lead !== undefined && checks !== undefined && !has(valid, 'merge', lead.id, checks.id)) {
    issues.error(
      'merge-path',
      `${q(lead)} needs a merge link to ${q(checks)}: only the Lead merges changes into the ticket branch, after the checks.`,
      { nodeId: lead.id },
    );
  }
  if (
    checks !== undefined &&
    ticketMerge !== undefined &&
    !has(valid, 'flow', checks.id, ticketMerge.id)
  ) {
    issues.error(
      'merge-path',
      `${q(checks)} needs a flow link to ${q(ticketMerge)}: merged changes reach the ticket branch through the checks.`,
      { nodeId: checks.id },
    );
  }
}

/** The final stages on the chain from the ticket merge to the owner's merge, in order. */
function checkFinalChain({ graph, index, valid, issues }: Scope): void {
  const ticketMerge = singleOfType(graph, 'ticket-merge');
  const ownerMerge = singleOfType(graph, 'owner-merge');
  const done = singleOfType(graph, 'done');
  const onChain = new Set<WorkflowNodeId>();
  if (ticketMerge !== undefined && ownerMerge !== undefined) {
    const seen = new Set<WorkflowNodeId>([ticketMerge.id]);
    let current: WorkflowNode = ticketMerge;
    for (;;) {
      // A tester's flow to its change block is not a step of the chain.
      const outs = valid.filter(
        (e) => e.type === 'flow' && e.from === current.id && !toChangeBlock(index, e),
      );
      if (outs.length !== 1 || outs[0] === undefined) {
        issues.error(
          'final-chain',
          outs.length === 0
            ? `${q(current)} needs a flow link to the next step: the steps after the ticket merge form one line that ends at ${q(ownerMerge)}.`
            : `${q(current)} has ${outs.length} next steps. The steps after the ticket merge form one line, each step leading to exactly one next step, ending at ${q(ownerMerge)}.`,
          { nodeId: current.id },
        );
        break;
      }
      const next = index.byId.get(outs[0].to);
      if (next === undefined) break;
      if (seen.has(next.id)) {
        issues.error(
          'final-chain',
          `The steps after the ticket merge loop back to ${q(next)}; they must form one line ending at ${q(ownerMerge)}.`,
          { nodeId: next.id },
        );
        break;
      }
      if (next.type === 'owner-merge') break;
      seen.add(next.id);
      onChain.add(next.id);
      current = next;
    }
    for (const node of index.unique) {
      if (isFinalStage(node) && !onChain.has(node.id)) {
        issues.error(
          'final-chain',
          `${q(node)} is not on the line of steps from ${q(ticketMerge)} to ${q(ownerMerge)}. Final reviewers and testers run only there.`,
          { nodeId: node.id },
        );
      } else if (isCheckBlockAt(node, 'branch') && !onChain.has(node.id)) {
        issues.error(
          'final-chain',
          `${q(node)} checks the ticket branch, so it belongs on the line of steps from ${q(ticketMerge)} to ${q(ownerMerge)}.`,
          { nodeId: node.id },
        );
      }
    }
  }
  if (
    ownerMerge !== undefined &&
    done !== undefined &&
    !has(valid, 'flow', ownerMerge.id, done.id)
  ) {
    issues.error(
      'final-chain',
      `${q(ownerMerge)} needs a flow link to ${q(done)}: your merge is the last step of every ticket.`,
      { nodeId: ownerMerge.id },
    );
  }
}

function toChangeBlock(index: NodeIndex, edge: WorkflowEdge): boolean {
  const to = index.byId.get(edge.to);
  return to !== undefined && isCheckBlockAt(to, 'change');
}

/**
 * The Checks blocks' own rules (ADR-0027 §5), in graph order of the blocks, then of the editing
 * nodes. Where a block may sit and what may link to it is the edge matrix (`canConnect`); this
 * checks what needs more than the two ends of one edge:
 * - `check-failure-route`: the failure route is one the block's place allows
 *   (`CHECK_FAILURE_ROUTES`);
 * - `check-block-input`: a change block has at least one helper or tester whose change it checks;
 * - `check-rework`: a change block sends work back only to a node whose change it checks, and only
 *   with the route "back to the helper", which needs a rework link to each such node;
 * - `many-check-blocks`: a helper or tester flows into at most one change block.
 */
function checkCheckBlocks({ index, valid, issues }: Scope): void {
  for (const node of index.unique) {
    if (node.type !== 'checks') continue;
    const block = checkBlockOf(node);
    if (!CHECK_FAILURE_ROUTES[block.place].includes(block.onFailure)) {
      const allowedRoutes = CHECK_FAILURE_ROUTES[block.place]
        .map((r) => `"${CHECK_FAILURE_ROUTE_NAMES[r]}"`)
        .join(' or ');
      issues.error(
        'check-failure-route',
        `${q(node)} runs ${CHECK_PLACE_NAMES[block.place]}, where a failure cannot go "${CHECK_FAILURE_ROUTE_NAMES[block.onFailure]}". Choose ${allowedRoutes}.`,
        { nodeId: node.id },
      );
    }
    if (block.place !== 'change') continue;
    const inputs = valid.filter((e) => e.type === 'flow' && e.to === node.id).map((e) => e.from);
    if (inputs.length === 0) {
      issues.error(
        'check-block-input',
        `No helper or tester flows into ${q(node)}. Link the change of the helper or tester it checks to it, or remove the block.`,
        { nodeId: node.id },
      );
    }
    const reworks = edgesOfType(valid, 'rework').filter((e) => e.from === node.id);
    for (const edge of reworks) {
      const to = index.byId.get(edge.to);
      if (to === undefined) continue;
      if (!inputs.includes(to.id)) {
        issues.error(
          'check-rework',
          `${q(node)} can send ${q(to)} back only if it checks ${q(to)}'s change. Add a flow link from ${q(to)} to ${q(node)}, or remove the rework link.`,
          { edgeId: edge.id },
        );
      } else if (block.onFailure !== 'helper') {
        issues.error(
          'check-rework',
          `${q(node)} has a rework link to ${q(to)}, but on a failure "${CHECK_FAILURE_ROUTE_NAMES[block.onFailure]}". Choose "${CHECK_FAILURE_ROUTE_NAMES.helper}", or remove the rework link.`,
          { edgeId: edge.id },
        );
      }
    }
    if (block.onFailure !== 'helper') continue;
    for (const id of inputs) {
      if (reworks.some((e) => e.to === id)) continue;
      const from = index.byId.get(id);
      issues.error(
        'check-rework',
        `${q(node)} sends a failed change back to the helper, but has no rework link to ${q(from ?? { label: id })}. Add one (with its rounds), or choose another failure route.`,
        { nodeId: node.id },
      );
    }
  }
  for (const node of index.unique) {
    if (!isEditorNode(node)) continue;
    const blocks = valid.filter(
      (e) => e.type === 'flow' && e.from === node.id && toChangeBlock(index, e),
    );
    const second = blocks[1];
    if (second === undefined) continue;
    issues.error(
      'many-check-blocks',
      `${q(node)} flows into ${blocks.length} Checks blocks. Keep one: a block can select every check its change needs.`,
      { nodeId: node.id, edgeId: second.id },
    );
  }
}

/**
 * Cycles in the order of steps: `flow` and `merge` links. The change loop (assigns, review,
 * findings, rework) always goes through the Lead and back by design, so it is not a cycle here;
 * its bounds are the rework rounds and the review-route rules.
 */
function checkCycles({ index, valid, issues }: Scope): void {
  const order = new Map(index.unique.map((n, i) => [n.id, i]));
  const next = new Map<WorkflowNodeId, WorkflowNodeId[]>();
  for (const e of valid) {
    if (e.type !== 'flow' && e.type !== 'merge') continue;
    const list = next.get(e.from) ?? [];
    list.push(e.to);
    next.set(e.from, list);
  }
  // Tarjan's strongly connected components, iterating nodes in graph order (deterministic).
  let counter = 0;
  const num = new Map<WorkflowNodeId, number>();
  const low = new Map<WorkflowNodeId, number>();
  const stack: WorkflowNodeId[] = [];
  const onStack = new Set<WorkflowNodeId>();
  const components: WorkflowNodeId[][] = [];
  const visit = (v: WorkflowNodeId): void => {
    num.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!num.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, num.get(w) ?? 0));
      }
    }
    if (low.get(v) === num.get(v)) {
      const component: WorkflowNodeId[] = [];
      for (;;) {
        const w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      if (component.length > 1) components.push(component);
    }
  };
  for (const node of index.unique) if (!num.has(node.id)) visit(node.id);
  const sorted = components
    .map((c) => c.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)))
    .sort((a, b) => (order.get(a[0] ?? '') ?? 0) - (order.get(b[0] ?? '') ?? 0));
  for (const component of sorted) {
    const first = component[0];
    if (first === undefined) continue;
    const labels = component.map((id) => q(index.byId.get(id) ?? { label: id })).join(', ');
    issues.error(
      'cycle',
      `These steps go round in a circle: ${labels}. Only rework links may go back.`,
      { nodeId: first },
    );
  }
}

function checkReachable({ graph, index, valid, issues }: Scope): void {
  const ticket = singleOfType(graph, 'ticket');
  if (ticket === undefined) return;
  const reached = new Set<WorkflowNodeId>([ticket.id]);
  const queue: WorkflowNodeId[] = [ticket.id];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const e of valid) {
      if (e.from === id && !reached.has(e.to)) {
        reached.add(e.to);
        queue.push(e.to);
      }
    }
  }
  for (const node of index.unique) {
    if (!reached.has(node.id)) {
      issues.error(
        'unreachable',
        `${q(node)} is not connected to the rest of the workflow, so a ticket would never reach it.`,
        { nodeId: node.id },
      );
    }
  }
}

function checkFiles(graph: WorkflowGraph, ctx: ValidateGraphContext, issues: Issues): void {
  const skills = ctx.skills;
  const agents = ctx.agents;
  for (const node of graph.nodes) {
    if (!isAgentNode(node)) continue;
    if (skills !== undefined) {
      for (const skill of node.skills) {
        if (!skills.includes(skill)) {
          issues.warning(
            'missing-skill',
            `${q(node)} uses the skill "${skill}", which the project does not have. The agent runs without it.`,
            { nodeId: node.id },
          );
        }
      }
    }
    if (agents !== undefined && node.agent !== null && !agents.includes(node.agent)) {
      issues.warning(
        'missing-agent-file',
        `${q(node)} uses the agent file "${node.agent}", which the project does not have. The agent runs without it.`,
        { nodeId: node.id },
      );
    }
  }
}

function checkModes(graph: WorkflowGraph, ctx: ValidateGraphContext, issues: Issues): void {
  const gate = graph.nodes.find((n) => n.type === 'plan-approval');
  if (gate === undefined || gate.type !== 'plan-approval') return;
  const editors = graph.nodes.filter(isEditorNode);
  // A node without its own mode runs with the project's; unknown when the context has none.
  const configured = editors.map((n) => ({ node: n, mode: n.approvalMode ?? ctx.projectMode }));
  if (!gate.auto) {
    for (const { node, mode } of configured) {
      if (mode !== 'full-auto') continue;
      issues.warning(
        'full-auto-plan-manual',
        `${q(node)} runs in Full auto, but ${q(gate)} still asks you to approve each plan. Turn on automatic plan approval if you want tickets to run without stopping.`,
        { nodeId: node.id },
      );
    }
  } else if (configured.every(({ mode }) => mode !== undefined && mode !== 'full-auto')) {
    issues.warning(
      'plan-auto-without-full-auto',
      `${q(gate)} approves plans automatically, but no helper or tester runs in Full auto, so the plan is still sent to you. Plans are approved automatically only when a ticket runs in Full auto.`,
      { nodeId: gate.id },
    );
  }
}

function checkInstances(graph: WorkflowGraph, ctx: ValidateGraphContext, issues: Issues): void {
  const limit = ctx.maxConcurrentHelpers;
  if (limit === undefined) return;
  for (const node of graph.nodes) {
    if (node.type !== 'helper' || node.maxInstances <= limit) continue;
    issues.warning(
      'instances-over-limit',
      `${q(node)} allows ${node.maxInstances} helpers at once, but the project allows ${limit}. At most ${limit} run at once.`,
      { nodeId: node.id },
    );
  }
}

/**
 * Whether a graph may run, as a list of issues (ADR-0023 §3, README §2 and the WG-0 refinements).
 * Any `error` means the graph cannot be saved or started; warnings never block. The order is
 * fixed: ids, edges (in graph order), counts and labels, plan path, review routes, change
 * reviewers, rework, assignment, merge path, final chain, Checks blocks, cycles, reachability,
 * then the warnings (the Checks blocks' selection last, when `ctx.harness` is given). Within a rule, issues follow graph order.
 *
 * The graph must already have `WorkflowGraphSchema`'s shape; this checks what the shape cannot.
 * Every path rule reads only the edges that pass `canConnect`, so a refused edge is reported once,
 * as itself.
 */
export function validateWorkflowGraph(
  graph: WorkflowGraph,
  ctx: ValidateGraphContext = {},
): GraphIssue[] {
  const issues = new Issues();
  const index = indexNodes(graph.nodes);
  checkIds(graph, issues);
  const valid = checkEdges(graph, index, issues);
  checkCounts(graph, issues);
  const scope: Scope = { graph, index, valid, issues };
  checkPlanPath(scope);
  checkReviewRoutes(scope);
  checkChangeReviewers(scope);
  checkRework(scope);
  checkAssigned(scope);
  checkMergePath(scope);
  checkFinalChain(scope);
  checkCheckBlocks(scope);
  checkCycles(scope);
  checkReachable(scope);
  checkFiles(graph, ctx, issues);
  checkModes(graph, ctx, issues);
  checkInstances(graph, ctx, issues);
  if (ctx.harness !== undefined) issues.list.push(...checkSelectionIssues(graph, ctx.harness));
  return issues.list;
}

/** True when the issues hold no error. */
export function isGraphRunnable(issues: readonly GraphIssue[]): boolean {
  return issues.every((i) => i.severity !== 'error');
}
