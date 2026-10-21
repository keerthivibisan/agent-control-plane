import type { WorkflowGraph } from '@acp/core';
import type { WorkflowGraphDto } from '@acp/core/api';
import {
  ApiError,
  updateWorkflowGraph,
  validateWorkflowGraphOnServer,
  type ApiClient,
} from '../../../lib/api';
import type { EditorIssue } from './IssuesList';

export type SaveResult =
  | { ok: true; dto: WorkflowGraphDto }
  | {
      ok: false;
      error: ApiError;
      /** The server's issues when it refused the graph itself (422 `workflow_invalid`). */
      issues: EditorIssue[] | null;
    };

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

/** True for the server's "this graph can't run" answer. */
export function isWorkflowInvalid(e: ApiError): boolean {
  return e.kind === 'http' && (e.status === 422 || e.code === 'workflow_invalid');
}

/**
 * Saves the graph (PUT …/workflow-graph). When the server refuses it as invalid (422), its own
 * issues are fetched from POST …/workflow-graph/validate, a contract DTO, so the owner sees exactly
 * what the server objects to; the error body's shape isn't part of the contract. If that call
 * fails too, the refusal is still reported, without the list.
 */
export async function saveWorkflowGraph(
  client: ApiClient,
  projectId: string,
  graph: WorkflowGraph,
): Promise<SaveResult> {
  try {
    return { ok: true, dto: await updateWorkflowGraph(client, projectId, { graph }) };
  } catch (e) {
    const error = toApiError(e);
    if (!isWorkflowInvalid(error)) return { ok: false, error, issues: null };
    try {
      const result = await validateWorkflowGraphOnServer(client, projectId, { graph });
      return { ok: false, error, issues: result.issues };
    } catch {
      return { ok: false, error, issues: null };
    }
  }
}
