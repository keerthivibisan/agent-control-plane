import { HARD_MAX_HELPERS } from '../../workspace.js';
import { checkSelectionIssues } from '../../harness-select.js';
import {
  CHECK_FAILURE_ROUTES,
  type GraphIssue,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
  type WorkflowNodeId,
  type WorkflowNodeTypeV3,
  type WorkflowNodeV3,
  type WorkflowNodeV3Of,
} from '../../workflow-graph.js';
import {
  CHECK_FAILURE_ROUTE_NAMES,
  CHECK_PLACE_NAMES,
  checkBlockOf,
  isCheckBlockAt,
} from '../check-blocks.js';
import { q } from '../graph-index.js';
import {
  Issues,
  NO_CHECKS_MESSAGE,
  checkCodexNodes,
  checkFiles,
  checkModelProviders,
  cycleComponents,
  isReservedHelperLabel,
  normalLabel,
  type ValidateGraphContext,
} from '../validate.js';
import { checkConnectionV3 } from './connect.js';
import {
  NODE_TYPE_NAMES_V3,
  agentsWithRole,
  edgesOfTypeV3,
  indexNodesV3,
  isEditorV3,
  isFinalStageV3,
  roleClaimOf,
  singleOfTypeV3,
  type NodeIndexV3,
} from './graph-index.js';
import { ROLE_CLAIM_NAMES, type RoleClaim } from './roles.js';

/**
 * Whether a version 3 graph may run (ADR-0037), as a list of issues. Every version 2 rule keeps its
 * intent, read on the derived roles instead of block types; the order is fixed: ids, arrows (in
 * graph order), roles, counts and labels, plan path, review routes, change reviewers, rework,
 * merge path, final chain, Checks blocks, cycles (steps, then research and custom arrows),
 * reachability, Codex nodes, then the warnings (files, modes, instances, model providers,
 * `no-checks`, and the Checks blocks' selection last when `ctx.harness` is given).
 *
 * New in version 3:
 * - `agent-without-role`, `agent-mixed-roles`: an agent needs exactly one role from its arrows;
 *   `pool-not-helper`: only a helper can be the helper pool;
 * - several planners may send plans to Plan approval (ADR-0037 §4);
 * - a helper or tester may send its change to several change reviewers (fan-out, §5), but not to
 *   the Lead and a reviewer at once, and either every reviewer of the fan-out reworks it directly
 *   or none does;
 * - research and custom arrows must not go round in a circle (`cycle`);
 * - a researcher counts as reached when an agent it researches for is.
 *
 * Every path rule reads only the arrows that pass the matrix, so a refused arrow is reported once.
 */
export function validateWorkflowGraphV3(
  graph: WorkflowGraphV3,
  ctx: ValidateGraphContext = {},
): GraphIssue[] {
  const issues = new Issues();
  const index = indexNodesV3(graph);
  checkIds(graph, issues);
  const valid: WorkflowEdgeV3[] = [];
  graph.edges.forEach((edge, i) => {
    const result = checkConnectionV3(index, graph.edges, i, edge.from, edge.to, edge.type);
    if (result.ok) valid.push(edge);
    else issues.error(result.code, result.message, { edgeId: edge.id });
  });
  const scope: Scope = { graph, index, valid, issues };
  checkRoles(scope);
  checkCounts(scope);
  checkPlanPath(scope);
  checkReviewRoutes(scope);
  checkChangeReviewers(scope);
  checkRework(scope);
  checkMergePath(scope);
  checkFinalChain(scope);
  checkCheckBlocks(scope);
  checkCycles(scope);
  checkReachable(scope);
  const agentNodes = graph.nodes.filter(
    (n): n is WorkflowNodeV3Of<'agent' | 'lead'> => n.type === 'agent' || n.type === 'lead',
  );
  checkCodexNodes(agentNodes, ctx, issues);
  checkFiles(agentNodes, ctx, issues);
  checkModes(scope, ctx);
  checkInstances(scope, ctx);
  checkModelProviders(agentNodes, ctx, issues);
  if (!graph.nodes.some((n) => n.type === 'checks')) issues.warning('no-checks', NO_CHECKS_MESSAGE);
  if (ctx.harness !== undefined) issues.list.push(...checkSelectionIssues(graph, ctx.harness));
  return issues.list;
}

