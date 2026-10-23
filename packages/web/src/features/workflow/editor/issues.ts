import {
  MAX_NODE_DESCRIPTION,
  WorkflowGraphSchema,
  validateWorkflowGraph,
  type HarnessCheck,
  type ValidateGraphContext,
  type WorkflowGraph,
} from '@acp/core';
import { HARNESS_BLOCKS_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { checkSelectionWarnings } from '../check-blocks';
import type { EditorIssue } from './IssuesList';

const P = WORKFLOW_GRAPH_COPY.panel;

/**
 * The fields the graph's shape (`WorkflowGraphSchema`) refuses while the owner types: an empty or
 * too long name, a too long model or description. The validator assumes a well-shaped graph, so
 * these come first, in words, on the block they belong to.
 */
export function shapeIssues(graph: WorkflowGraph): EditorIssue[] {
  const parsed = WorkflowGraphSchema.safeParse(graph);
  if (parsed.success) return [];
  const seen = new Set<string>();
  const out: EditorIssue[] = [];
  for (const issue of parsed.error.issues) {
    const [list, index, field] = issue.path;
    const node = list === 'nodes' && typeof index === 'number' ? graph.nodes[index] : undefined;
    const label = node?.label.trim() || node?.id || '';
    const message =
      field === 'label'
        ? P.nameProblem(label)
        : field === 'model'
          ? `${label}: ${P.modelTooLong}`
          : field === 'description'
            ? `${label}: ${P.descriptionTooLong(MAX_NODE_DESCRIPTION)}`
            : field === 'select'
              ? HARNESS_BLOCKS_COPY.panel.empty(label)
              : P.shapeProblem(label);
    const key = `${node?.id ?? ''}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      code: 'shape',
      severity: 'error',
      message,
      ...(node !== undefined ? { nodeId: node.id } : {}),
    });
  }
  return out;
}

/**
 * Everything the problems list shows, in order: shape problems, the validator's issues, then the
 * Checks blocks' picks the harness file does not have (`harnessChecks`: undefined while unknown).
 */
export function editorIssues(
  graph: WorkflowGraph,
  ctx: ValidateGraphContext,
  harnessChecks?: readonly HarnessCheck[],
): EditorIssue[] {
  return [
    ...shapeIssues(graph),
    ...validateWorkflowGraph(graph, ctx),
    ...checkSelectionWarnings(graph, harnessChecks),
  ];
}

export function hasErrors(issues: readonly EditorIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
