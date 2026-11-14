import {
  tightenMode,
  type AnyWorkflowGraph,
  type CompileContext,
  type EffectiveNodeMode,
  type ProgramAgentNode,
  type ProgramArrowNote,
  type ProgramArrowTarget,
  type ProgramBranchCheckBlock,
  type ProgramChangeCheckBlock,
  type ProgramCheckBlock,
  type ProgramFinalReviewerNode,
  type ProgramHandoff,
  type ProgramHelperNode,
  type ProgramResearcherNode,
  type ProgramTesterNode,
  type ReviewRoute,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
  type WorkflowNodeId,
  type WorkflowNodeV3Of,
  type WorkflowProgram,
} from '../../workflow-graph.js';
import { checkBlockOf, copySelection, isCheckBlockAt } from '../check-blocks.js';
import { WorkflowGraphInvalidError } from '../compile.js';
import { arrowNoteReceiver, isArrowNoteType } from './arrow-notes.js';
import { agentsWithRole, edgesOfTypeV3, indexNodesV3, roleClaimOf } from './graph-index.js';
import { toWorkflowGraphV3 } from './migrate.js';
import { isChainStepV3, validateWorkflowGraphV3 } from './validate.js';

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`compileWorkflow: ${what} missing from a validated graph (validator gap)`);
  }
  return value;
}

type AgentLikeNode = WorkflowNodeV3Of<'agent' | 'lead'>;

/** The launch fields every program agent has; `type` and `kind` follow the derived role. */
function launchFields(node: AgentLikeNode, ctx: CompileContext) {
  const provider = node.provider ?? ctx.projectProvider;
  return {
    id: node.id,
    label: node.label,
    model: node.model,
    skills: [...node.skills],
    agent: node.agent,
    ...(node.effort !== undefined ? { effort: node.effort } : {}),
    ...(provider !== undefined ? { provider } : {}),
  };
}

function agentNode(
  node: AgentLikeNode,
  type: ProgramAgentNode['type'],
  kind: ProgramAgentNode['kind'],
  ctx: CompileContext,
): ProgramAgentNode {
  // `type` and `kind` come right after `id`, as in the version 2 compiler, so programs print alike.
  const { id, ...rest } = launchFields(node, ctx);
  return { id, type, kind, ...rest };
}

function arrowNotes(edge: WorkflowEdgeV3): { label?: string; purpose?: string } {
  return {
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    ...(edge.purpose !== undefined ? { purpose: edge.purpose } : {}),
  };
}

/**
 * A valid graph of either version compiled for one run (ADR-0023 §4, ADR-0037). Pure. A version 2
 * graph is migrated first (`toWorkflowGraphV3`), and a migrated version 2 graph compiles to the
 * same program as the version 2 compiler gave (`compileWorkflowV2`, tested over every template and
 * generated graph), so the engine runs unchanged. Throws `WorkflowGraphInvalidError` when
 * `validateWorkflowGraphV3` reports any error.
 *
 * What version 2 had, read on the derived roles:
 * - `planner`: the first planner, or null when the lead plans; `helpers`: named helpers in graph
 *   order, then the pool (`maxInstances`: `ctx.maxConcurrentHelpers`); `changeReviewers`: the
 *   change reviewers some route uses; `finalStages`: the final chain in order; `checkBlocks`,
 *   `nodeModes` and `planAutoApprove` as before;
 * - review routes: the Lead, or the change reviewers (`reviewers`, `reviewer` the first). The
 *   route is `direct` when the reviewers rework the change themselves, with the smallest of their
 *   rounds; `ctx.reviewer` and `ctx.maxReworkRounds` apply as before.
 *
 * New (ADR-0037), for the engine to use from AR-3: `planners` (every planner), `researchers` (each
 * with its research arrows, label and purpose) and `handoffs` (the custom arrows); `arrowNotes`
 * (amended 2026-11-14): the other arrows' labels and purposes, for the agent each reaches.
 */
export function compileWorkflow(graph: AnyWorkflowGraph, ctx: CompileContext): WorkflowProgram {
  return compileWorkflowV3(toWorkflowGraphV3(graph), ctx);
}

