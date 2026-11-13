import { WorkflowGraphV3Schema, downgradeWorkflowV3, type WorkflowGraph } from '@acp/core';

/**
 * ADR-0037 (AR-4): the editor saves version 3. Tests written against version 2 read the graph a
 * PUT sent in its version 2 form (core's exact inverse of the migration); a graph version 2 cannot
 * say fails the test.
 */
export function sentAsV2(graph: unknown): WorkflowGraph {
  const down = downgradeWorkflowV3(WorkflowGraphV3Schema.parse(graph));
  if (!down.ok) throw new Error(`not a version 2 graph: ${down.reason}`);
  return down.graph;
}
