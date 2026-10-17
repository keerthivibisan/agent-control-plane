import type { ApprovalMode } from '../workspace.js';
import { reviewStageOf, type SkillName } from '../workflow.js';
import type {
  LegacyWorkflowV1,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '../workflow-graph.js';
import {
  DEFAULT_LABELS,
  GATE_IDS,
  STAGE_NODE_IDS,
  edge,
  finalChainEdges,
  gateNodes,
  planPathEdges,
  rework,
} from './build.js';

function distinctSkills(...skills: (SkillName | null | undefined)[]): SkillName[] {
  const out: SkillName[] = [];
  for (const s of skills) if (s !== null && s !== undefined && !out.includes(s)) out.push(s);
  return out;
}

/** A plain-JSON copy, so the graph never shares objects with its input. */
function copyV1(v1: LegacyWorkflowV1): LegacyWorkflowV1 {
  return JSON.parse(
    JSON.stringify({ plannerMode: v1.plannerMode, stages: v1.stages }),
  ) as LegacyWorkflowV1;
}

/**
 * A version 1 workflow as a version 2 graph (ADR-0023 §9). Pure and lossless: the graph runs the
 * same agents with the same launch fields as today, and `legacyV1` keeps the original settings.
 *
 * - Node ids are the version 1 stage ids: the planner `plan` (in `separate` mode only), the lead
 *   `orchestrate`, the pool `helpers`, the change reviewer `review` (when `reviewStageOf()` says
 *   the reviewer is an agent), the final reviewer `code-review` and the tester `unit-tests` (when
 *   switched on). The gates use their default ids.
 * - In `lead` mode the lead also plans, so it gets what today's lead gets (`stages.ts`): the
 *   orchestrate stage's model and agent file, else the plan stage's, and both stages' skills in
 *   stage order, distinct.
 * - Review: an agent reviewer gives route (b) (review → `review`, findings → lead, lead rework
 *   with the rounds), the lead as reviewer gives route (a) (review → lead, lead rework with the
 *   rounds). The tester's change is reviewed the same way as the helpers'.
 * - The pool keeps the project's mode (`approvalMode: null`) and may start helpers (depth stays the
 *   project's setting). The plan gate is automatic only in a Full auto project.
 */
export function migrateWorkflowV1(
  v1: LegacyWorkflowV1,
  opts: { projectMode: ApprovalMode },
): WorkflowGraph {
  const s = v1.stages;
  const separate = v1.plannerMode === 'separate';
  const review = reviewStageOf(v1);
  const reviewerIsAgent = review.reviewer === 'agent';
  const finalReview = s['code-review'].enabled;
  const tests = s['unit-tests'].enabled;
  const gates = gateNodes(opts.projectMode === 'full-auto');
  const ids = STAGE_NODE_IDS;

  const nodes: WorkflowNode[] = [gates.ticket];
  if (separate) {
    nodes.push({
      type: 'planner',
      id: ids.planner,
      label: DEFAULT_LABELS.planner,
      model: s.plan.model,
      skills: distinctSkills(s.plan.skill),
      agent: s.plan.agent ?? null,
    });
  }
  nodes.push(gates.planApproval, {
    type: 'lead',
    id: ids.lead,
    label: DEFAULT_LABELS.lead,
    ...(separate
      ? {
          model: s.orchestrate.model,
          skills: distinctSkills(s.orchestrate.skill),
          agent: s.orchestrate.agent ?? null,
        }
      : {
          model: s.orchestrate.model ?? s.plan.model,
          skills: distinctSkills(s.plan.skill, s.orchestrate.skill),
          agent: s.orchestrate.agent ?? s.plan.agent ?? null,
        }),
  });
  nodes.push({
    type: 'helper-pool',
    id: ids.pool,
    label: DEFAULT_LABELS.pool,
    model: s.helpers.model,
    skills: distinctSkills(s.helpers.skill),
    agent: s.helpers.agent ?? null,
    approvalMode: null,
    canStartHelpers: true,
  });
  if (reviewerIsAgent) {
    nodes.push({
      type: 'reviewer',
      id: ids.changeReviewer,
      label: DEFAULT_LABELS.changeReviewer,
      scope: 'change',
      model: review.model,
      skills: distinctSkills(review.skill),
      agent: review.agent,
    });
  }
  nodes.push(gates.checks, gates.ticketMerge);
  const stages: string[] = [];
  if (finalReview) {
    const cr = s['code-review'];
    nodes.push({
      type: 'reviewer',
      id: ids.finalReviewer,
      label: DEFAULT_LABELS.finalReviewer,
      scope: 'final',
      model: cr.model,
      skills: distinctSkills(cr.skill),
      agent: cr.agent ?? null,
    });
    stages.push(ids.finalReviewer);
  }
  if (tests) {
    const ut = s['unit-tests'];
    nodes.push({
      type: 'tester',
      id: ids.tester,
      label: DEFAULT_LABELS.tester,
      model: ut.model,
      skills: distinctSkills(ut.skill),
      agent: ut.agent ?? null,
      approvalMode: null,
    });
    stages.push(ids.tester);
  }
  nodes.push(gates.ownerMerge, gates.done);

  const reviewTarget = reviewerIsAgent ? ids.changeReviewer : ids.lead;
  const reviewed = tests ? [ids.pool, ids.tester] : [ids.pool];
  const edges: WorkflowEdge[] = [
    ...planPathEdges(
      GATE_IDS.ticket,
      separate ? ids.planner : null,
      GATE_IDS.planApproval,
      ids.lead,
    ),
    edge('assigns', ids.lead, ids.pool),
    ...reviewed.map((id) => edge('review', id, reviewTarget)),
    ...(reviewerIsAgent ? [edge('findings', ids.changeReviewer, ids.lead)] : []),
    ...reviewed.map((id) => rework(ids.lead, id, review.maxReworkRounds)),
    edge('merge', ids.lead, GATE_IDS.checks),
    edge('flow', GATE_IDS.checks, GATE_IDS.ticketMerge),
    ...finalChainEdges(GATE_IDS.ticketMerge, stages, GATE_IDS.ownerMerge, GATE_IDS.done),
  ];

  return { version: 2, template: 'custom', nodes, edges, legacyV1: copyV1(v1) };
}
