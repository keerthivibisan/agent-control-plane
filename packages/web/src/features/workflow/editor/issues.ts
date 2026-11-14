import {
  MAX_EDGE_LABEL,
  MAX_EDGE_PURPOSE,
  MAX_NODE_DESCRIPTION,
  WorkflowGraphV3Schema,
  validateWorkflowGraphV3,
  type ValidateGraphContext,
  type WorkflowGraphV3,
} from '@acp/core';
import { HARNESS_BLOCKS_COPY, WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { EDITOR_COPY } from './copy';
import type { EditorIssue } from './IssuesList';

const P = WORKFLOW_GRAPH_COPY.panel;
const W = EDITOR_COPY.edgePanel;

/**
 * The fields the graph's shape (`WorkflowGraphV3Schema`) refuses while the owner types: an empty or
 * too long name, a too long model or description, an arrow's too long label or purpose. The
 * validator assumes a well-shaped graph, so these come first, in words, on the block or arrow they
 * belong to.
 */
export function shapeIssues(graph: WorkflowGraphV3): EditorIssue[] {
  const parsed = WorkflowGraphV3Schema.safeParse(graph);
  if (parsed.success) return [];
  const seen = new Set<string>();
  const out: EditorIssue[] = [];
  for (const issue of parsed.error.issues) {
    const [list, index, field] = issue.path;
    if (list === 'edges' && typeof index === 'number') {
      const edge = graph.edges[index];
      if (edge === undefined) continue;
      const max = field === 'purpose' ? MAX_EDGE_PURPOSE : MAX_EDGE_LABEL;
      const message = `${field === 'purpose' ? W.purpose : W.label}: ${W.tooLong(max)}`;
      const key = `edge:${edge.id}|${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ code: 'shape', severity: 'error', message, edgeId: edge.id });
      continue;
    }
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
 * Everything the problems list shows, in order: shape problems, then the validator's issues (with
 * `ctx.harness`, its warnings about the Checks blocks' picks, ADR-0027).
 */
export function editorIssues(graph: WorkflowGraphV3, ctx: ValidateGraphContext): EditorIssue[] {
  return [...shapeIssues(graph), ...validateWorkflowGraphV3(graph, ctx)];
}

export function hasErrors(issues: readonly EditorIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
