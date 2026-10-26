import {
  WORKFLOW_STAGES,
  graphRunDefaults,
  isAgentNode,
  migrateWorkflowV1,
  stagesUsingAgent,
  stagesUsingSkill,
  type ApprovalMode,
  type ProjectWorkflow,
  type RunOptions,
  type SkillName,
  type WorkflowGraph,
  type WorkflowStageId,
} from '@acp/core';
import type { NodeUseDto } from '@acp/core/api';
import type { StoredProjectWorkflow } from '@acp/db';

/**
 * A project's effective workflow graph (ADR-0023 §9, docs/history/workflow-graph/README.md §4): the
 * stored version 2 graph, or the version 1 workflow (stored, or the default) migrated with the
 * project's approval mode. One answer for the Workflow page, the run start and the "used by" chips.
 */
export interface EffectiveWorkflow {
  stored: 'v2' | 'v1' | 'default';
  graph: WorkflowGraph;
  /** The version 1 workflow the graph was migrated from; absent for a stored graph. */
  v1?: ProjectWorkflow;
  /** When the owner last saved it; null when nothing is stored (the default). */
  updatedAt: string | null;
}

export function effectiveWorkflow(
  stored: StoredProjectWorkflow,
  projectMode: ApprovalMode,
): EffectiveWorkflow {
  if (stored.kind === 'v2') {
    return { stored: 'v2', graph: stored.graph.graph, updatedAt: stored.graph.updatedAt };
  }
  return {
    stored: stored.kind,
    graph: migrateWorkflowV1(stored.workflow, { projectMode }),
    v1: stored.workflow,
    updatedAt: stored.kind === 'v1' ? stored.workflow.updatedAt : null,
  };
}

/**
 * The project-level run options `resolveRunOptions` starts from: the project's approval mode, and
 * what its effective graph amounts to (`graphRunDefaults`: a change reviewer or the lead, and the
 * most rounds any route allows). The web's "Project default" reads the same graph from
 * `GET /workflow-graph` and the same core function, so the two cannot disagree (WG-F). For a
 * version 1 or default workflow the graph is its migration, whose answer equals
 * `reviewStageOf(v1)` (tested for every version 1 combination). Graph runs take their routes from
 * the graph, so these only fill the run's review-loop record and its "from the project" source.
 */
export function projectRunDefaults(
  workflow: Pick<EffectiveWorkflow, 'graph'>,
  approvalMode: ApprovalMode,
): RunOptions {
  return { approvalMode, ...graphRunDefaults(workflow.graph) };
}

/** What a skill or agent file is: an agent node's `skills` entry, or its `agent`. */
export type ProjectFileKind = 'skill' | 'agent';

/** The agent nodes of the graph that use the skill or agent file, in graph order. */
export function nodesUsing(
  graph: WorkflowGraph,
  kind: ProjectFileKind,
  name: SkillName,
): NodeUseDto[] {
  const out: NodeUseDto[] = [];
  for (const node of graph.nodes) {
    if (!isAgentNode(node)) continue;
    const uses = kind === 'skill' ? node.skills.includes(name) : node.agent === name;
    if (uses) out.push({ nodeId: node.id, label: node.label });
  }
  return out;
}

/**
 * The version 1 stage ids that use it, kept for clients before graphs (`SkillSummaryDto.usedBy`):
 * a version 1 project answers from its workflow exactly as before; a graph answers the agent nodes
 * whose id is a version 1 stage id (a migrated graph keeps them), in stage order.
 */
export function stagesUsing(
  workflow: Pick<EffectiveWorkflow, 'graph' | 'v1'>,
  kind: ProjectFileKind,
  name: SkillName,
): WorkflowStageId[] {
  if (workflow.v1 !== undefined) {
    return kind === 'skill'
      ? stagesUsingSkill(workflow.v1, name)
      : stagesUsingAgent(workflow.v1, name);
  }
  const ids = new Set(nodesUsing(workflow.graph, kind, name).map((n) => n.nodeId));
  return WORKFLOW_STAGES.filter((stage) => ids.has(stage));
}
