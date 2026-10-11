import type { AcpDatabase } from '../../database.js';
import { createContext, type RepositoryOptions } from '../../internal/context.js';
import {
  createAgentRunSessionsRepository,
  type AgentRunSessionsRepository,
} from './agent-run-sessions.js';
import { createAgentRunsRepository, type AgentRunsRepository } from './agent-runs.js';
import { createApprovalsRepository, type ApprovalsRepository } from './approvals.js';
import { createArtifactsRepository, type ArtifactsRepository } from './artifacts.js';
import {
  createOrchestratorMessagesRepository,
  type OrchestratorMessagesRepository,
} from './messages.js';
import { createOrchestrationRunsRepository, type OrchestrationRunsRepository } from './runs.js';
import {
  createManagedWorkspacesRepository,
  type ManagedWorkspacesRepository,
} from './workspaces.js';

/** Phase 3 managed-orchestration persistence (migration 0002). */
export interface OrchestrationRepositories {
  runs: OrchestrationRunsRepository;
  agentRuns: AgentRunsRepository;
  agentRunSessions: AgentRunSessionsRepository;
  approvals: ApprovalsRepository;
  artifacts: ArtifactsRepository;
  workspaces: ManagedWorkspacesRepository;
  messages: OrchestratorMessagesRepository;
}

/**
 * Builds the orchestration repositories over one connection. Like `createRepositories`, they do
 * not open transactions except where one call must be atomic; wrap multi-step writes (for example
 * a state change plus its approval) in `withTransaction`.
 */
export function createOrchestrationRepositories(
  db: AcpDatabase,
  options: RepositoryOptions = {},
): OrchestrationRepositories {
  const ctx = createContext(db, options);
  return {
    runs: createOrchestrationRunsRepository(ctx),
    agentRuns: createAgentRunsRepository(ctx),
    agentRunSessions: createAgentRunSessionsRepository(ctx),
    approvals: createApprovalsRepository(ctx),
    artifacts: createArtifactsRepository(ctx),
    workspaces: createManagedWorkspacesRepository(ctx),
    messages: createOrchestratorMessagesRepository(ctx),
  };
}

export type {
  OrchestrationRunsRepository,
  RunCursor,
  RunInsertInput,
  RunListItem,
  RunListOptions,
  RunRemoval,
  RunStatusUpdate,
} from './runs.js';
export type {
  AgentRunInsertInput,
  AgentRunStatusUpdate,
  AgentRunsRepository,
  StoredAgentRun,
} from './agent-runs.js';
export {
  AGENT_RUN_SESSION_RELATIONS,
  type AgentRunSessionInput,
  type AgentRunSessionRelation,
  type AgentRunSessionRow,
  type AgentRunSessionsRepository,
} from './agent-run-sessions.js';
export {
  MAX_APPROVAL_SUMMARY_LENGTH,
  type ApprovalDecision,
  type ApprovalInsertInput,
  type ApprovalKind,
  type ApprovalListOptions,
  type ApprovalRow,
  type ApprovalsRepository,
} from './approvals.js';
export {
  ARTIFACT_KINDS,
  isSafeStoragePath,
  type ArtifactInsertInput,
  type ArtifactKind,
  type ArtifactRow,
  type ArtifactsRepository,
} from './artifacts.js';
export {
  WORKSPACE_STATES,
  type ManagedWorkspacesRepository,
  type WorkspaceInsertInput,
  type WorkspaceReviewUpdate,
  type WorkspaceRow,
  type WorkspaceState,
} from './workspaces.js';
export {
  MAX_ORCHESTRATOR_MESSAGE_LENGTH,
  ORCHESTRATOR_MESSAGE_ROLES,
  type OrchestratorMessageInput,
  type OrchestratorMessageListOptions,
  type OrchestratorMessageRow,
  type OrchestratorMessagesRepository,
  type OrchestratorMessageRole,
} from './messages.js';
