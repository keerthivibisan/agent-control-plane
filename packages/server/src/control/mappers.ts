import type {
  AgentRunDto,
  ApprovalDto,
  ChatMessageDto,
  RunDetailDto,
  RunSummaryDto,
} from '@acp/core/api';
import type { OrchestratorMessageRow, RunListItem, StoredAgentRun, WorkspaceRow } from '@acp/db';
import type { EngineAgent, EngineApproval, RunState } from '@acp/orchestrator';
import { hasReviewableChange } from './roles.js';

/**
 * Engine state → control-panel DTOs. The engine state is the source of truth for statuses, budgets,
 * reviews and the latest activity (kept in memory); the database adds what only it knows: the
 * linked observed session (joined at read time) and the changed-file count of a worker's review.
 */

export interface DetailExtras {
  stored: readonly StoredAgentRun[];
  workspaces: readonly WorkspaceRow[];
  messages: readonly OrchestratorMessageRow[];
}

export function toRunSummary(item: RunListItem): RunSummaryDto {
  return {
    id: item.id,
    projectId: item.projectId,
    ticketId: item.ticketId,
    title: item.title,
    status: item.status,
    agentCount: item.agentCount,
    pendingApprovals: item.pendingApprovals,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    endedAt: item.endedAt,
  };
}

export function summaryOf(state: RunState): RunSummaryDto {
  return toRunSummary({
    ...state.run,
    agentCount: state.agents.length,
    pendingApprovals: state.approvals.filter((a) => a.status === 'pending').length,
  });
}

export function toAgentDto(
  agent: EngineAgent,
  sessionId: string | null,
  workspace: WorkspaceRow | undefined,
): AgentRunDto {
  return {
    id: agent.id,
    runId: agent.runId,
    parentAgentRunId: agent.parentAgentRunId,
    kind: agent.kind,
    role: agent.role,
    task: agent.task,
    status: agent.status,
    sessionId,
    budget: { used: agent.budgetTokensUsed, limit: agent.budgetLimit },
    latestActivity: agent.latestActivity,
    review:
      hasReviewableChange(agent.kind) && agent.review !== null
        ? { state: agent.review, changedFiles: workspace?.changedFiles ?? null }
        : null,
    branch: workspace?.branch ?? null,
    createdAt: agent.createdAt,
    endedAt: agent.endedAt,
  };
}

export function toApprovalDto(a: EngineApproval): ApprovalDto {
  return {
    id: a.id,
    runId: a.runId,
    agentRunId: a.agentRunId,
    kind: a.kind,
    toolName: a.toolName,
    summary: a.summary,
    status: a.status,
    decidedBy: a.decidedBy ?? null,
    requestedAt: a.requestedAt,
    decidedAt: a.decidedAt,
  };
}

export function toChatMessageDto(m: OrchestratorMessageRow): ChatMessageDto {
  return { id: m.id, runId: m.runId, role: m.role, text: m.text, createdAt: m.createdAt };
}

export function toRunDetail(state: RunState, extras: DetailExtras): RunDetailDto {
  const sessions = new Map(extras.stored.map((a) => [a.id, a.sessionId]));
  const workspaces = new Map(extras.workspaces.map((w) => [w.agentRunId, w]));
  return {
    ...summaryOf(state),
    budget: { ...state.run.budget },
    agents: state.agents.map((a) =>
      toAgentDto(a, sessions.get(a.id) ?? null, workspaces.get(a.id)),
    ),
    approvals: state.approvals.map(toApprovalDto),
    messages: extras.messages.map(toChatMessageDto),
  };
}
