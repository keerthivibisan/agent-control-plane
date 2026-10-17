import {
  NODE_CAPABILITIES,
  tightenMode,
  type AgentWorkflowNode,
  type CompileContext,
  type EffectiveNodeMode,
  type GraphIssue,
  type ProgramAgentNode,
  type ProgramFinalReviewerNode,
  type ProgramHelperNode,
  type ProgramTesterNode,
  type ReviewRoute,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeId,
  type WorkflowNodeOf,
  type WorkflowProgram,
} from '../workflow-graph.js';
import { edgesOfType, indexNodes, isChangeReviewer } from './graph-index.js';
import { validateWorkflowGraph } from './validate.js';

/**
 * Thrown by `compileWorkflow` for a graph the validator refuses. The server maps it to 409/422
 * `workflow_invalid` with `issues`.
 */
export class WorkflowGraphInvalidError extends Error {
  override readonly name = 'WorkflowGraphInvalidError';
  readonly code = 'workflow_invalid';
  /** The validator's errors (warnings are left out: they never block). */
  readonly issues: readonly GraphIssue[];
  constructor(issues: readonly GraphIssue[]) {
    super(
      `The workflow cannot run: ${issues.length} problem${issues.length === 1 ? '' : 's'} (${[...new Set(issues.map((i) => i.code))].join(', ')}).`,
    );
    this.issues = issues;
  }
}

/** The node as `validateWorkflowGraph` guarantees it; a miss means the validator has a gap. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`compileWorkflow: ${what} missing from a validated graph (validator gap)`);
  }
  return value;
}

function agentNode(node: AgentWorkflowNode): ProgramAgentNode {
  return {
    id: node.id,
    type: node.type,
    kind: must(NODE_CAPABILITIES[node.type].kind ?? undefined, `the kind of ${node.type}`),
    label: node.label,
    model: node.model,
    skills: [...node.skills],
    agent: node.agent,
  };
}

/**
 * A valid graph compiled for one run (ADR-0023 §4, README §3 and WG-0 refinements 3 and 5–7).
 * Pure. Throws `WorkflowGraphInvalidError` when `validateWorkflowGraph` reports any error, so it
 * can never accept a graph the validator refuses.
 *
 * - Review routes: the editing node's `review` edge goes to the lead (a), or to a change reviewer
 *   that reworks it directly (c, `then: 'direct'`) or not (b, `then: 'lead'`). `leadRounds` is
 *   the lead → node `rework` edge's rounds, 0 without one; `reviewerRounds` the reviewer's edge.
 * - `ctx.reviewer === 'lead'` sends every change to the lead: `{by: 'lead', leadRounds}` with the
 *   lead's rework edge's rounds (0 without one), or `ctx.maxReworkRounds` when set.
 * - `ctx.maxReworkRounds` replaces the rounds of every rework edge that exists; it adds none.
 * - Modes: `tightenMode(node.approvalMode, ctx.projectMode, ...ctx.approvalCeilings)`.
 * - `planAutoApprove`: the plan gate's `auto`, and every ceiling is Full auto (refinement 6).
 * - Helpers: named helpers in graph order, then the pool, whose `maxInstances` is
 *   `ctx.maxConcurrentHelpers`.
 * - `changeReviewers`: the change reviewers some route uses, in graph order (none when every
 *   change goes to the lead).
 * - `finalStages`: the final chain from the ticket merge to the owner's merge, in order.
 */
