import { WORKFLOW_STAGES, type WorkflowGraph, type WorkflowStageId } from '@acp/core';
import type { NodeUseDto } from '@acp/core/api';

/**
 * The workflow blocks that use a project agent file (ADR-0023), from the project's graph. The
 * server sends `usedByNodes` for skills; agent files are read from the graph here, so "Used by"
 * names the same blocks for both.
 */
export function nodesUsingAgent(graph: Pick<WorkflowGraph, 'nodes'>, name: string): NodeUseDto[] {
  return graph.nodes.flatMap((n) =>
    'agent' in n && n.agent === name ? [{ nodeId: n.id, label: n.label }] : [],
  );
}

/**
 * The version 1 stage ids among those blocks (a migrated graph keeps them), in stage order: what
 * the server's `stagesUsing` answers for a graph, for the chips that still name stages.
 */
export function stagesOfNodes(nodes: readonly NodeUseDto[]): WorkflowStageId[] {
  const ids = new Set(nodes.map((n) => n.nodeId));
  return WORKFLOW_STAGES.filter((stage) => ids.has(stage));
}
