import type {
  AgentRunDto,
  ApprovalDto,
  ChatMessageDto,
  RunDetailDto,
  RunFollowUpDto,
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
  /** `followUpView`: absent while the lead is live. */
  followUp?: RunFollowUpDto;
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

export function toChatMessageDto(m: OrchestratorMessageRow, followUp = false): ChatMessageDto {
  const dto: ChatMessageDto = {
    id: m.id,
    runId: m.runId,
    role: m.role,
    text: m.text,
    createdAt: m.createdAt,
  };
  if (followUp) dto.followUp = true;
  return dto;
}

/**
 * Which stored messages belong to follow-up turns (ADR-0020), derived without a new column: the
 * lead ended at `leadEndedAt`, and while it is ended a message is stored only by a follow-up turn,
 * which always starts with the owner's message. So a message is a follow-up one when it was
 * stored after the lead ended, at or after the first owner message stored after that; a late
 * reply of the ending lead itself, before any such owner message, is not. `messages` is oldest
 * first (one page; a follow-up reply whose owner message is on an older page is not marked).
 */
export function followUpMessageIds(
  messages: readonly OrchestratorMessageRow[],
  leadEndedAt: string | null,
): Set<string> {
  const ids = new Set<string>();
  if (leadEndedAt === null) return ids;
  const end = Date.parse(leadEndedAt);
  let open = false;
  for (const m of messages) {
    if (!(Date.parse(m.createdAt) > end)) continue;
    if (m.role === 'owner') open = true;
    if (open) ids.add(m.id);
  }
  return ids;
}

export function toRunDetail(state: RunState, extras: DetailExtras): RunDetailDto {
  const sessions = new Map(extras.stored.map((a) => [a.id, a.sessionId]));
  const workspaces = new Map(extras.workspaces.map((w) => [w.agentRunId, w]));
  const lead = state.agents.find((a) => a.kind === 'lead');
  const followUps = followUpMessageIds(extras.messages, lead?.endedAt ?? null);
  const detail: RunDetailDto = {
    ...summaryOf(state),
    budget: { ...state.run.budget },
    agents: state.agents.map((a) =>
      toAgentDto(a, sessions.get(a.id) ?? null, workspaces.get(a.id)),
    ),
    approvals: state.approvals.map(toApprovalDto),
    messages: extras.messages.map((m) => toChatMessageDto(m, followUps.has(m.id))),
  };
  if (extras.followUp !== undefined) detail.followUp = { ...extras.followUp };
  return detail;
}
