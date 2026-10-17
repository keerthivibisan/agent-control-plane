import type { WorkflowGraph } from '@acp/core';
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
