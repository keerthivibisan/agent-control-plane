import {
  migrateWorkflowV1ToV3,
  workflowTemplateV3,
  type ApprovalMode,
  type LegacyWorkflowV1,
  type WorkflowGraphV3,
  type WorkflowTemplateId,
} from '@acp/core';

/**
 * A template's graph for this project (core's `workflowTemplateV3`, ADR-0037). The plan approval step asks
 * unless the project runs in Full auto, the same rule `migrateWorkflowV1` follows, so a Full auto
 * project gets no "Full auto but the plan still asks" warning from a fresh template. The earlier
 * setup (`legacyV1`) is kept, so "Restore my earlier setup" stays possible after a template.
 */
export function templateGraph(
  id: WorkflowTemplateId,
  opts: { planner: boolean; projectMode: ApprovalMode; legacyV1?: LegacyWorkflowV1 | undefined },
): WorkflowGraphV3 {
  const graph = workflowTemplateV3(id, { planner: opts.planner });
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.type === 'plan-approval' ? { ...n, auto: opts.projectMode === 'full-auto' } : n,
    ),
    ...(opts.legacyV1 === undefined ? {} : { legacyV1: opts.legacyV1 }),
  };
}

/** "Restore my earlier setup": the version 1 settings the graph was migrated from, as a graph. */
export function restoredGraph(
  legacyV1: LegacyWorkflowV1,
  projectMode: ApprovalMode,
): WorkflowGraphV3 {
  return migrateWorkflowV1ToV3(legacyV1, { projectMode });
}