export function compileWorkflow(graph: WorkflowGraph, ctx: CompileContext): WorkflowProgram {
  const errors = validateWorkflowGraph(graph, {
    projectMode: ctx.projectMode,
    maxConcurrentHelpers: ctx.maxConcurrentHelpers,
  }).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new WorkflowGraphInvalidError(errors);

  const index = indexNodes(graph.nodes);
  const nodeOf = <T extends WorkflowNode['type']>(type: T): WorkflowNodeOf<T> | undefined =>
    graph.nodes.find((n): n is WorkflowNodeOf<T> => n.type === type);
  const edges = graph.edges;
  const override = ctx.maxReworkRounds;
  const lead = must(nodeOf('lead'), 'the lead');

  const reworkRounds = (from: WorkflowNodeId, to: WorkflowNodeId): number | undefined => {
    const edge = edgesOfType(edges, 'rework').find((e) => e.from === from && e.to === to);
    return edge === undefined ? undefined : (override ?? edge.maxRounds);
  };

  const routeOf = (nodeId: WorkflowNodeId): ReviewRoute => {
    const leadEdgeRounds = reworkRounds(lead.id, nodeId);
    if (ctx.reviewer === 'lead') return { by: 'lead', leadRounds: leadEdgeRounds ?? override ?? 0 };
    const leadRounds = leadEdgeRounds ?? 0;
    const review = must(
      edgesOfType(edges, 'review').find((e) => e.from === nodeId),
      `the review route of ${nodeId}`,
    );
    const target = must(index.byId.get(review.to), `the reviewer of ${nodeId}`);
    if (target.type === 'lead') return { by: 'lead', leadRounds };
    const reviewerRounds = reworkRounds(target.id, nodeId);
    return reviewerRounds === undefined
      ? { by: 'agent', reviewer: target.id, then: 'lead', leadRounds }
      : { by: 'agent', reviewer: target.id, then: 'direct', reviewerRounds, leadRounds };
  };

  const nodeModes: Record<WorkflowNodeId, EffectiveNodeMode> = Object.create(null) as Record<
    WorkflowNodeId,
    EffectiveNodeMode
  >;
  const modeOf = (node: WorkflowNodeOf<'helper' | 'helper-pool' | 'tester'>): EffectiveNodeMode => {
    const mode = tightenMode(node.approvalMode, ctx.projectMode, ...ctx.approvalCeilings);
    nodeModes[node.id] = mode;
    return mode;
  };

  const helpers: ProgramHelperNode[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'helper') continue;
    helpers.push({
      ...agentNode(node),
      type: 'helper',
      description: node.description,
      maxInstances: node.maxInstances,
      canStartHelpers: node.canStartHelpers,
      mode: modeOf(node),
      review: routeOf(node.id),
    });
  }
  const pool = nodeOf('helper-pool');
  if (pool !== undefined) {
    helpers.push({
      ...agentNode(pool),
      type: 'helper-pool',
      description: '',
      maxInstances: ctx.maxConcurrentHelpers,
      canStartHelpers: pool.canStartHelpers,
      mode: modeOf(pool),
      review: routeOf(pool.id),
    });
  }

  const finalStages: (ProgramFinalReviewerNode | ProgramTesterNode)[] = [];
  const flowNext = (from: WorkflowNodeId): WorkflowEdge | undefined =>
    edges.find((e) => e.type === 'flow' && e.from === from);
  let step = flowNext(must(nodeOf('ticket-merge'), 'the ticket merge').id);
  for (;;) {
    const node = must(index.byId.get(must(step, 'the final chain').to), 'a final chain step');
    if (node.type === 'owner-merge') break;
    if (node.type === 'tester') {
      finalStages.push({
        ...agentNode(node),
        type: 'tester',
        mode: modeOf(node),
        review: routeOf(node.id),
      });
    } else if (node.type === 'reviewer') {
      finalStages.push({ ...agentNode(node), type: 'reviewer' });
    }
    step = flowNext(node.id);
  }

  const routes = [...helpers.map((h) => h.review), ...finalStages.map(reviewOfStage)];
  const usedReviewers = new Set(routes.flatMap((r) => (r?.by === 'agent' ? [r.reviewer] : [])));
  const changeReviewers = graph.nodes
    .filter((n): n is WorkflowNodeOf<'reviewer'> => isChangeReviewer(n) && n.type === 'reviewer')
    .filter((n) => usedReviewers.has(n.id))
    .map(agentNode);

  const planner = nodeOf('planner');
  const gate = must(nodeOf('plan-approval'), 'the plan gate');
  return {
    lead: agentNode(lead),
    planner: planner === undefined ? null : agentNode(planner),
    planAutoApprove: gate.auto && ctx.approvalCeilings.every((c) => c === 'full-auto'),
    helpers,
    changeReviewers,
    finalStages,
    nodeModes,
  };
}

function reviewOfStage(stage: ProgramFinalReviewerNode | ProgramTesterNode): ReviewRoute | null {
  return stage.type === 'tester' ? stage.review : null;
}