interface Scope {
  readonly graph: WorkflowGraphV3;
  readonly index: NodeIndexV3;
  readonly valid: readonly WorkflowEdgeV3[];
  readonly issues: Issues;
}

function has(
  valid: readonly WorkflowEdgeV3[],
  type: WorkflowEdgeV3['type'],
  from: WorkflowNodeId,
  to: WorkflowNodeId,
): boolean {
  return valid.some((e) => e.type === type && e.from === from && e.to === to);
}

function checkIds(graph: WorkflowGraphV3, issues: Issues): void {
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

function claimList(claims: readonly RoleClaim[]): string {
  return claims.map((c) => ROLE_CLAIM_NAMES[c]).join(' and ');
}

/** ADR-0037 §1: one role per agent; the pool flag only on a helper. */
function checkRoles({ index, issues }: Scope): void {
  for (const node of index.unique) {
    if (node.type !== 'agent') continue;
    const result = index.roles.get(node.id);
    if (result?.ok === false && result.code === 'agent-without-role') {
      issues.error(
        'agent-without-role',
        `${q(node)} has no role: no link makes it a researcher, planner, helper, reviewer or tester. Link it (for example, the Lead gives it work to make it a helper), or remove it.`,
        { nodeId: node.id },
      );
    } else if (result?.ok === false) {
      issues.error(
        'agent-mixed-roles',
        `${q(node)} would be a ${claimList(result.claims)} at once. An agent has one role: keep the links of one role, and add another agent block for the other.`,
        { nodeId: node.id },
      );
    }
    if (node.pool === true && result?.ok === true && result.role.role !== 'worker') {
      issues.error(
        'pool-not-helper',
        `${q(node)} is marked as the helper pool, but its links make it a ${claimList(result.claims)}. Only a helper can be the pool.`,
        { nodeId: node.id },
      );
    }
  }
}

const SINGLE_GATES: readonly WorkflowNodeTypeV3[] = [
  'ticket',
  'plan-approval',
  'lead',
  'ticket-merge',
  'owner-merge',
  'done',
];

/** The version 2 limits per block type, now per derived role (ADR-0023 §2, ADR-0028 §2). */
function checkCounts({ graph, index, issues }: Scope): void {
  for (const type of SINGLE_GATES) {
    const all = graph.nodes.filter((n) => n.type === type);
    if (all.length === 0) {
      issues.error('missing-node', `The workflow needs a ${NODE_TYPE_NAMES_V3[type]} block.`);
    }
    const extra = all[1];
    if (extra !== undefined) {
      issues.error(
        'too-many-nodes',
        `The workflow can have only one ${NODE_TYPE_NAMES_V3[type]} block; ${q(extra)} is one too many.`,
        { nodeId: extra.id },
      );
    }
  }
  const blocks = graph.nodes.filter((n): n is WorkflowNodeV3Of<'checks'> => n.type === 'checks');
  const merge = blocks.filter((n) => isCheckBlockAt(n, 'merge'));
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

  const workers = agentsWithRole(index, 'worker');
  const pools = workers.filter((n) => n.pool === true);
  const named = workers.filter((n) => n.pool !== true);
  const extraPool = pools[1];
  if (extraPool !== undefined) {
    issues.error(
      'too-many-nodes',
      `The workflow can have only one helper pool; ${q(extraPool)} is one too many.`,
      { nodeId: extraPool.id },
    );
  }
  const extraNamed = named[HARD_MAX_HELPERS];
  if (extraNamed !== undefined) {
    issues.error(
      'too-many-helpers',
      `The workflow has ${named.length} named helpers; at most ${HARD_MAX_HELPERS} are allowed.`,
      { nodeId: extraNamed.id },
    );
  }
  const extraReviewer = index.unique.filter((n) => {
    const claim = roleClaimOf(index, n);
    return claim === 'change-reviewer' || claim === 'final-reviewer';
  })[8];
  if (extraReviewer !== undefined) {
    issues.error(
      'too-many-nodes',
      `The workflow can have at most 8 reviewers; ${q(extraReviewer)} is one too many.`,
      { nodeId: extraReviewer.id },
    );
  }
  const extraTester = agentsWithRole(index, 'tester')[2];
  if (extraTester !== undefined) {
    issues.error(
      'too-many-nodes',
      `The workflow can have at most 2 testers; ${q(extraTester)} is one too many.`,
      { nodeId: extraTester.id },
    );
  }
  if (workers.length === 0) {
    issues.error(
      'no-helpers',
      'The workflow needs at least one helper (an agent the Lead gives work to) to do the work.',
    );
  }
  const labels = new Set<string>();
  for (const node of named) {
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

/**
 * The plan path: `Ticket → Lead → Plan approval` without a planner; with planners, a flow from the
 * ticket to each planner, each planner's plan arrow to Plan approval, and `Plan approval → Lead`.
 */
function checkPlanPath({ graph, index, valid, issues }: Scope): void {
  const ticket = singleOfTypeV3(graph, 'ticket');
  const lead = singleOfTypeV3(graph, 'lead');
  const gate = singleOfTypeV3(graph, 'plan-approval');
  if (ticket === undefined || lead === undefined || gate === undefined) return; // counted above
  const planners = agentsWithRole(index, 'planner');
  const missing = (from: WorkflowNodeV3, to: WorkflowNodeV3, shape: string, type = 'flow') =>
    issues.error(
      'plan-path',
      `The plan path needs a ${type} link from ${q(from)} to ${q(to)}. The plan path is ${shape}.`,
      { nodeId: from.id },
    );
  if (!index.hasPlanner) {
    const shape = 'Ticket → Lead → Plan approval (the Lead writes the plan)';
    if (!has(valid, 'flow', ticket.id, lead.id)) missing(ticket, lead, shape);
    if (!has(valid, 'flow', lead.id, gate.id)) missing(lead, gate, shape);
    return;
  }
  const shape = 'Ticket → each planner → Plan approval → Lead';
  for (const planner of planners) {
    if (!has(valid, 'flow', ticket.id, planner.id)) missing(ticket, planner, shape);
    if (!has(valid, 'plan', planner.id, gate.id)) missing(planner, gate, shape, 'plan');
  }
  if (!has(valid, 'flow', gate.id, lead.id)) missing(gate, lead, shape);
}

function reviewTargets(scope: Scope, nodeId: WorkflowNodeId): WorkflowNodeV3[] {
  return scope.valid
    .filter((e) => e.type === 'review' && e.from === nodeId)
    .flatMap((e) => {
      const to = scope.index.byId.get(e.to);
      return to === undefined ? [] : [to];
    });
}

/**
 * Each helper and tester has a review route: the Lead, or one or more change reviewers (a fan-out,
 * ADR-0037 §5). Not the Lead and a reviewer at once; with a fan-out, either every reviewer reworks
 * the change itself or none does, so the route is one of version 2's.
 */
function checkReviewRoutes(scope: Scope): void {
  const { index, valid, issues } = scope;
  for (const node of index.unique) {
    if (roleClaimOf(index, node) !== 'worker' && roleClaimOf(index, node) !== 'tester') continue;
    const routes = valid.filter((e) => e.type === 'review' && e.from === node.id);
    const targets = reviewTargets(scope, node.id);
    if (routes.length === 0) {
      issues.error(
        'no-review-route',
        `${q(node)} has no review link. Link it to a change reviewer or to the Lead, so its changes are reviewed.`,
        { nodeId: node.id },
      );
      continue;
    }
    const toLead = routes.find((e) => index.byId.get(e.to)?.type === 'lead');
    if (toLead !== undefined && routes.length > 1) {
      const second = routes.find((e) => e !== toLead) ?? routes[1];
      issues.error(
        'many-review-routes',
        `${q(node)} has ${routes.length} review links, one of them to the Lead. Send its change either to the Lead or to change reviewers, not both.`,
        { nodeId: node.id, ...(second !== undefined ? { edgeId: second.id } : {}) },
      );
      continue;
    }
    const direct = targets.filter((t) => has(valid, 'rework', t.id, node.id));
    if (direct.length > 0 && direct.length < targets.length) {
      issues.error(
        'many-review-routes',
        `${q(node)} goes to ${targets.length} change reviewers, but only some of them send it back for rework. Either every reviewer of a change sends it back itself, or none does (the Lead then decides).`,
        { nodeId: node.id },
      );
    }
  }
}

function checkChangeReviewers({ index, valid, issues }: Scope): void {
  for (const node of index.unique) {
    if (roleClaimOf(index, node) !== 'change-reviewer') continue;
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

function leadSeesReviewOf(scope: Scope, nodeId: WorkflowNodeId): boolean {
  return scope.valid.some((route) => {
    if (route.type !== 'review' || route.from !== nodeId) return false;
    if (scope.index.byId.get(route.to)?.type === 'lead') return true;
    return scope.valid.some(
      (f) =>
        f.type === 'findings' && f.from === route.to && scope.index.byId.get(f.to)?.type === 'lead',
    );
  });
}

function checkRework(scope: Scope): void {
  const { index, valid, issues } = scope;
  for (const edge of edgesOfTypeV3(valid, 'rework')) {
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

function checkMergePath({ graph, valid, issues }: Scope): void {
  const lead = singleOfTypeV3(graph, 'lead');
  const mergeBlocks = graph.nodes.filter((n) => isCheckBlockAt(n, 'merge'));
  const ticketMerge = singleOfTypeV3(graph, 'ticket-merge');
  if (mergeBlocks.length === 0) {
    if (
      lead !== undefined &&
      ticketMerge !== undefined &&
      !has(valid, 'merge', lead.id, ticketMerge.id)
    ) {
      issues.error(
        'merge-path',
        `${q(lead)} needs a merge link to ${q(ticketMerge)}: only the Lead merges changes into the ticket branch, after their review.`,
        { nodeId: lead.id },
      );
    }
    return;
  }
  const checks = mergeBlocks.length === 1 ? mergeBlocks[0] : undefined;
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

/** A step of the final chain: a `flow` or `test` arrow that does not go into a change block. */
export function isChainStepV3(index: NodeIndexV3, edge: WorkflowEdgeV3): boolean {
  if (edge.type !== 'flow' && edge.type !== 'test') return false;
  const to = index.byId.get(edge.to);
  return to === undefined || !isCheckBlockAt(to, 'change');
}

function checkFinalChain({ graph, index, valid, issues }: Scope): void {
  const ticketMerge = singleOfTypeV3(graph, 'ticket-merge');
  const ownerMerge = singleOfTypeV3(graph, 'owner-merge');
  const done = singleOfTypeV3(graph, 'done');
  const onChain = new Set<WorkflowNodeId>();
  if (ticketMerge !== undefined && ownerMerge !== undefined) {
    const seen = new Set<WorkflowNodeId>([ticketMerge.id]);
    let current: WorkflowNodeV3 = ticketMerge;
    for (;;) {
      const outs = valid.filter((e) => e.from === current.id && isChainStepV3(index, e));
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
      if (isFinalStageV3(index, node) && !onChain.has(node.id)) {
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

function toChangeBlock(index: NodeIndexV3, edge: WorkflowEdgeV3): boolean {
  const to = index.byId.get(edge.to);
  return edge.type === 'flow' && to !== undefined && isCheckBlockAt(to, 'change');
}

/** The Checks blocks' own rules (ADR-0027 §5), as in version 2. */
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
    const reworks = edgesOfTypeV3(valid, 'rework').filter((e) => e.from === node.id);
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
    if (!isEditorV3(index, node)) continue;
    const blocks = valid.filter((e) => e.from === node.id && toChangeBlock(index, e));
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
 * Cycles: in the order of steps (`flow`, `merge` and `test`, as version 2's flow into a tester),
 * and, separately, in the order research and custom arrows set (ADR-0037 §2: a researcher or a
 * hand-off source runs before its target, so a circle would never start). The change loop goes
 * through the Lead and back by design and is bounded by the rework rounds instead.
 */
function checkCycles({ index, valid, issues }: Scope): void {
  const ids = index.unique.map((n) => n.id);
  const label = (id: WorkflowNodeId) => q(index.byId.get(id) ?? { label: id });
  const steps = valid.filter((e) => e.type === 'flow' || e.type === 'merge' || e.type === 'test');
  for (const component of cycleComponents(ids, steps)) {
    const first = component[0];
    if (first === undefined) continue;
    issues.error(
      'cycle',
      `These steps go round in a circle: ${component.map(label).join(', ')}. Only rework links may go back.`,
      { nodeId: first },
    );
  }
  const order = valid.filter((e) => e.type === 'research' || e.type === 'custom');
  for (const component of cycleComponents(ids, order)) {
    const first = component[0];
    if (first === undefined) continue;
    issues.error(
      'cycle',
      `These agents wait for each other in a circle: ${component.map(label).join(', ')}. Research and custom links must not go round, or none of them would start.`,
      { nodeId: first },
    );
  }
}

/**
 * Every node is reached from the ticket along the arrows that pass the matrix; a researcher is
 * reached when an agent it researches for is (its research runs for that agent).
 */
function checkReachable({ graph, index, valid, issues }: Scope): void {
  const ticket = singleOfTypeV3(graph, 'ticket');
  if (ticket === undefined) return;
  const reached = new Set<WorkflowNodeId>([ticket.id]);
  const queue: WorkflowNodeId[] = [ticket.id];
  const visit = (id: WorkflowNodeId) => {
    if (reached.has(id)) return;
    reached.add(id);
    queue.push(id);
  };
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const e of valid) {
      if (e.from === id) visit(e.to);
      if (e.type === 'research' && e.to === id) visit(e.from);
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

/** The editing agents (helpers and testers by their derived role), in graph order. */
function editingAgents(index: NodeIndexV3): WorkflowNodeV3Of<'agent'>[] {
  return index.unique.filter(
    (n): n is WorkflowNodeV3Of<'agent'> =>
      n.type === 'agent' &&
      (roleClaimOf(index, n) === 'worker' || roleClaimOf(index, n) === 'tester'),
  );
}

function checkModes({ graph, index, issues }: Scope, ctx: ValidateGraphContext): void {
  const gate = graph.nodes.find((n) => n.type === 'plan-approval');
  if (gate === undefined || gate.type !== 'plan-approval') return;
  const configured = editingAgents(index).map((n) => ({
    node: n,
    mode: n.approvalMode ?? ctx.projectMode,
  }));
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

function checkInstances({ index, issues }: Scope, ctx: ValidateGraphContext): void {
  const limit = ctx.maxConcurrentHelpers;
  if (limit === undefined) return;
  for (const node of agentsWithRole(index, 'worker')) {
    const max = node.maxInstances ?? 1;
    if (node.pool === true || max <= limit) continue;
    issues.warning(
      'instances-over-limit',
      `${q(node)} allows ${max} helpers at once, but the project allows ${limit}. At most ${limit} run at once.`,
      { nodeId: node.id },
    );
  }
}