export function compileWorkflowV3(graph: WorkflowGraphV3, ctx: CompileContext): WorkflowProgram {
  const errors = validateWorkflowGraphV3(graph, {
    projectMode: ctx.projectMode,
    maxConcurrentHelpers: ctx.maxConcurrentHelpers,
  }).filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new WorkflowGraphInvalidError(errors);

  const index = indexNodesV3(graph);
  const edges = graph.edges;
  const override = ctx.maxReworkRounds;
  const lead = must(
    graph.nodes.find((n): n is WorkflowNodeV3Of<'lead'> => n.type === 'lead'),
    'the lead',
  );

  const reworkRounds = (from: WorkflowNodeId, to: WorkflowNodeId): number | undefined => {
    const edge = edgesOfTypeV3(edges, 'rework').find((e) => e.from === from && e.to === to);
    return edge === undefined ? undefined : (override ?? edge.maxRounds);
  };

  const routeOf = (nodeId: WorkflowNodeId): ReviewRoute => {
    const leadEdgeRounds = reworkRounds(lead.id, nodeId);
    if (ctx.reviewer === 'lead') return { by: 'lead', leadRounds: leadEdgeRounds ?? override ?? 0 };
    const leadRounds = leadEdgeRounds ?? 0;
    const targets = edgesOfTypeV3(edges, 'review')
      .filter((e) => e.from === nodeId)
      .map((e) => must(index.byId.get(e.to), `the reviewer of ${nodeId}`));
    const first = must(targets[0], `the review route of ${nodeId}`);
    if (first.type === 'lead') return { by: 'lead', leadRounds };
    const reviewers = targets.map((t) => t.id);
    const rounds = reviewers.map((id) => reworkRounds(id, nodeId));
    if (rounds.some((r) => r === undefined)) {
      return { by: 'agent', reviewer: first.id, reviewers, then: 'lead', leadRounds };
    }
    return {
      by: 'agent',
      reviewer: first.id,
      reviewers,
      then: 'direct',
      reviewerRounds: Math.min(...rounds.map((r) => r ?? 0)),
      leadRounds,
    };
  };

  const nodeModes: Record<WorkflowNodeId, EffectiveNodeMode> = Object.create(null) as Record<
    WorkflowNodeId,
    EffectiveNodeMode
  >;
  const modeOf = (node: WorkflowNodeV3Of<'agent'>): EffectiveNodeMode => {
    const mode = tightenMode(node.approvalMode ?? null, ctx.projectMode, ...ctx.approvalCeilings);
    nodeModes[node.id] = mode;
    return mode;
  };

  const workers = agentsWithRole(index, 'worker');
  const helpers: ProgramHelperNode[] = [];
  for (const node of workers) {
    if (node.pool === true) continue;
    helpers.push({
      ...agentNode(node, 'helper', 'worker', ctx),
      type: 'helper',
      description: node.description ?? '',
      maxInstances: node.maxInstances ?? 1,
      canStartHelpers: node.canStartHelpers ?? false,
      mode: modeOf(node),
      review: routeOf(node.id),
    });
  }
  const pool = workers.find((n) => n.pool === true);
  if (pool !== undefined) {
    helpers.push({
      ...agentNode(pool, 'helper-pool', 'worker', ctx),
      type: 'helper-pool',
      description: '',
      maxInstances: ctx.maxConcurrentHelpers,
      canStartHelpers: pool.canStartHelpers ?? false,
      mode: modeOf(pool),
      review: routeOf(pool.id),
    });
  }

  const finalStages: (ProgramFinalReviewerNode | ProgramTesterNode)[] = [];
  let branchBlock: ProgramBranchCheckBlock | null = null;
  const chainNext = (from: WorkflowNodeId): WorkflowEdgeV3 | undefined =>
    edges.find((e) => e.from === from && isChainStepV3(index, e));
  const ticketMerge = must(
    graph.nodes.find((n) => n.type === 'ticket-merge'),
    'the ticket merge',
  );
  let step = chainNext(ticketMerge.id);
  for (;;) {
    const node = must(index.byId.get(must(step, 'the final chain').to), 'a final chain step');
    if (node.type === 'owner-merge') break;
    if (node.type === 'checks') {
      branchBlock = { ...programBlock(node), place: 'branch', afterStages: finalStages.length };
    } else if (node.type === 'agent' && roleClaimOf(index, node) === 'tester') {
      finalStages.push({
        ...agentNode(node, 'tester', 'tester', ctx),
        type: 'tester',
        mode: modeOf(node),
        review: routeOf(node.id),
      });
    } else if (node.type === 'agent' && roleClaimOf(index, node) === 'final-reviewer') {
      finalStages.push({ ...agentNode(node, 'reviewer', 'reviewer', ctx), type: 'reviewer' });
    }
    step = chainNext(node.id);
  }

  const routes = [
    ...helpers.map((h) => h.review),
    ...finalStages.map((s) => (s.type === 'tester' ? s.review : null)),
  ];
  const usedReviewers = new Set(routes.flatMap((r) => (r?.by === 'agent' ? r.reviewers : [])));
  const changeReviewers = agentsWithRole(index, 'change-reviewer')
    .filter((n) => usedReviewers.has(n.id))
    .map((n) => agentNode(n, 'reviewer', 'reviewer', ctx));

  const mergeNode = graph.nodes.find((n): n is WorkflowNodeV3Of<'checks'> =>
    isCheckBlockAt(n, 'merge'),
  );
  const change: Record<WorkflowNodeId, ProgramChangeCheckBlock> = Object.create(null) as Record<
    WorkflowNodeId,
    ProgramChangeCheckBlock
  >;
  for (const editor of [...helpers, ...finalStages]) {
    if (editor.type === 'reviewer') continue;
    const into = edges.find((e) => {
      if (e.type !== 'flow' || e.from !== editor.id) return false;
      const to = index.byId.get(e.to);
      return to !== undefined && isCheckBlockAt(to, 'change');
    });
    const block = into === undefined ? undefined : index.byId.get(into.to);
    if (block === undefined || block.type !== 'checks') continue;
    const base = programBlock(block);
    const rework = edgesOfTypeV3(edges, 'rework').find(
      (e) => e.from === block.id && e.to === editor.id,
    );
    change[editor.id] = {
      ...base,
      place: 'change',
      maxRounds: base.onFailure === 'helper' && rework !== undefined ? rework.maxRounds : null,
    };
  }

  const planners = agentsWithRole(index, 'planner').map((n) =>
    agentNode(n, 'planner', 'planner', ctx),
  );
  const researchers: ProgramResearcherNode[] = agentsWithRole(index, 'researcher').map((n) => ({
    ...launchFields(n, ctx),
    type: 'researcher',
    kind: 'researcher',
    targets: edgesOfTypeV3(edges, 'research')
      .filter((e) => e.from === n.id)
      .map((e): ProgramArrowTarget => ({ nodeId: e.to, ...arrowNotes(e) })),
  }));
  const handoffs: ProgramHandoff[] = edgesOfTypeV3(edges, 'custom').map((e) => ({
    from: e.from,
    to: e.to,
    ...arrowNotes(e),
  }));
  // ADR-0037 §2 (amended 2026-11-14): the owner's words on the role arrows reach their agent.
  const roleArrowNotes = edges.flatMap((e): ProgramArrowNote[] => {
    if (!isArrowNoteType(e.type) || (e.label === undefined && e.purpose === undefined)) return [];
    if (arrowNoteReceiver(e, index.byId.get(e.from), index.byId.get(e.to)) === null) return [];
    return [{ type: e.type, from: e.from, to: e.to, ...arrowNotes(e) }];
  });
  const gate = must(
    graph.nodes.find((n): n is WorkflowNodeV3Of<'plan-approval'> => n.type === 'plan-approval'),
    'the plan gate',
  );
  return {
    lead: agentNode(lead, 'lead', 'lead', ctx),
    planner: planners[0] ?? null,
    planners,
    researchers,
    handoffs,
    ...(roleArrowNotes.length > 0 ? { arrowNotes: roleArrowNotes } : {}),
    planAutoApprove: gate.auto && ctx.approvalCeilings.every((c) => c === 'full-auto'),
    helpers,
    changeReviewers,
    finalStages,
    nodeModes,
    checkBlocks: {
      merge: mergeNode === undefined ? null : { ...programBlock(mergeNode), place: 'merge' },
      branch: branchBlock,
      change,
    },
  };
}

function programBlock(node: WorkflowNodeV3Of<'checks'>): ProgramCheckBlock {
  const block = checkBlockOf(node);
  return {
    nodeId: node.id,
    label: node.label,
    select: copySelection(block.select),
    onFailure: block.onFailure,
  };
}
