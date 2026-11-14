import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  APPROVAL_TIMEOUT_MS,
  HARD_MAX_DEPTH,
  isEmptyStartingPoints,
  isPathInside,
  renderStartingPoints,
  type StartingPoints,
  LeadToolInputs,
  type AgentEffort,
  type RunAgentKind,
  type Attachment,
  type FullAutoSpec,
  type ManagedAgentEvent,
  type ManagedAgentSpec,
  type ManagedAgentHandle,
  type ManagedExecutionAdapter,
  type ManagedFailureCode,
  type ManagedProviderId,
  type NormalizedEvent,
  type PermissionDecision,
  type PermissionRequest,
  type CompileContext,
  type HarnessManifest,
  type ProjectApprovals,
  type ProjectWorkflow,
  type RegisteredRoot,
  type RunBudget,
  type RunStatus,
  type AnyWorkflowGraph,
  type TicketPlan,
} from '@acp/core';
import {
  ApprovalDecisionRequestSchema,
  ChatRequestSchema,
  ReviewActionRequestSchema,
  StartRunRequestSchema,
  type AgentRunDto,
  type ApprovalDto,
  type ChatMessageDto,
  type ConflictResolutionDto,
  type ConflictResolutionViewDto,
  type ManagedProviderAvailabilityDto,
  type ReviewDto,
  type RunDetailDto,
  type RunSummaryDto,
  type RunWorkflowDto,
  type RunWorkflowGraphDto,
  type StreamNoticeDto,
  type TicketBranchDto,
  type TicketBranchReviewDto,
} from '@acp/core/api';
import {
  MAX_PAGE_SIZE,
  withTransaction,
  type AcpDatabase,
  type Repositories,
  type WorkspaceRow,
} from '@acp/db';
import {
  AGENT_NOTE_LINE,
  agentDepth,
  agentEvent,
  agentSetupFailed,
  agentLaunchMode,
  allowlistTarget,
  cancelRun,
  checkReviewAction,
  completeCancellation,
  continueStages,
  createRun,
  decideApproval,
  decidePlan,
  decidePlanOption,
  deriveRunWorkflow,
  deriveRunWorkflowGraph,
  effectiveMode,
  expireApprovals,
  followUpChat,
  followUpEvent,
  followUpView,
  isActiveAgentStatus,
  isApprovalOverdue,
  isRunOverdue,
  leadHasEnded,
  leadToolCall,
  ownerChat,
  pluginSkillName,
  programOf,
  resolveAgentModel,
  reviewRouteOf,
  recordReview,
  recoverAfterRestart,
  requestPermission,
  runGraphV3Of,
  runLimits,
  stopAgent,
  stopFollowUp,
  timeOutRun,
  viewChangeReply,
  type AllowlistTarget,
  type AllowlistVerdict,
  type EngineContext,
  type EngineEffect,
  type EngineResult,
  type CreateRunInput,
  type PlanOption,
  type FollowUpFacts,
  type PlanDecision,
  type Refusal,
  type RunLimits,
  type RunState,
} from '@acp/orchestrator';
import type { WorktreeSetup, WorktreeSetupInput } from '../board/checks.js';
import type { CodeHostService } from '../code-host/index.js';
import { HttpError, notFound } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import {
  WorkspaceError,
  type GitRunner,
  type LineCounts,
  type Workspace,
  type WorkspaceManager,
} from '../workspace/index.js';
import { createSkillsPlugins, type SkillsPlugins } from '../workflow/skills-plugin.js';
import {
  createAgentProfiles,
  type AgentProfile,
  type AgentProfiles,
} from '../workflow/agent-profile.js';
import { allowlistVerdict, type AllowlistContext } from './allowlist.js';
import {
  DENY_READ_UNAVAILABLE_LINE,
  MANAGED_PROVIDER_NAMES,
  capabilityRefusal,
  dropsSkills,
  skillsIgnoredLine,
  type CapabilityRefusal,
} from './capabilities.js';
import { SELF_RECORDED_USAGE, managedSessionEvents, managedUsageEvent } from './managed-usage.js';
import { createFullAutoPaths, FULL_AUTO_DENIED_MESSAGE, type FullAutoPaths } from './full-auto.js';
import { createCsrfToken } from './csrf.js';
import {
  CODE_MAP_WAIT_MS,
  codeMapToolReply,
  repoMapText,
  startRunCodeMap,
  type RunCodeMap,
  type RunCodeMapSource,
} from './code-map.js';
import { createConflictResolution } from './conflict-resolution.js';
import { createMailbox, deliveryLine, emptyMail, type RunMail } from './mailbox.js';
import { refusalError, workspaceError } from './errors.js';
import {
  summaryOf,
  toAgentDto,
  toApprovalDto,
  toChatMessageDto,
  toRunDetail,
  toRunSummary,
} from './mappers.js';
import {
  createReviewCheckouts,
  type ReviewCheckout,
  type ReviewCheckouts,
} from './review-checkouts.js';
import {
  REVIEWER_DIFF_MAX_BYTES,
  VIEW_DIFF_MAX_BYTES,
  createReviewLoop,
  type CommitChecksHooks,
  type MergeOutcome,
} from './review-loop.js';
import { reviewCounts, toChangeReviewDtos, toTicketBranchDto } from './review-loop-dto.js';
import { hasReviewableChange, isReadOnlyRole } from './roles.js';
import { TICKET_SUMMARY_SO_FAR, createRunSummaries, endTrigger } from './run-summary.js';
import {
  ATTACHMENTS_DIR,
  createAttachmentFiles,
  type AttachmentFiles,
} from '../attachments/files.js';
import {
  AGENT_ATTACHMENTS_DIR,
  RUN_ATTACHMENTS_DIR,
  attachmentsBrief,
  placeAgentCopies,
} from '../attachments/agent-copies.js';
import { agentName } from './session-names.js';
import { createRunStore, type RunStore } from './store.js';
import { workspaceFromRow } from './workspaces.js';

/**
 * The control panel's run service (P3-D): wires the pure engine (`@acp/orchestrator`), the managed
 * adapter, the database and the workspace manager together.
 *
 * Every change goes through `apply`: the engine decides, the new state is **persisted first**, then
 * notices are published and the engine's effects are carried out in order
 * (orchestration-lifecycle §1). Effects never wait on each other except a worker's start, which
 * first creates its git worktree; messages for a worker that is still starting are held until it
 * runs.
 */

/** Live work interrupted by a restart is never relaunched (ADR-0013 §7). */
const NON_TERMINAL: readonly RunStatus[] = [
  'QUEUED',
  'PLANNING',
  'PLAN_REVIEW',
  'RUNNING',
  'BLOCKED',
  'REVIEW',
  'CANCELLING',
  'NEEDS_REVIEW',
];
/**
 * Run states the run timeout applies to; a run under review, or a plan waiting for the owner
 * (PLAN_REVIEW), waits for the owner. So does a loop run whose only pending work is a change at
 * the owner's decision: that time is not counted (`isRunOverdue`, P-D).
 */
const WORKING: readonly RunStatus[] = ['QUEUED', 'PLANNING', 'RUNNING', 'BLOCKED'];

/** P-D: the ticket's line when a rework turn could not continue the helper's saved session. */
export function reworkNewSessionLine(role: string): string {
  return `${role} could not continue its earlier conversation, so it reworks its change in a new session, in the same folder with its earlier work.`;
}

export const DEFAULT_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
/** Stop all: abort, then give the processes this long before the run is marked cancelled anyway. */
const DEFAULT_CANCEL_GRACE_MS = 10_000;
/** CX-4: a provider found unavailable is asked again at most this often (the injected clock). */
export const AVAILABILITY_RECHECK_MS = 60_000;
/** CX-4: the reason given when `checkAvailable` itself failed (it should never throw). */
export const AVAILABILITY_CHECK_FAILED = 'The provider could not be checked.';

export type Availability = { ok: true } | { ok: false; reason: string };

export const LEAD_READ_ONLY_MESSAGE =
  'The lead agent works read-only in the project. Start a worker agent to change files or run commands.';
export const PLANNER_READ_ONLY_MESSAGE =
  'The planner works read-only in the project. Write the plan with submit_plan; helpers make the changes after approval.';
export const REVIEWER_READ_ONLY_MESSAGE =
  'The reviewer only reads the merged result. Post your findings with post_review.';
/** ADR-0037 §3: a researcher's tool use the adapter's gate did not settle: denied, never asked. */
export const RESEARCHER_READ_ONLY_MESSAGE =
  'The researcher works read-only in the project. Report what you found with report_findings.';
/** A follow-up turn's tool use the adapter's gate did not settle (ADR-0020): denied, never asked. */
export const FOLLOW_UP_READ_ONLY_MESSAGE =
  'This run has ended: you can only read the project and answer. New work needs a new run.';

/** Terminal run states: the run's temporary files (its skills plugin) can go. */
const TERMINAL: readonly RunStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Added to the first message of a helper that may start helpers (depth 2). The adapter ends a
 * helper's query when its turn ends, so a parent that wants to hear from its helpers has to stay
 * in its turn; the server then tells it when each one ends (`notifyParent`).
 */
export const PARENT_HELPER_NOTE =
  'You may start helpers of your own with start_agent. If you do, stay with them until they finish: ' +
  'check on them with agent_status. You will also get a message when each of them ends.';

/** What a run's agents get from the project's setup (ADR-0012 amendment). */
export interface AgentSetup {
  /** Project context for `ManagedAgentSpec.context`; empty for none. */
  context: string;
  /** The project's chosen model, or null for the provider default. */
  model: string | null;
}

const NO_SETUP: AgentSetup = { context: '', model: null };

/** Whether a worker's changes may be merged, from its harness checks (ADR-0017 §4). */
export interface ReviewGate {
  /** Names of required checks whose latest result on these changes is not a pass. */
  failedRequired: readonly string[];
  /** Checks are running on these changes right now. */
  running: boolean;
}

/**
 * Phase 4 wiring (P4-D): the board layer's view into the run service. Every hook is optional, so
 * the Phase 3 control panel (and its tests) run unchanged without them.
 */
export interface ControlWorkspaceHooks {
  /** Inside each transition's database transaction (a ticket's status follows its run). */
  inCommit?: (prev: RunState | null, next: RunState) => void;
  /** After a transition was committed and its effects started (notices, checks on review). */
  afterCommit?: (prev: RunState | null, next: RunState) => void;
  /** The project's context files and model for a run's agents; read once per run. */
  agentSetup?: (projectId: string) => Promise<AgentSetup>;
  /**
   * The project's allowlist and harness checks; null when nothing may run unasked. `policy`
   * (ADR-0021): the run's snapshotted approval mode and command allowlist, which then decide.
   */
  allowlist?: (projectId: string, policy?: ProjectApprovals) => Promise<AllowlistContext | null>;
  /** ADR-0021: the harness checks per commit (the merge gate and the checks it starts). */
  commitChecks?: CommitChecksHooks;
  /**
   * ADR-0027 §1: runs the project's setup steps in a new helper's or tester's worktree before it
   * starts. Not called for rework turns (the worktree is set up), nor for reading roles.
   */
  setupWorktree?: (input: WorktreeSetupInput) => Promise<WorktreeSetup>;
  /**
   * ADR-0030: the harness file of the project's own checkout (never a candidate's), for the
   * conflict-resolution policy gate; null without a valid one.
   */
  readManifest?: (projectId: string) => Promise<HarnessManifest | null>;
  reviewGate?: (runId: string, agentRunId: string) => ReviewGate;
  /** The owner merged although a required check failed; `reason` is their own text. */
  mergedAnyway?: (input: {
    runId: string;
    agentRunId: string;
    role: string;
    reason: string;
    failedChecks: readonly string[];
  }) => void;
}

export interface TicketRunInput {
  projectId: string;
  ticketId: string;
  title: string;
  /** The lead's brief (`ticketRunPrompts`: `ticketLeadPrompt`, or the orchestrator's brief). */
  leadPrompt: string;
  /** Separate planner mode (ADR-0019): the planner's brief (`ticketRunPrompts`). */
  plannerPrompt?: string;
  /** ADR-0037 §3: the ticket part of every researcher's brief (`ticketResearcherPrompt`). */
  researcherPrompt?: string;
  /** The project's workflow, snapshotted with the run (ADR-0019). */
  workflow?: ProjectWorkflow;
  limits: RunLimits;
  budget: RunBudget;
  /** ADR-0021 §3: the review loop for this run (the board resolves the overrides); absent: legacy. */
  reviewLoop?: CreateRunInput['reviewLoop'];
  /** ADR-0021 §1: the approval policy snapshotted with the run; absent: the legacy allowlist. */
  approvals?: ProjectApprovals;
  /**
   * ADR-0023: the project's workflow graph, validated, snapshotted with the run and compiled with
   * `graphContext` (both or neither); version 3 from the board (ADR-0037). Absent: the version 1
   * `workflow` (legacy test runs).
   */
  graph?: AnyWorkflowGraph;
  graphContext?: CompileContext;
  /** Runs in the same transaction as the new run's insert (the ticket's status and current run). */
  inTransaction?: (runId: string) => void;
}

export interface ControlServiceDeps {
  db: AcpDatabase;
  repos: Repositories;
  /**
   * The managed adapters by provider (ADR-0031 §2); empty when managed execution is off. An agent
   * runs only on its own provider's adapter, never on another.
   */
  adapters: ReadonlyMap<ManagedProviderId, ManagedExecutionAdapter>;
  workspaces: WorkspaceManager;
  /** Used only to re-derive a stored workspace's repository root after a restart. */
  git: GitRunner;
  dataDir: string;
  /** False: the control routes answer `managed_disabled`; restart recovery still runs. */
  enabled: boolean;
  logger: Logger;
  now: () => Date;
  publish: (notice: StreamNoticeDto) => void;
  runTimeoutMs?: number;
  approvalTimeoutMs?: number;
  cancelGraceMs?: number;
  /**
   * ADR-0033 §6: how long a change's merge may wait for its required checks. Default 10 minutes;
   * tests pass a short one.
   */
  mergeTimeoutMs?: number;
  /** Interval of the approval-expiry / run-timeout sweep; null disables the timer (tests). */
  sweepIntervalMs?: number | null;
  /** Ingests what is on disk now; awaited before a worker's worktree is removed. */
  flushIngestion?: () => Promise<void>;
  /**
   * ADR-0032 §5: ingests the session and usage events of a managed provider ACP does not observe
   * from files (Codex) through the ingestion pipeline. Omitted: that usage reaches only the run's
   * budget, as before CX-4.
   */
  ingestManaged?: (events: readonly NormalizedEvent[]) => void;
  newId?: () => string;
  csrfToken?: string;
  /** Phase 4 board wiring; omitted for the Phase 3 control panel alone. */
  workspace?: ControlWorkspaceHooks;
  /** ADR-0025: the owner's push and pull requests; omitted, those routes answer 404. */
  codeHost?: CodeHostService;
  /** The reviewer's temporary checkouts (ADR-0019); defaults to `<dataDir>/review-checkouts`. */
  reviewCheckouts?: ReviewCheckouts;
  /** The run-scoped skills plugins (ADR-0019 §4); defaults to `<dataDir>/runs/<runId>/…`. */
  skillsPlugins?: SkillsPlugins;
  /** Reads a stage's project agent file (ADR-0019 §6); injected so tests use a temp home. */
  agentProfiles?: AgentProfiles;
  /**
   * The user's home folder, for Full auto's deny-read list (ADR-0022). Defaults to
   * `os.homedir()`; tests pass a temp folder.
   */
  homeDir?: string;
  /** Claude Code's config folder, also denied to Full auto's sandboxed commands. */
  claudeDir?: string;
  /** Codex's home (`CODEX_HOME`, else `~/.codex`), also denied to them (CX-4). */
  codexHome?: string;
  /** Full auto's per-run temp folders and deny-read list; defaults to `<dataDir>/sandbox-tmp`. */
  fullAutoPaths?: FullAutoPaths;
  /** ADR-0026 §4: the attachments' bytes; defaults to `<dataDir>/attachments`. */
  attachmentFiles?: AttachmentFiles;
  /**
   * ADR-0034 §4 (CM-2): the project code map. A ticket run builds its base commit's map in the
   * background; agents get the repository map and the `code_map` tool from it. Omitted: no map,
   * and `code_map` refuses.
   */
  codeMap?: RunCodeMapSource;
  /** How long the first launches wait for the run's map; default `CODE_MAP_WAIT_MS` (15 s). */
  codeMapWaitMs?: number;
}

export interface ControlCounters {
  /** Content-free engine diagnostics by code (worker text dropped, invalid usage, ...). */
  diagnostics: Record<string, number>;
  /** Tool uses the lead asked for and that were denied without asking (lead is read-only). */
  leadToolUsesDenied: number;
  /** Agents whose own estimated cost passed `softCostUsdPerRun` (ADR-0014; never summed). */
  costWarnings: number;
}

export interface ControlService {
  readonly enabled: boolean;
  readonly csrfToken: string;
  /** ADR-0026 §4: the attachments' bytes in the app's data folder (the board serves them). */
  readonly attachmentFiles: AttachmentFiles;
  /** Orphan worktree cleanup and the sweep timer; call once before serving requests. */
  start(): Promise<void>;
  /** Aborts every running agent without recording anything; restart recovery handles them. */
  close(): Promise<void>;
  listRuns(): RunSummaryDto[];
  getRun(runId: string): RunDetailDto;
  createRun(body: unknown): RunDetailDto;
  /** Returns the owner's message as stored. */
  chat(runId: string, body: unknown): ChatMessageDto;
  decideApproval(approvalId: string, body: unknown): ApprovalDto;
  stopAgent(runId: string, agentRunId: string): AgentRunDto;
  /** The owner's message to one worker; sent, never stored (worker conversation, ADR-0015). */
  messageAgent(runId: string, agentRunId: string, body: unknown): AgentRunDto;
  /** Stop all for one run. */
  stopRun(runId: string): RunSummaryDto;
  review(runId: string): Promise<ReviewDto>;
  /**
   * Merge, merge anyway (a required check failed; needs a reason) or discard one worker's changes;
   * returns the updated review.
   */
  reviewAction(runId: string, body: unknown): Promise<ReviewDto>;
  /** ADR-0021 §4: the run's ticket branch, its combined change `base...tip` and its checks. */
  ticketBranch(runId: string): Promise<TicketBranchReviewDto>;
  /**
   * ADR-0021 §4: the owner's merge (once, as a fast-forward), merge anyway, request changes,
   * discard or update from the base branch; returns the ticket branch afterwards.
   */
  ticketBranchAction(runId: string, body: unknown): Promise<TicketBranchReviewDto>;
  /**
   * F-1: the owner's "Reset to the last reviewed commit" for a ticket branch changed outside the
   * app (`ResetTicketBranchRequest`); returns the ticket branch afterwards.
   */
  resetTicketBranch(runId: string, body: unknown): Promise<TicketBranchReviewDto>;
  /**
   * ADR-0025 §4: the owner's Push & open PR for the run's ticket branch (`OpenPullRequestRequest`),
   * or the link to the open one; returns the ticket branch with its pull request.
   */
  openPullRequest(
    runId: string,
    body: unknown,
    ticket: { key: string; title: string },
  ): Promise<TicketBranchDto>;
  /** ADR-0025: reads the pull request's state now; merged on GitHub completes the run. */
  refreshPullRequest(runId: string): Promise<TicketBranchDto>;
  /** ADR-0030: the run's latest conflict-resolution operation and the project's policy. */
  conflictResolution(runId: string): Promise<ConflictResolutionViewDto>;
  /** ADR-0030: the owner's "Update target / Resolve conflicts" (CSRF). */
  startConflictResolution(runId: string): Promise<ConflictResolutionDto>;
  /** ADR-0030: the owner cancels the operation under way. */
  cancelConflictResolution(runId: string): Promise<ConflictResolutionDto>;
  /** ADR-0030: the owner applies a candidate the policy gate held (`PromoteResolutionRequest`). */
  promoteConflictResolution(runId: string, body: unknown): Promise<ConflictResolutionDto>;
  /** A plan-first run for a board ticket (ADR-0016): PLANNING, its lead starts on the brief. */
  createTicketRun(input: TicketRunInput): RunDetailDto;
  /**
   * The owner's Continue after a restart (ADR-0019, `continueStages`): starts the post-merge stage
   * the restart held. Refused while an agent works, a change is unreviewed, or nothing waits.
   */
  continueRun(runId: string): RunDetailDto;
  /** Each workflow stage's live state on the run (`deriveRunWorkflow`). */
  runWorkflow(runId: string): RunWorkflowDto;
  /**
   * ADR-0023: the graph the run snapshotted (a version 1 run's workflow migrated) and each node's
   * live state (`deriveRunWorkflowGraph`).
   */
  runWorkflowGraph(runId: string): RunWorkflowGraphDto;
  /** The owner's decision on the plan waiting in PLAN_REVIEW; returns the decided plan. */
  decidePlan(runId: string, planId: string, decision: PlanDecision, comment?: string): TicketPlan;
  /**
   * ADR-0037 §4: the owner's decision on the plan options of a run with several planners
   * (`decidePlanOption`): approve one (`planOptionId`, required when two or more wait) or ask
   * every planner for changes (a comment is required). Returns the chosen option, or null.
   */
  decidePlanOption(
    runId: string,
    decision: PlanDecision,
    input: { planOptionId?: string; comment?: string },
  ): PlanOption | null;
  /** The run's engine state if this process holds it (live or loaded); never loads it. */
  peek(runId: string): RunState | undefined;
  /** A worker's worktree, when it has one that still exists. */
  agentWorkspace(runId: string, agentRunId: string): Promise<Workspace | undefined>;
  /** Active worktrees as extra roots of their run's project (scheduler and pipeline). */
  extraRoots(): RegisteredRoot[];
  /** True for paths under the managed worktrees directory (never offered as a new project). */
  isManagedPath(cwd: string): boolean;
  /** Expires overdue approvals, times out runs and finishes stuck cancellations. */
  sweep(): void;
  /** Tests: resolves when no worker start, send or pump step is in flight. */
  idle(): Promise<void>;
  counters(): ControlCounters;
  /** ADR-0031 (CX-4): each registered managed provider's last availability check. */
  providerAvailability(): ManagedProviderAvailabilityDto[];
  /**
   * ADR-0035: whether a registered provider can start an agent now, through the same cache and
   * check as a run's agents (CX-4). Unregistered: not available.
   */
  checkProvider(provider: ManagedProviderId): Promise<Availability>;
  /**
   * ADR-0036: the project's runs that keep it from being removed, oldest first: a run that has not
   * ended (database or memory), one whose agents, follow-up turn or merges are still at work in
   * this process, or one with a conflict resolution under way.
   */
  activeRuns(projectId: string): { runId: string; status: RunStatus }[];
  /**
   * ADR-0036: drops what this process holds in memory for runs whose rows were deleted (a removed
   * project). Only call it for runs `activeRuns` did not list.
   */
  forgetRuns(runIds: readonly string[]): void;
}

interface LiveRun {
  state: RunState;
  handles: Map<string, ManagedAgentHandle>;
  /** Workers whose worktree is being created. */
  starting: Set<string>;
  /**
   * ADR-0033: messages queued for agents that are starting, held for agents that cannot take
   * input now, and the run's metadata-only outbox. In memory only.
   */
  mail: RunMail;
  /** Workspaces created by this process. */
  workspaces: Map<string, Workspace>;
  cancellingSince: number | null;
  /** The project's context and model, read once when the run's first agent starts. */
  setup?: Promise<AgentSetup>;
  /** Reviewers' checkouts being made or in use, by agent run id (null: creating it failed). */
  reviewCheckouts: Map<string, Promise<ReviewCheckout | null>>;
  /**
   * The ended lead's follow-up turn process (ADR-0020), kept apart from `handles`: the lead's
   * agent record stays ended, and a run's cancellation never waits for it.
   */
  followUp: ManagedAgentHandle | undefined;
  /** ADR-0021: the merge under way per agent (the lead's `merge_change` awaits its reply). */
  merges: Map<string, Promise<MergeOutcome>>;
  /** ADR-0021: one merge into the ticket branch at a time per run. */
  mergeChain: Promise<unknown>;
  /** ADR-0021: the latest commit whose checks were started per agent. */
  checkTargets: Map<string, string>;
  /**
   * ADR-0034 (CM-2): the run's code map, started when the ticket run was created in this process;
   * a run loaded after a restart has only the cached repository map (its commit comes from the
   * ticket branch record).
   */
  codeMap?: RunCodeMap;
  repoMap?: { commit: string; text: string };
}

/** A code map source with no maps: `code_map` then refuses (no `deps.codeMap`). */
const NO_MAP_SOURCE: RunCodeMapSource = {
  ensureForCommit: () => Promise.reject(new Error('no code map')),
  mapAt: () => undefined,
};

/** The most checks an editing agent's brief lists by name and command (ADR-0027 §4). */
const BRIEF_MAX_CHECKS = 10;

/**
 * ADR-0033 §2: messages held for the ended lead, put before the owner's message of its next
 * follow-up turn. Sent, never stored.
 */
function heldBlock(texts: readonly string[]): string {
  return [
    'Messages that arrived for you after your own work ended, oldest first (for your information; this chat has no control tools):',
    ...texts.map((t, i) => `${i + 1}. ${t}`),
  ].join('\n\n');
}

/** One argument list as the agent would type it (arguments with spaces or quotes are quoted). */
function commandLine(argv: readonly string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(' ');
}

/**
 * ADR-0027 §4: one to three short lines for an editing agent's first brief, only when the project
 * has a harness file: the setup steps that ran (names) and the checks it may run (names and the
 * exact commands; the allowlist pre-approves exactly those, per the run's approval mode).
 */
export function setupBriefLines(setup: Extract<WorktreeSetup, { ok: true }>): string[] {
  if (!setup.hasHarness) return [];
  const lines: string[] = [];
  if (setup.ran.length > 0) {
    lines.push(`The project's setup already ran in your copy: ${setup.ran.join(', ')}.`);
  }
  const checks = setup.checks.slice(0, BRIEF_MAX_CHECKS);
  if (checks.length > 0) {
    const list = checks.map(
      (c) => `${c.name} (\`${commandLine(c.argv)}\`${c.cwd !== undefined ? ` in ${c.cwd}` : ''})`,
    );
    lines.push(
      `You may run the project's checks with exactly these commands: ${list.join('; ')}${setup.checks.length > checks.length ? '; and more in .acp/harness.json' : ''}.`,
    );
  }
  return lines;
}

/** The brief with `lines` added, before the closing note line when it ends with one. */
function withBriefLines(prompt: string, lines: readonly string[]): string {
  if (lines.length === 0) return prompt;
  const block = lines.join('\n');
  if (!prompt.endsWith(AGENT_NOTE_LINE)) return `${prompt}\n\n${block}`;
  const head = prompt.slice(0, prompt.length - AGENT_NOTE_LINE.length).trimEnd();
  return `${head}\n\n${block}\n\n${AGENT_NOTE_LINE}`;
}

/** What `launch` needs from a `start-agent` effect. */
interface LaunchInput {
  agentRunId: string;
  kind: RunAgentKind;
  cwd: string;
  prompt: string;
  setup: AgentSetup;
  /** The stage's model (`start-agent.model`); else the agent file's, else the project's. */
  model?: string | undefined;
  /** ADR-0028 §1: the node's reasoning effort (`start-agent.effort`); absent: the model's default. */
  effort?: AgentEffort | undefined;
  plugin?: { path: string; skills: readonly string[] } | undefined;
  /** The stage's agent file (ADR-0019 §6), when it could be read; its `model` is the fallback. */
  agentFile?: { profile: AgentProfile; model: string | null } | undefined;
  canStartHelpers?: boolean;
  /** ADR-0021: a rework turn resumes this session (null: fresh). */
  rework?: { resumeSessionId: string | null } | undefined;
  /** ADR-0021: what a reviewer reviews. */
  reviewScope?: 'change' | 'final' | undefined;
  /** ADR-0026 §4: the lead's or planner's attachment copies, readable without asking. */
  readOnlyDirs?: string[] | undefined;
  /**
   * ADR-0022, ADR-0023 §5: a helper's or tester's sandbox paths, with auto mode (its block runs
   * Full auto) or without (a Full auto block a ticket or run tightened).
   */
  protection?: AgentProtection | undefined;
  /** ADR-0034 §4 (CM-3): a helper's starting points, rendered with the run's map at launch. */
  startingPoints?: StartingPoints | undefined;
}

/** What a pump needs to record a self-recorded provider's usage (`usageRecorder`). */
interface UsageSource {
  provider: ManagedProviderId;
  cwd: string;
  /** The model the server asked for; the `started` event's reported model replaces it. */
  model: string | null;
}

/** How a helper or tester is protected at launch (`ManagedAgentSpec.fullAuto` or `.sandbox`). */
interface AgentProtection {
  autoMode: boolean;
  paths: FullAutoSpec;
}

type Applied<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

/**
 * The raw tool input of a permission request, used only to match it against the project allowlist.
 * It never reaches the engine state, the database, the logs or the UI: `parkForOwner` passes named
 * fields only (ADR-0009, ADR-0013 amendment).
 */
function toolInputOf(request: PermissionRequest): unknown {
  return request.input;
}

export function createControlService(deps: ControlServiceDeps): ControlService {
  const { logger } = deps;
  const hooks: ControlWorkspaceHooks = deps.workspace ?? {};
  const store: RunStore = createRunStore({ db: deps.db, now: deps.now });
  const reviewCheckouts =
    deps.reviewCheckouts ?? createReviewCheckouts({ dataDir: deps.dataDir, git: deps.git, logger });
  const skillsPlugins = deps.skillsPlugins ?? createSkillsPlugins({ dataDir: deps.dataDir });
  const agentProfiles = deps.agentProfiles ?? createAgentProfiles();
  const attachmentFiles =
    deps.attachmentFiles ?? createAttachmentFiles({ root: join(deps.dataDir, ATTACHMENTS_DIR) });
  const fullAutoPaths =
    deps.fullAutoPaths ??
    createFullAutoPaths({
      homeDir: deps.homeDir ?? homedir(),
      dataDir: deps.dataDir,
      ...(deps.claudeDir !== undefined && { claudeDir: deps.claudeDir }),
      ...(deps.codexHome !== undefined && { codexHome: deps.codexHome }),
    });
  /** Reviewer checkouts in use, for the observation pipeline's roots (by agent run id). */
  const activeCheckouts = new Map<string, { projectId: string; checkout: ReviewCheckout }>();
  const newId = deps.newId ?? (() => randomUUID());
  const csrfToken = deps.csrfToken ?? createCsrfToken();
  const runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const approvalTimeoutMs = deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
  const cancelGraceMs = deps.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  const sweepIntervalMs =
    deps.sweepIntervalMs === undefined ? DEFAULT_SWEEP_INTERVAL_MS : deps.sweepIntervalMs;

  const runs = new Map<string, LiveRun>();
  /** Parked SDK permission callbacks, by approval id (the approval bridge). */
  const permissions = new Map<string, (decision: PermissionDecision) => void>();
  const tasks = new Set<Promise<unknown>>();
  /** Event pumps live as long as their agent; `close` waits for them, `idle` does not. */
  const pumps = new Set<Promise<void>>();
  const reviewing = new Set<string>();
  const counters: ControlCounters = { diagnostics: {}, leadToolUsesDenied: 0, costWarnings: 0 };
  let closed = false;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  /** CX-4: each provider's last `checkAvailable` result, kept for the server's lifetime. */
  const availability = new Map<ManagedProviderId, { result: Availability; checkedAt: Date }>();
  /** CX-4: the check under way per provider, so concurrent starts share one. */
  const availabilityChecks = new Map<ManagedProviderId, Promise<Availability>>();

  /** Agent folders under the data dir: helpers' worktrees and reviewers' checkouts. */
  const worktreesDirs = (() => {
    const dirs: string[] = [];
    for (const name of ['worktrees', 'review-checkouts', 'ticket-checkouts']) {
      const dir = join(deps.dataDir, name);
      dirs.push(dir);
      try {
        const real = join(realpathSync(deps.dataDir), name);
        if (real !== dir) dirs.push(real);
      } catch {
        // The data dir does not exist yet; the plain path is enough.
      }
    }
    return dirs;
  })();

  const ctx = (): EngineContext => ({ now: deps.now(), newId });

  /** ADR-0033: lead/agent message delivery, held messages and the metadata-only outbox. */
  const mailbox = createMailbox({
    now: () => deps.now(),
    newId,
    logger,
    countDiagnostic: (code) => countDiagnostic(code),
    track: (promise) => track(promise),
    followUpOpen: (live) => {
      const view = followUpView(live.state, followUpFacts(live as LiveRun));
      return view !== undefined && view.state !== 'unavailable';
    },
  });

  /** ADR-0021: the review loop's git effects and the owner's loop actions. */
  const loop = createReviewLoop({
    store,
    projectRoot: (projectId) => deps.repos.projects.getById(projectId)?.rootPath,
    workspaces: deps.workspaces,
    logger,
    commitChecks: () => hooks.commitChecks,
    apply: (live, command) => apply(live as LiveRun, command),
    workspaceFor: (live, row) => workspaceFor(live as LiveRun, row),
    ...(deps.flushIngestion !== undefined && { flushIngestion: deps.flushIngestion }),
    appComment: (live, text) => appComment(live as LiveRun, text),
    ...(deps.codeHost !== undefined && { codeHost: deps.codeHost }),
    notify: (live) => notify('runs-changed', live as LiveRun),
    track,
    countDiagnostic: (code) => countDiagnostic(code),
    tipGate: (runId, tip) => resolution.tipGateOverride(runId, tip),
    ...(deps.mergeTimeoutMs !== undefined && { mergeTimeoutMs: deps.mergeTimeoutMs }),
  });

  /** ADR-0030: "Update target / Resolve conflicts" operations (server-owned git, policy gate). */
  const resolution = createConflictResolution({
    store,
    workspaces: deps.workspaces,
    logger,
    now: () => deps.now(),
    projectRoot: (projectId) => deps.repos.projects.getById(projectId)?.rootPath,
    refOf: (live, row) => loop.refOf(live as LiveRun, row),
    readManifest: async (projectId) => (await hooks.readManifest?.(projectId)) ?? null,
    commitChecks: () => hooks.commitChecks,
    apply: (live, command) => apply(live as LiveRun, command),
    release: (live, agentRunId) => loop.release(live as LiveRun, agentRunId),
    appComment: (live, text) => appComment(live as LiveRun, text),
    ownerComment: (live, text) => ownerComment(live as LiveRun, text),
    notify: (live) => notify('runs-changed', live as LiveRun),
    track,
    delivery: {
      openPullRequest: async (live, draft) => {
        const l = live as LiveRun;
        const ticket = ticketOf(l);
        if (ticket === null) throw new HttpError(409, 'no_ticket', 'The run has no ticket');
        await loop.openPullRequest(l, { draft }, ticket);
      },
      mergeLocally: async (live) => {
        const l = live as LiveRun;
        await loop.ticketBranchAction(
          l,
          { action: 'merge' },
          {
            ownerComment: (text) => ownerComment(l, text),
            appComment: (text) => appComment(l, text),
          },
        );
      },
    },
  });

  function ticketOf(live: LiveRun): { key: string; title: string } | null {
    const ticketId = live.state.run.ticketId;
    const ticket = ticketId === null ? undefined : store.workspaceRepos.tickets.getById(ticketId);
    return ticket === undefined ? null : { key: ticket.key, title: ticket.title };
  }

  /** The owner's own words (ADR-0016, ADR-0021 §6), kept on the run's ticket. */
  function ownerComment(live: LiveRun, text: string): void {
    const ticketId = live.state.run.ticketId;
    if (ticketId === null) return;
    try {
      store.workspaceRepos.comments.insert({
        ticketId,
        runId: live.state.run.id,
        author: 'owner',
        body: text.slice(0, 8000),
        kind: 'comment',
      });
    } catch (error) {
      logger.log('error', 'owner comment not stored', {
        runId: live.state.run.id,
        ...errorFields(error),
      });
    }
  }

  /**
   * ADR-0024 §3: one comment by author `app` on the run's ticket (app data only: branch names,
   * commit ids, counts, pull request numbers), followed by the board's notice.
   */
  function appComment(live: LiveRun, text: string): void {
    const ticketId = live.state.run.ticketId;
    if (ticketId === null) return;
    try {
      store.workspaceRepos.comments.insert({
        ticketId,
        runId: live.state.run.id,
        author: 'app',
        body: text,
        // ADR-0026: a one-line event (a merge, a pull request) on the Conversation tab.
        kind: 'system',
      });
    } catch (error) {
      logger.log('error', 'app comment not stored', {
        runId: live.state.run.id,
        ...errorFields(error),
      });
    }
  }

  /** ADR-0024 §3: the run summary comments, composed from the app's own records. */
  const summaries = createRunSummaries({
    store,
    logger,
    publish: deps.publish,
    lastEventId: () => deps.repos.events.maxId() ?? 0,
    lineCounts: (live) => lineCountsOf(live as LiveRun),
    track,
    countDiagnostic: (code) => countDiagnostic(code),
  });

  /**
   * The files and lines of each change, where git can tell (ADR-0024 §3): a loop change from its
   * sealed commit in the project's repository (its worktree may be gone), a legacy change from
   * its worktree while it is still there. Never rejects; an unknown count is left out.
   */
  async function lineCountsOf(live: LiveRun): Promise<Map<string, LineCounts>> {
    const out = new Map<string, LineCounts>();
    const project = deps.repos.projects.getById(live.state.run.projectId);
    if (project === undefined) return out;
    const loopRun = live.state.integration !== undefined;
    for (const row of store.repos.workspaces.listForRun(live.state.run.id)) {
      try {
        if (loopRun) {
          const head = store.loopRepos.workspaceChanges.getByAgentRun(row.agentRunId)?.headCommit;
          if (head === undefined || head === null || row.baseCommit === null) continue;
          const counts = await deps.workspaces.lineCounts(project.rootPath, row.baseCommit, head);
          if (counts !== null) out.set(row.agentRunId, counts);
        } else if (row.state === 'active') {
          const ws = await workspaceFor(live, row);
          const { files } = await deps.workspaces.changes(ws, { maxDiffBytes: 1 });
          const text = files.filter((f) => f.additions !== null && f.deletions !== null);
          const sum = (pick: (f: (typeof files)[number]) => number | null) =>
            text.length === 0 ? null : text.reduce((n, f) => n + (pick(f) ?? 0), 0);
          out.set(row.agentRunId, {
            files: files.length,
            additions: sum((f) => f.additions),
            deletions: sum((f) => f.deletions),
          });
        }
      } catch (error) {
        logger.log('info', 'change line counts unavailable', {
          runId: live.state.run.id,
          agentRunId: row.agentRunId,
          ...errorFields(error),
        });
      }
    }
    return out;
  }

  function track<T>(promise: Promise<T>): void {
    const p = promise.catch((error: unknown) => {
      logger.log('error', 'control task failed', errorFields(error));
    });
    tasks.add(p);
    void p.finally(() => tasks.delete(p));
  }

  /** Runs `fn` after the current call stack, so effects never re-enter `apply` mid-loop. */
  function defer(fn: () => void): void {
    track(Promise.resolve().then(fn));
  }

  function newLive(state: RunState): LiveRun {
    return {
      state,
      handles: new Map(),
      starting: new Set(),
      mail: emptyMail(),
      workspaces: new Map(),
      cancellingSince: state.run.status === 'CANCELLING' ? deps.now().getTime() : null,
      reviewCheckouts: new Map(),
      followUp: undefined,
      merges: new Map(),
      mergeChain: Promise.resolve(),
      checkTargets: new Map(),
    };
  }

  function notify(kind: StreamNoticeDto['kind'], live: LiveRun): void {
    deps.publish({
      kind,
      lastEventId: deps.repos.events.maxId() ?? 0,
      sessionIds: [],
      projectIds: [live.state.run.projectId],
      runIds: [live.state.run.id],
    });
  }

  function get(runId: string): LiveRun {
    const cached = runs.get(runId);
    if (cached !== undefined) return cached;
    const state = store.load(runId);
    if (state === undefined) throw notFound(`Run ${runId} not found`);
    const live = newLive(state);
    runs.set(runId, live);
    return live;
  }

  function projectIds(): string[] {
    return deps.repos.projects.list().map((p) => p.id);
  }

  /**
   * The one way state changes: engine command → persist → publish → effects. A refusal changes
   * nothing. A persistence failure throws before anything is published or carried out.
   */
  function apply<T>(
    live: LiveRun,
    command: (state: RunState, c: EngineContext) => EngineResult<T>,
  ): Applied<T> {
    if (closed) {
      return {
        ok: false,
        refusal: { code: 'run-not-active', message: 'The server is shutting down.' },
      };
    }
    const prev = live.state;
    const result = command(prev, ctx());
    if (!result.ok) return result;
    if (result.state === prev && result.effects.length === 0) {
      return { ok: true, value: result.value };
    }
    commit(prev, result.state, result.effects);
    live.state = result.state;
    notify('runs-changed', live);
    if (result.effects.some((e) => e.type === 'chat-message')) notify('chat-message', live);
    perform(live, result.effects);
    afterTransition(live, prev);
    afterCommit(prev, live.state);
    return { ok: true, value: result.value };
  }

  /** Persists a transition, with the board's own writes (if any) in the same transaction. */
  function commit(
    prev: RunState | null,
    next: RunState,
    effects: readonly EngineEffect[],
    extra?: () => void,
  ): void {
    if (hooks.inCommit === undefined && extra === undefined) {
      store.commit(prev, next, effects);
      return;
    }
    withTransaction(deps.db, () => {
      store.commit(prev, next, effects);
      extra?.();
      hooks.inCommit?.(prev, next);
    });
  }

  /** The board layer reacts after the fact; its failures never undo a committed transition. */
  function afterCommit(prev: RunState | null, next: RunState): void {
    if (hooks.afterCommit === undefined) return;
    try {
      hooks.afterCommit(prev, next);
    } catch (error) {
      logger.log('error', 'board update failed', { runId: next.run.id, ...errorFields(error) });
    }
  }

  function applyOrThrow<T>(
    live: LiveRun,
    command: (state: RunState, c: EngineContext) => EngineResult<T>,
  ): T {
    const result = apply(live, command);
    if (!result.ok) throw refusalError(result.refusal);
    return result.value;
  }

  function perform(live: LiveRun, effects: readonly EngineEffect[]): void {
    const runId = live.state.run.id;
    // ADR-0021 §4: the ticket branch must exist before the lead hears of the plan's approval (or,
    // in separate-planner mode, starts): a lead starts helpers at once, and `start_agent` is
    // refused until `ticketBranchCreated`. The effects after `create-ticket-branch` wait for it;
    // when the creation fails the run is stopped and they are dropped.
    const branchAt = effects.findIndex((e) => e.type === 'create-ticket-branch');
    if (branchAt !== -1) {
      const branchEffect = effects[branchAt];
      const after = effects.slice(branchAt + 1);
      perform(live, effects.slice(0, branchAt));
      if (branchEffect?.type !== 'create-ticket-branch') return;
      track(
        loop.createTicketBranch(live, branchEffect.ticketKey).then((created) => {
          const status = live.state.run.status;
          if (closed || !created || status === 'CANCELLING' || TERMINAL.includes(status)) {
            logger.log('info', 'effects after the ticket branch dropped', {
              runId,
              count: after.length,
            });
            return;
          }
          perform(live, after);
        }),
      );
      return;
    }
    for (const effect of effects) {
      switch (effect.type) {
        case 'start-agent':
          startAgent(live, effect);
          break;
        case 'send-to-agent':
          mailbox.send(live, effect.agentRunId, effect.text, effect.message);
          break;
        case 'interrupt-agent': {
          const handle = live.handles.get(effect.agentRunId);
          // Not awaited: the turn may be parked in a permission callback another effect resolves.
          if (handle !== undefined) track(handle.interrupt());
          break;
        }
        case 'abort-agent': {
          mailbox.discardQueued(live, effect.agentRunId);
          live.handles.get(effect.agentRunId)?.abort();
          break;
        }
        case 'approval-requested':
          logger.log('info', 'approval requested', { runId, approvalId: effect.approvalId });
          notify('approval-requested', live);
          break;
        case 'resolve-permission': {
          const resolve = permissions.get(effect.approvalId);
          permissions.delete(effect.approvalId);
          resolve?.(effect.decision);
          break;
        }
        case 'chat-message':
        case 'link-session':
          // Stored in the same transaction as the state (RunStore.commit).
          break;
        case 'review-comment':
          // Stored as a ticket comment in the same transaction (RunStore.commit); the board layer
          // publishes the ticket notice.
          logger.log('info', 'review comment stored', { runId, agentRunId: effect.agentRunId });
          break;
        case 'agent-note':
          // ADR-0026 §3: stored in the same transaction (RunStore.commit); no text is logged.
          logger.log('info', 'agent note stored', { runId, agentRunId: effect.agentRunId });
          break;
        case 'record-findings':
          // ADR-0037 §3: stored in the same transaction (RunStore.commit); no text is logged.
          logger.log('info', 'research findings stored', { runId, agentRunId: effect.agentRunId });
          break;
        case 'record-test-results':
          // ADR-0038 §1: stored in the same transaction (RunStore.commit); no text is logged.
          logger.log('info', 'test results stored', {
            runId,
            agentRunId: effect.agentRunId,
            code: effect.status,
          });
          break;
        // ADR-0030: the resolver's report, seal and end go to its conflict-resolution operation.
        case 'helper-outcome':
          resolution.onHelperOutcome(effect.agentRunId, effect.outcome, effect.assessment);
          break;
        case 'seal-resolution':
          resolution.sealResolution(live, effect.agentRunId, effect.operationId);
          break;
        case 'resolver-ended':
          resolution.resolverEnded(live, effect.agentRunId, effect.operationId);
          break;
        case 'start-follow-up':
          startFollowUp(live, effect);
          break;
        case 'abort-follow-up':
          live.followUp?.abort();
          break;
        case 'create-review-checkout':
          createReviewCheckout(live, effect);
          break;
        // ADR-0021 review loop: git work on the server, results reported back to the engine.
        case 'seal-change':
          loop.sealChange(live, effect.agentRunId);
          break;
        case 'create-ticket-branch':
          // Handled before the loop: the effects after it wait for the branch.
          break;
        case 'merge-change':
          loop.mergeChange(live, effect);
          break;
        case 'discard-change':
          loop.discardChange(live, effect.agentRunId);
          break;
        // ADR-0027 §5: Checks blocks, run by the check service, results back to the engine.
        case 'run-change-checks':
          loop.runChangeChecks(live, effect);
          break;
        case 'run-branch-checks':
          loop.runBranchChecks(live);
          break;
        case 'change-round':
        case 'change-comment':
          // Stored in the same transaction as the state (RunStore.commit); no text is logged.
          logger.log('info', `${effect.type} stored`, { runId, agentRunId: effect.agentRunId });
          break;
        case 'remove-review-checkout':
          removeReviewCheckout(live, effect.agentRunId);
          break;
        case 'handover-summary':
          // ADR-0024 §3: composed from the records once this transition is committed.
          summaries.schedule(live, { kind: 'handover', note: effect.note });
          break;
        case 'plan-submitted':
        case 'plan-decided':
          // The plan is in the state and stored with it; the board layer publishes the notice.
          logger.log('info', effect.type === 'plan-submitted' ? 'plan submitted' : 'plan decided', {
            runId,
            planId: effect.planId,
          });
          break;
        // ADR-0037 §4: several planners' plan options. The options live with the run until AR-4
        // stores the drafts; the chosen plan is stored like any approved plan (`plan-decided`).
        case 'plan-option-submitted':
          logger.log('info', 'plan option submitted', {
            runId,
            planOptionId: effect.planOptionId,
          });
          break;
        case 'plan-options-ready':
          logger.log('info', 'plan options ready', { runId, count: effect.planOptionIds.length });
          break;
        case 'plan-option-decided':
          logger.log('info', 'plan option decided', {
            runId,
            status: effect.status,
            planId: effect.planId,
            notChosen: effect.notChosen.length,
          });
          break;
        case 'budget-overshoot':
          logger.log('warn', 'agent over budget', {
            runId,
            agentRunId: effect.agentRunId,
            used: effect.used,
            limit: effect.limit,
            overshoot: effect.overshoot,
          });
          break;
        case 'diagnostic':
          counters.diagnostics[effect.code] = (counters.diagnostics[effect.code] ?? 0) + 1;
          logger.log('warn', 'engine diagnostic', {
            runId,
            agentRunId: effect.agentRunId,
            code: effect.code,
          });
          // P-D: the owner reads it on the ticket in plain words (app data only: the role).
          if (effect.code === 'rework-session-replaced') {
            const role = live.state.agents.find((a) => a.id === effect.agentRunId)?.role;
            appComment(live, reworkNewSessionLine(role ?? 'A helper'));
          }
          break;
      }
    }
  }

  function afterTransition(live: LiveRun, prev: RunState): void {
    const status = live.state.run.status;
    if (status === 'CANCELLING' && prev.run.status !== 'CANCELLING') {
      live.cancellingSince = deps.now().getTime();
    }
    if (status === 'CANCELLING') defer(() => maybeCompleteCancellation(live));
    if (status === 'REVIEW' && prev.run.status !== 'REVIEW') {
      defer(() => resolveEmptyReviews(live));
    } else if (status === 'REVIEW') {
      // The tester ends while the run is already in review (ADR-0019): same empty-review rule.
      const pendingBefore = new Set(
        prev.agents.filter((a) => a.review === 'pending').map((a) => a.id),
      );
      if (live.state.agents.some((a) => a.review === 'pending' && !pendingBefore.has(a.id))) {
        defer(() => resolveEmptyReviews(live));
      }
    }
    if (TERMINAL.includes(status) && !TERMINAL.includes(prev.run.status)) {
      removeSkillsPlugin(live.state.run.id);
      removeSandboxTemp(live.state.run.id);
    }
    if (status !== prev.run.status) {
      logger.log('info', 'run status changed', { runId: live.state.run.id, status });
    }
    // ADR-0024 §3: a facts-only summary when a run ends without a handover (or a legacy run
    // reaches review). The handover's own comes from its effect.
    const ended = endTrigger(prev, live.state);
    if (ended !== null) summaries.schedule(live, ended);
    // ADR-0033 §2: messages held for an agent go to it once it can take input again (the engine
    // sends each finish notice itself, ADR-0033 §4).
    mailbox.flush(live);
  }

  function countDiagnostic(code: string): void {
    counters.diagnostics[code] = (counters.diagnostics[code] ?? 0) + 1;
  }

  function maybeCompleteCancellation(live: LiveRun): void {
    if (closed || live.state.run.status !== 'CANCELLING') return;
    if (live.handles.size > 0 || live.starting.size > 0) return;
    apply(live, completeCancellation);
    live.cancellingSince = null;
  }

  /** A helper or tester that never got a worktree has nothing to review: record that, not a fake diff. */
  function resolveEmptyReviews(live: LiveRun): void {
    if (closed || live.state.run.status !== 'REVIEW') return;
    for (const agent of live.state.agents) {
      if (!hasReviewableChange(agent.kind) || agent.review !== 'pending') continue;
      if (live.starting.has(agent.id) || live.workspaces.has(agent.id)) continue;
      if (store.repos.workspaces.getByAgentRun(agent.id) !== undefined) continue;
      apply(live, (s, c) => recordReview(s, agent.id, 'no-changes', c));
    }
  }

  function endWithError(live: LiveRun, agentRunId: string, failure?: ManagedFailureCode): void {
    const finished: ManagedAgentEvent = {
      type: 'finished',
      outcome: 'error',
      reportedCostUsd: null,
      ...(failure !== undefined && { failure }),
    };
    defer(() => {
      apply(live, (s, c) => agentEvent(s, agentRunId, finished, c));
      maybeCompleteCancellation(live);
    });
  }

  /**
   * The agent may still start: the run is open and it was not stopped while its folder, setup or
   * skills were being prepared. Otherwise its queued messages go and a pending cancellation may
   * finish.
   */
  function stillStarting(live: LiveRun, agentRunId: string): boolean {
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    if (!closed && agent?.status === 'STARTING') return true;
    mailbox.discardQueued(live, agentRunId);
    defer(() => maybeCompleteCancellation(live));
    return false;
  }

  /**
   * Where each role starts (ADR-0013 §2, ADR-0019): the lead and the planner read the owner's
   * project in place; the reviewer reads its temporary checkout of the main branch; helpers and
   * the tester work in their own worktree, made from the current main branch.
   */
  function startAgent(live: LiveRun, effect: Extract<EngineEffect, { type: 'start-agent' }>): void {
    const runId = live.state.run.id;
    const agentRunId = effect.agentRunId;
    const project = deps.repos.projects.getById(live.state.run.projectId);
    if (project === undefined) {
      logger.log('warn', 'agent start failed', { runId, agentRunId, code: 'unavailable' });
      endWithError(live, agentRunId);
      return;
    }
    // ADR-0031 §2: before any folder is made, an agent whose provider has no adapter ends.
    if (adapterOf(live, agentRunId) === undefined) {
      refuseNoAdapter(live, agentRunId);
      return;
    }
    const kind = effect.kind;
    const base = {
      agentRunId,
      kind,
      prompt: kind === 'lead' ? withTicketSummary(live, effect.prompt) : effect.prompt,
      model: effect.model,
      effort: effect.effort,
    };
    // ADR-0037 §3: a researcher reads the owner's tree like the planner, with no worktree.
    if (kind === 'lead' || kind === 'planner' || kind === 'researcher') {
      if (
        hooks.agentSetup === undefined &&
        effect.skills === undefined &&
        effect.agent === undefined &&
        ticketAttachments(live).length === 0
      ) {
        launch(live, { ...base, cwd: project.rootPath, setup: NO_SETUP });
        return;
      }
      live.starting.add(agentRunId);
      track(
        (async () => {
          const setup = await setupFor(live);
          const plugin = await pluginFor(live, project.rootPath, effect);
          const agentFile = await agentFileFor(live, project.rootPath, effect);
          // ADR-0026 §4: the lead's and planner's copies are outside the owner's checkout (the
          // run's folder), readable without asking (`readOnlyDirs`).
          const copies = await withAttachments(
            live,
            agentRunId,
            kind,
            project.rootPath,
            project.rootPath,
            base.prompt,
          );
          live.starting.delete(agentRunId);
          if (!stillStarting(live, agentRunId)) return;
          launch(live, {
            ...base,
            prompt: copies.prompt,
            readOnlyDirs: copies.readOnlyDirs,
            cwd: project.rootPath,
            setup,
            plugin,
            agentFile,
          });
        })(),
      );
      return;
    }
    if (kind === 'reviewer') {
      live.starting.add(agentRunId);
      track(
        (async () => {
          const checkout = await (live.reviewCheckouts.get(agentRunId) ?? Promise.resolve(null));
          if (checkout === null) {
            live.starting.delete(agentRunId);
            mailbox.discardQueued(live, agentRunId);
            logger.log('warn', 'agent start failed', { runId, agentRunId, code: 'no-checkout' });
            endWithError(live, agentRunId);
            return;
          }
          const setup = await setupFor(live);
          const plugin = await pluginFor(live, project.rootPath, effect);
          const agentFile = await agentFileFor(live, project.rootPath, effect);
          const brief =
            effect.reviewScope === 'change'
              ? await changeReviewerPrompt(live, agentRunId, effect.prompt)
              : effect.prompt;
          const { prompt } = await withAttachments(
            live,
            agentRunId,
            kind,
            checkout.cwd,
            project.rootPath,
            brief,
          );
          live.starting.delete(agentRunId);
          if (!stillStarting(live, agentRunId)) return;
          launch(live, {
            ...base,
            prompt,
            cwd: checkout.cwd,
            setup,
            plugin,
            agentFile,
            reviewScope: effect.reviewScope,
          });
        })(),
      );
      return;
    }
    const worker = live.state.agents.find((a) => a.id === agentRunId);
    // Depth 2 (ADR-0013 amendment): the engine marks the helper; the server checks the rule again.
    // The tester never starts helpers (ADR-0019).
    const canStartHelpers =
      kind === 'worker' &&
      effect.canStartHelpers === true &&
      worker !== undefined &&
      runLimits(live.state).maxDepth === HARD_MAX_DEPTH &&
      agentDepth(live.state, worker) === 1;
    const prompt = canStartHelpers ? `${effect.prompt}\n\n${PARENT_HELPER_NOTE}` : effect.prompt;

    if (effect.rework !== undefined) {
      reworkAgent(live, effect, project.rootPath);
      return;
    }

    live.starting.add(agentRunId);
    track(
      (async () => {
        let ws: Workspace;
        try {
          let options = fromTicketBranch(live, effect.fromBranch);
          if (effect.resolution !== undefined) {
            // ADR-0030: the operation's pinned tip with its target merged in, conflicts left.
            const prepared = resolution.workspaceOptions(effect.resolution.operationId);
            if (prepared === undefined) {
              throw new WorkspaceError('invalid-workspace', 'The conflict resolution is over');
            }
            options = prepared;
          }
          ws = await deps.workspaces.create(project.rootPath, runId, agentRunId, options);
        } catch (error) {
          live.starting.delete(agentRunId);
          mailbox.discardQueued(live, agentRunId);
          logger.log('warn', 'agent start failed', {
            runId,
            agentRunId,
            code: error instanceof WorkspaceError ? error.code : errorFields(error).errorName,
          });
          endWithError(live, agentRunId);
          return;
        }
        try {
          store.repos.workspaces.insert({
            runId,
            agentRunId,
            worktreePath: ws.path,
            branch: ws.branch,
            baseBranch: ws.baseBranch,
            baseCommit: ws.baseCommit,
          });
        } catch (error) {
          // Without a record the worktree could never be reviewed: remove it and fail the agent.
          logger.log('error', 'workspace record failed', {
            runId,
            agentRunId,
            ...errorFields(error),
          });
          await deps.workspaces.discard(ws).catch(() => undefined);
          live.starting.delete(agentRunId);
          mailbox.discardQueued(live, agentRunId);
          endWithError(live, agentRunId);
          return;
        }
        live.workspaces.set(agentRunId, ws);
        // ADR-0027 §1: the project's setup runs in the new worktree before the agent starts.
        let briefLines: string[] = [];
        if (hooks.setupWorktree !== undefined) {
          const prepared = await hooks
            .setupWorktree({
              runId,
              agentRunId,
              projectId: project.id,
              cwd: ws.cwd,
              commit: ws.baseCommit,
            })
            .catch((error: unknown): WorktreeSetup => {
              logger.log('warn', 'worktree setup failed', {
                runId,
                agentRunId,
                ...errorFields(error),
              });
              return { ok: false, reason: 'The project setup could not run.' };
            });
          if (!prepared.ok) {
            live.starting.delete(agentRunId);
            mailbox.discardQueued(live, agentRunId);
            const role = live.state.agents.find((a) => a.id === agentRunId)?.role ?? 'A helper';
            logger.log('info', 'agent not started: setup did not pass', { runId, agentRunId });
            defer(() => {
              const failure = {
                reason: prepared.reason,
                ...(prepared.outputTail !== undefined && { outputTail: prepared.outputTail }),
              };
              const applied = apply(live, (s, c) => agentSetupFailed(s, agentRunId, failure, c));
              // The ticket says why too (app data: the step's name and how it ended).
              if (applied.ok) appComment(live, `${role} did not start: ${prepared.reason}`);
              maybeCompleteCancellation(live);
            });
            return;
          }
          briefLines = setupBriefLines(prepared);
        }
        const setup = await setupFor(live);
        const plugin = await pluginFor(live, project.rootPath, effect);
        // From the owner's checkout (`project.rootPath`), never the helper's own worktree.
        const agentFile = await agentFileFor(live, project.rootPath, effect);
        const protection = await protectionFor(live, agentRunId, ws);
        const briefed = withBriefLines(prompt, briefLines);
        const withCopies = (
          await withAttachments(live, agentRunId, kind, ws.cwd, project.rootPath, briefed)
        ).prompt;
        live.starting.delete(agentRunId);
        // Stopped while its worktree was being made: the worktree stays for review or discard.
        if (!stillStarting(live, agentRunId)) return;
        if (protection === null) {
          mailbox.discardQueued(live, agentRunId);
          endWithError(live, agentRunId);
          return;
        }
        launch(live, {
          ...base,
          prompt: withCopies,
          cwd: ws.cwd,
          setup,
          plugin,
          agentFile,
          canStartHelpers,
          protection,
          startingPoints: effect.startingPoints,
        });
      })(),
    );
  }

  /** The owner's attachments on the run's ticket (ADR-0026 §4); none for a run without one. */
  function ticketAttachments(live: LiveRun): Attachment[] {
    const ticketId = live.state.run.ticketId;
    return ticketId === null ? [] : store.workspaceRepos.attachments.listForTicket(ticketId);
  }

  /**
   * The run's folder of attachment copies (ADR-0026 §4), or one agent's folder in it: the lead
   * and the planner each get their own.
   */
  function runAttachmentsDir(runId: string, agentRunId?: string): string {
    const all = join(deps.dataDir, 'runs', runId, RUN_ATTACHMENTS_DIR);
    return agentRunId === undefined ? all : join(all, agentRunId);
  }

  /**
   * ADR-0026 §4: places read-only copies of the ticket's attachments for one agent (see
   * `attachments/agent-copies.ts`) and adds their names and paths to its brief. Never inside the
   * owner's checkout. The lead and the planner read the owner's checkout in place, so theirs go
   * in the run's folder (one per agent), which they may read without asking (`readOnlyDirs`). A
   * failure to copy never blocks the start: the brief simply has no attachments.
   */
  async function withAttachments(
    live: LiveRun,
    agentRunId: string,
    kind: RunAgentKind,
    cwd: string,
    projectRoot: string,
    prompt: string,
  ): Promise<{ prompt: string; readOnlyDirs?: string[] }> {
    const list = ticketAttachments(live);
    if (list.length === 0) return { prompt };
    const inRunFolder = kind === 'lead' || kind === 'planner' || kind === 'researcher';
    const dir = inRunFolder
      ? runAttachmentsDir(live.state.run.id, agentRunId)
      : join(cwd, AGENT_ATTACHMENTS_DIR);
    if (isPathInside(projectRoot, dir)) return { prompt };
    try {
      const copies = await placeAgentCopies(attachmentFiles, list, dir, {
        gitignore: !inRunFolder,
      });
      const brief = attachmentsBrief(copies);
      if (brief === '') return { prompt };
      return {
        prompt: `${prompt}\n\n${brief}`,
        ...(inRunFolder && { readOnlyDirs: [dir] }),
      };
    } catch (error) {
      countDiagnostic('attachments-unavailable');
      logger.log('warn', 'attachment copies failed', {
        runId: live.state.run.id,
        kind,
        ...errorFields(error),
      });
      return { prompt };
    }
  }

  /**
   * ADR-0026 §2: a later run's lead starts with the ticket's latest summary from an earlier run,
   * so the summary it hands over covers the whole ticket. Text the lead wrote for the ticket
   * (capped at MAX_TICKET_SUMMARY_CHARS), never conversation.
   */
  function withTicketSummary(live: LiveRun, prompt: string): string {
    const ticketId = live.state.run.ticketId;
    if (ticketId === null) return prompt;
    const earlier = store.workspaceRepos.comments
      .listForTicket(ticketId)
      .filter((c) => c.kind === 'ticket-summary' && c.runId !== live.state.run.id)
      .at(-1);
    if (earlier === undefined) return prompt;
    return `${prompt}\n\n${TICKET_SUMMARY_SO_FAR}\n${earlier.body}`;
  }

  /**
   * ADR-0021: where a worker's or tester's worktree starts: the ticket branch's recorded tip when
   * the engine names it (`start-agent.fromBranch`), else the project's HEAD (legacy runs).
   */
  function fromTicketBranch(
    live: LiveRun,
    branch: string | undefined,
  ): { from?: { branch: string; commit: string } } {
    if (branch === undefined) return {};
    const row = store.loopRepos.ticketBranches.getByRun(live.state.run.id);
    // The engine and the record agree on the name; a mismatch fails the start (never main).
    if (row === undefined || row.branch !== branch || row.state !== 'open') {
      return { from: { branch, commit: '' } };
    }
    return { from: { branch, commit: row.headCommit } };
  }

  /**
   * A rework turn (ADR-0021 §3): the same helper in its own worktree, resuming its session, with
   * the lead's or owner's comments as the prompt. Never with `canStartHelpers`.
   */
  function reworkAgent(
    live: LiveRun,
    effect: Extract<EngineEffect, { type: 'start-agent' }>,
    projectRoot: string,
  ): void {
    const runId = live.state.run.id;
    const agentRunId = effect.agentRunId;
    live.starting.add(agentRunId);
    track(
      (async () => {
        const row = store.repos.workspaces.getByAgentRun(agentRunId);
        let ws: Workspace | undefined;
        try {
          ws =
            row !== undefined && row.state === 'active' ? await workspaceFor(live, row) : undefined;
        } catch (error) {
          logger.log('warn', 'rework workspace unavailable', {
            runId,
            agentRunId,
            ...errorFields(error),
          });
        }
        if (ws === undefined) {
          live.starting.delete(agentRunId);
          mailbox.discardQueued(live, agentRunId);
          logger.log('warn', 'agent start failed', { runId, agentRunId, code: 'no-worktree' });
          endWithError(live, agentRunId);
          return;
        }
        const setup = await setupFor(live);
        const plugin = await pluginFor(live, projectRoot, effect);
        const agentFile = await agentFileFor(live, projectRoot, effect);
        const protection = await protectionFor(live, agentRunId, ws);
        const { prompt } = await withAttachments(
          live,
          agentRunId,
          effect.kind,
          ws.cwd,
          projectRoot,
          effect.prompt,
        );
        live.starting.delete(agentRunId);
        if (!stillStarting(live, agentRunId)) return;
        if (protection === null) {
          mailbox.discardQueued(live, agentRunId);
          endWithError(live, agentRunId);
          return;
        }
        launch(live, {
          agentRunId,
          kind: effect.kind,
          prompt,
          model: effect.model,
          effort: effect.effort,
          cwd: ws.cwd,
          setup,
          plugin,
          agentFile,
          rework: effect.rework,
          protection,
          startingPoints: effect.startingPoints,
        });
      })(),
    );
  }

  /**
   * A change reviewer's brief plus the change as a diff against the ticket branch, at most
   * 64 KiB (ADR-0021 §3). Sent to the agent, never stored or logged.
   */
  async function changeReviewerPrompt(
    live: LiveRun,
    reviewerId: string,
    brief: string,
  ): Promise<string> {
    const helperId = live.state.agents.find((a) => a.id === reviewerId)?.reviewsAgentRunId;
    if (helperId === undefined) return brief;
    const change = await loop.changeDiff(live, helperId, REVIEWER_DIFF_MAX_BYTES);
    if (change === null || change.diff.trim() === '') {
      return `${brief}\n\nNo diff could be read for this change; read the files in your folder.`;
    }
    const cut = change.truncated ? ' (cut at 64 KiB; read the rest in your folder)' : '';
    return `${brief}\n\nThe change, as a diff against the ticket branch${cut}:\n\n${change.diff}`;
  }

  /**
   * The run's skills plugin for this agent (ADR-0019 §4), copied from the project's checkout.
   * Never rejects: a skill that cannot be copied is left out and counted, and the agent starts
   * without it.
   */
  async function pluginFor(
    live: LiveRun,
    projectRoot: string,
    effect: Extract<EngineEffect, { type: 'start-agent' }>,
  ): Promise<{ path: string; skills: readonly string[] } | undefined> {
    const wanted = effect.skills ?? [];
    if (wanted.length === 0) return undefined;
    const runId = live.state.run.id;
    try {
      const built = await skillsPlugins.build({ runId, projectRoot, skills: wanted });
      if (built.refused.length > 0) {
        counters.diagnostics['skill-unavailable'] =
          (counters.diagnostics['skill-unavailable'] ?? 0) + built.refused.length;
        logger.log('warn', 'project skill unavailable', {
          runId,
          agentRunId: effect.agentRunId,
          count: built.refused.length,
        });
      }
      if (built.skills.length === 0) return undefined;
      return { path: built.path, skills: built.skills.map(pluginSkillName) };
    } catch (error) {
      countDiagnostic('skills-plugin-failed');
      logger.log('warn', 'skills plugin failed', {
        runId,
        agentRunId: effect.agentRunId,
        ...errorFields(error),
      });
      return undefined;
    }
  }

  /**
   * The stage's project agent file for this agent (ADR-0019 §6), read from the owner's project
   * checkout. Never rejects: a missing, unsafe, oversize or unparsable file is counted and logged
   * by reason (never its contents), and the agent starts without a profile.
   */
  async function agentFileFor(
    live: LiveRun,
    projectRoot: string,
    effect: { agentRunId: string; agent?: string },
  ): Promise<{ profile: AgentProfile; model: string | null } | undefined> {
    const name = effect.agent;
    if (name === undefined) return undefined;
    const runId = live.state.run.id;
    try {
      const read = await agentProfiles.read(projectRoot, name);
      if (read.ok) return { profile: read.profile, model: read.model };
      countDiagnostic('agent-file-unavailable');
      logger.log('warn', 'project agent file unavailable', {
        runId,
        agentRunId: effect.agentRunId,
        // A slug (`SkillNameSchema`) from the owner's workflow, not free text.
        agentFile: name,
        problem: read.problem,
      });
      return undefined;
    } catch (error) {
      countDiagnostic('agent-file-unavailable');
      logger.log('warn', 'project agent file unavailable', {
        runId,
        agentRunId: effect.agentRunId,
        problem: 'unreadable',
        ...errorFields(error),
      });
      return undefined;
    }
  }

  /** What the engine needs to know about a run's follow-up chat (ADR-0020). */
  function followUpFacts(live: LiveRun): FollowUpFacts {
    const lead = live.state.agents.find((a) => a.kind === 'lead');
    const link =
      lead === undefined
        ? undefined
        : store.repos.agentRunSessions
            .listForAgentRun(lead.id)
            // ADR-0031 §7: only a session of the lead's own provider can be resumed.
            .find((l) => l.provider === lead.provider && l.relation === 'primary');
    return {
      // ADR-0031 §7: a follow-up runs only on the lead's own provider.
      managed: deps.enabled && lead !== undefined && deps.adapters.has(lead.provider),
      leadSessionId: link?.providerSessionId ?? null,
      leadProcessActive:
        lead !== undefined && (live.handles.has(lead.id) || live.starting.has(lead.id)),
    };
  }

  function hasFollowUpTurn(live: LiveRun): boolean {
    return (live.state.followUp?.turn ?? null) !== null;
  }

  /** Ends the turn under way when it could not start at all: not a gone session. */
  function endFollowUp(live: LiveRun): void {
    const finished: ManagedAgentEvent = {
      type: 'finished',
      outcome: 'cancelled',
      reportedCostUsd: null,
    };
    defer(() => {
      if (hasFollowUpTurn(live)) apply(live, (s, c) => followUpEvent(s, finished, c));
    });
  }

  /**
   * `start-follow-up` (ADR-0020): resumes the ended lead's saved session in the project root, where
   * the lead ran, with the lead's project context and stage agent file (whose tools only narrow
   * further), answers-only. No lead tools and no skills: the adapter gives it no control-plane
   * tool at all.
   */
  function startFollowUp(
    live: LiveRun,
    effect: Extract<EngineEffect, { type: 'start-follow-up' }>,
  ): void {
    const runId = live.state.run.id;
    const project = deps.repos.projects.getById(live.state.run.projectId);
    // ADR-0031 §7: the lead's own provider resumes its session; never another one.
    const adapter = deps.adapters.get(effect.provider);
    if (project === undefined || adapter === undefined) {
      logger.log('warn', 'follow-up start failed', {
        runId,
        code: adapter === undefined ? 'provider-unavailable' : 'unavailable',
        provider: effect.provider,
      });
      endFollowUp(live);
      return;
    }
    track(
      (async () => {
        const available = await checkAvailability(adapter);
        if (!available.ok) {
          logger.log('warn', 'follow-up start failed', {
            runId,
            code: 'provider-unavailable',
            provider: effect.provider,
          });
          endFollowUp(live);
          return;
        }
        const setup = await setupFor(live);
        const agentFile = await agentFileFor(live, project.rootPath, effect);
        // CX-3b: the follow-up turn is denied the same reads as the lead's own turns.
        const denied = adapter.capabilities.denyRead ? await loadDenyReadList() : null;
        const turn = live.state.followUp?.turn ?? null;
        if (closed || turn === null) return;
        if (turn.aborting) {
          endFollowUp(live);
          return;
        }
        // ADR-0033 §2: what was held for the ended lead comes with this turn, oldest first.
        const held = mailbox.takeHeld(live, effect.agentRunId);
        const spec: ManagedAgentSpec = {
          agentRunId: effect.agentRunId,
          kind: 'lead',
          cwd: project.rootPath,
          prompt: held.length === 0 ? effect.prompt : `${heldBlock(held)}\n\n${effect.prompt}`,
          model: resolveAgentModel({
            stage: effect.model,
            agentFile: agentFile?.model,
            project: setup.model,
            provider: effect.provider,
          }),
          followUp: { resumeSessionId: effect.resumeSessionId },
        };
        if (setup.context.trim() !== '') spec.context = setup.context;
        const repoMap = repoMapFor(live);
        if (repoMap !== undefined) spec.repoMap = repoMap;
        // ADR-0034 §4: a follow-up turn's one control-plane tool is the read-only code map; the
        // handler refuses anything else, whatever the adapter offers.
        // Only for a provider that can offer tools (else the turn would be refused for it).
        const leadId = effect.agentRunId;
        if (adapter.capabilities.leadTools) {
          spec.leadTools = (name, toolInput) =>
            name === 'code_map'
              ? leadTool(live, leadId, name, toolInput)
              : Promise.reject(new Error(FOLLOW_UP_READ_ONLY_MESSAGE));
        }
        // ADR-0028 §1: the lead node's effort, as for its own turns.
        if (effect.effort !== undefined) spec.effort = effect.effort;
        if (agentFile !== undefined) spec.profile = agentFile.profile;
        if (denied === undefined) {
          logger.log('warn', 'follow-up start failed', { runId, code: 'deny-read' });
          endFollowUp(live);
          return;
        }
        if (denied !== null) spec.denyRead = [...denied];
        const refusal = capabilityRefusal(spec, adapter.capabilities, effect.provider);
        if (refusal !== null) {
          countDiagnostic(`capability-refused-${refusal.code}`);
          logger.log('warn', 'follow-up start failed', { runId, code: refusal.code });
          endFollowUp(live);
          return;
        }
        let handle: ManagedAgentHandle;
        try {
          handle = adapter.start(spec, {
            requestPermission: () => {
              countDiagnostic('follow-up-tool-denied');
              logger.log('info', 'follow-up tool use denied', { runId });
              return Promise.resolve({ allow: false, message: FOLLOW_UP_READ_ONLY_MESSAGE });
            },
          });
        } catch (error) {
          logger.log('warn', 'follow-up start failed', { runId, ...errorFields(error) });
          endFollowUp(live);
          return;
        }
        live.followUp = handle;
        logger.log('info', 'follow-up turn started', { runId, agentRunId: effect.agentRunId });
        const usage = { provider: effect.provider, cwd: spec.cwd, model: spec.model };
        const pumping = pumpFollowUp(live, handle, usage).catch((error: unknown) => {
          logger.log('error', 'follow-up pump failed', errorFields(error));
        });
        pumps.add(pumping);
        void pumping.finally(() => pumps.delete(pumping));
      })(),
    );
  }

  /**
   * The follow-up turn's events go to the engine's follow-up command, never to `agentEvent`: the
   * lead's agent record stays as it ended. A stream that ends without `finished` (or throws) ended
   * in an error, which before any answer means the resume failed (the session is gone).
   */
  async function pumpFollowUp(
    live: LiveRun,
    handle: ManagedAgentHandle,
    usage: UsageSource,
  ): Promise<void> {
    const runId = live.state.run.id;
    const record = usageRecorder(runId, usage);
    try {
      for await (const event of handle.events) {
        if (closed) break;
        record(event);
        const result = apply(live, (s, c) => followUpEvent(s, event, c));
        if (!result.ok) {
          logger.log('warn', 'follow-up event refused', { runId, code: result.refusal.code });
        }
      }
    } catch (error) {
      logger.log('warn', 'follow-up stream failed', { runId, ...errorFields(error) });
    }
    if (live.followUp === handle) live.followUp = undefined;
    if (closed) return;
    if (hasFollowUpTurn(live)) {
      apply(live, (s, c) =>
        followUpEvent(s, { type: 'finished', outcome: 'error', reportedCostUsd: null }, c),
      );
    }
    logger.log('info', 'follow-up turn ended', {
      runId,
      sessionGone: live.state.followUp?.sessionGone === true,
    });
  }

  /** ADR-0022: the run's sandbox temp folder goes when the run ends. */
  function removeSandboxTemp(runId: string): void {
    track(
      fullAutoPaths.remove(runId).catch((error: unknown) => {
        logger.log('warn', 'sandbox temp folder removal failed', { runId, ...errorFields(error) });
      }),
    );
  }

  /**
   * ADR-0022, ADR-0023 §5: how a helper or tester is protected (`agentLaunchMode`): auto mode plus
   * the OS sandbox when its block runs Full auto in this run; the sandbox alone, in `default`,
   * when its block is configured as Full auto but a ticket or run tightened it. Undefined when
   * neither applies. Null when the sandbox paths could not be prepared: the agent then fails,
   * never unprotected.
   */
  async function protectionFor(
    live: LiveRun,
    agentRunId: string,
    ws: Workspace,
  ): Promise<AgentProtection | null | undefined> {
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    if (agent === undefined || !hasReviewableChange(agent.kind)) return undefined;
    const launch = agentLaunchMode(live.state, agent);
    if (!launch.sandbox) return undefined;
    try {
      const paths = await fullAutoPaths.specFor(live.state.run.id);
      // F-1: the repository's git folders stay unwritable for the sandboxed helper; without
      // them the helper does not start (fail closed), as without its temp folder.
      const gitDirs = await deps.workspaces.gitDirs(ws);
      return { autoMode: launch.autoMode, paths: { ...paths, gitDirs } };
    } catch (error) {
      countDiagnostic('full-auto-unavailable');
      logger.log('warn', 'full auto sandbox folder failed', {
        runId: live.state.run.id,
        agentRunId,
        ...errorFields(error),
      });
      return null;
    }
  }

  function removeSkillsPlugin(runId: string): void {
    track(
      // ADR-0026 §4: the lead's and planner's copies go with the run's other temporary files.
      rm(runAttachmentsDir(runId), { recursive: true, force: true })
        .then(() => skillsPlugins.remove(runId))
        .catch((error: unknown) => {
          logger.log('warn', 'skills plugin removal failed', { runId, ...errorFields(error) });
        }),
    );
  }

  /**
   * `create-review-checkout`: the reviewer's `start-agent`, which follows, waits for it. ADR-0021:
   * a change reviewer reads the sealed commit (`commit`), the final reviewer the ticket branch's
   * recorded tip (`ticketBranch`); neither, the project's HEAD (legacy runs).
   */
  function createReviewCheckout(
    live: LiveRun,
    effect: Extract<EngineEffect, { type: 'create-review-checkout' }>,
  ): void {
    const agentRunId = effect.agentRunId;
    const runId = live.state.run.id;
    const projectId = live.state.run.projectId;
    const project = deps.repos.projects.getById(projectId);
    let commit = effect.commit;
    if (commit === undefined && effect.ticketBranch !== undefined) {
      const row = store.loopRepos.ticketBranches.getByRun(runId);
      // Never fall back to main: a final review of the wrong code is worse than none.
      commit = row?.branch === effect.ticketBranch ? row.headCommit : 'missing';
    }
    const made: Promise<ReviewCheckout | null> =
      project === undefined
        ? Promise.resolve(null)
        : reviewCheckouts.create(project.rootPath, runId, agentRunId, commit).then(
            (checkout) => {
              activeCheckouts.set(agentRunId, { projectId, checkout });
              logger.log('info', 'review checkout created', { runId, agentRunId });
              return checkout;
            },
            (error: unknown) => {
              logger.log('warn', 'review checkout failed', {
                runId,
                agentRunId,
                code: error instanceof WorkspaceError ? error.code : errorFields(error).errorName,
              });
              return null;
            },
          );
    live.reviewCheckouts.set(agentRunId, made);
    track(made);
  }

  /** `remove-review-checkout`: after the reviewer's abort; waits for a checkout still being made. */
  function removeReviewCheckout(live: LiveRun, agentRunId: string): void {
    const runId = live.state.run.id;
    const made = live.reviewCheckouts.get(agentRunId);
    live.reviewCheckouts.delete(agentRunId);
    // Not made by this process (a restart): `start` removes every leftover checkout.
    if (made === undefined) return;
    track(
      (async () => {
        const checkout = await made;
        activeCheckouts.delete(agentRunId);
        if (checkout === null) return;
        try {
          await reviewCheckouts.remove(checkout);
          logger.log('info', 'review checkout removed', { runId, agentRunId });
        } catch (error) {
          logger.log('warn', 'review checkout removal failed', {
            runId,
            agentRunId,
            ...errorFields(error),
          });
        }
      })(),
    );
  }

  /**
   * ADR-0034 (CM-2): builds the map of the run's base commit in the background. A failure is a
   * diagnostic count and a log line with a short code, never a run failure.
   */
  function startCodeMap(live: LiveRun): void {
    const source = deps.codeMap;
    if (source === undefined) return;
    const runId = live.state.run.id;
    live.codeMap = startRunCodeMap({
      source,
      projectId: live.state.run.projectId,
      baseCommit: () => runBaseCommit(live),
      waitMs: deps.codeMapWaitMs ?? CODE_MAP_WAIT_MS,
      onFailure: (code) => {
        countDiagnostic('code-map-unavailable');
        logger.log('warn', 'run code map not built', { runId, code });
      },
    });
  }

  /**
   * The commit the run's ticket branch starts at: the recorded one once it exists, else where it
   * would start now (`checkTicketBranchPlan`), else the project's HEAD. Null when none resolves.
   */
  async function runBaseCommit(live: LiveRun): Promise<string | null> {
    const recorded = store.loopRepos.ticketBranches.getByRun(live.state.run.id);
    if (recorded !== undefined) return recorded.baseCommit;
    const project = deps.repos.projects.getById(live.state.run.projectId);
    if (project === undefined) return null;
    const key = ticketKeyOf(live.state);
    if (key !== null) {
      try {
        const plan = loop.planFor(live, key);
        return (await deps.workspaces.checkTicketBranchPlan(project.rootPath, plan)).commit;
      } catch {
        // A plan the manager refuses now is refused again at plan approval; the map uses HEAD.
      }
    }
    try {
      const head = await deps.git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
        cwd: project.rootPath,
      });
      const commit = head.stdout.trim();
      return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit) ? commit : null;
    } catch {
      return null;
    }
  }

  /** The commit whose map the run's agents use: the one built at run start, else the record's. */
  function runMapCommit(live: LiveRun): string | null {
    return (
      live.codeMap?.commit ??
      store.loopRepos.ticketBranches.getByRun(live.state.run.id)?.baseCommit ??
      null
    );
  }

  /** The repository map for an agent's context, when the run's map is ready. Never throws. */
  function repoMapFor(live: LiveRun): string | undefined {
    const source = deps.codeMap;
    if (source === undefined) return undefined;
    try {
      return repoMapText(source, live.state.run.projectId, runMapCommit(live), live);
    } catch (error) {
      countDiagnostic('code-map-unavailable');
      logger.log('warn', 'repository map unavailable', {
        runId: live.state.run.id,
        ...errorFields(error),
      });
      return undefined;
    }
  }

  /**
   * ADR-0034 §4 (CM-3): the prompt with the helper's starting points, rendered from the map of
   * the run's base commit (paths, names and counts; never file content). Without a ready map,
   * only the notes and the paths. Never throws: a failure leaves the plain paths.
   */
  function withStartingPoints(
    live: LiveRun,
    prompt: string,
    points: StartingPoints | undefined,
  ): string {
    if (points === undefined || isEmptyStartingPoints(points)) return prompt;
    let map: ReturnType<RunCodeMapSource['mapAt']>;
    const source = deps.codeMap;
    const commit = runMapCommit(live);
    if (source !== undefined && commit !== null) {
      try {
        map = source.mapAt(live.state.run.projectId, commit);
      } catch (error) {
        countDiagnostic('code-map-unavailable');
        logger.log('warn', 'starting points map unavailable', {
          runId: live.state.run.id,
          ...errorFields(error),
        });
      }
    }
    const section = renderStartingPoints(points, map);
    return section === '' ? prompt : `${prompt}\n\n${section}`;
  }

  /** ADR-0034 §4: the `code_map` answer, or a thrown refusal the adapter returns to the model. */
  function codeMapReply(live: LiveRun, input: unknown): string {
    const source = deps.codeMap;
    const commit = runMapCommit(live);
    if (source === undefined) return codeMapToolReply(NO_MAP_SOURCE, '', null, input);
    return codeMapToolReply(source, live.state.run.projectId, commit, input);
  }

  /** Read once per run, so every agent of the run gets the same context. Never rejects. */
  function setupFor(live: LiveRun): Promise<AgentSetup> {
    const read = hooks.agentSetup;
    if (read === undefined) return Promise.resolve(NO_SETUP);
    live.setup ??= read(live.state.run.projectId).catch((error: unknown) => {
      // Context helps the agents but is not required: they start without it, and it is counted.
      countDiagnostic('context-unavailable');
      logger.log('warn', 'agent context unavailable', {
        runId: live.state.run.id,
        ...errorFields(error),
      });
      return NO_SETUP;
    });
    return live.setup;
  }

  /** The run's ticket key (`WEB-12`), or null for a run without a ticket. */
  function ticketKeyOf(state: RunState): string | null {
    if (state.integration !== undefined) return state.integration.ticketKey;
    const ticketId = state.run.ticketId;
    if (ticketId === null) return null;
    return store.workspaceRepos.tickets.getById(ticketId)?.key ?? null;
  }

  /** ADR-0024 §1: the session title of an agent the app starts. */
  function sessionTitle(live: LiveRun, agentRunId: string): string | undefined {
    try {
      return agentName({ state: live.state, agentRunId, ticketKey: ticketKeyOf(live.state) })
        ?.title;
    } catch (error) {
      // A name is never worth a failed start: Claude Code titles the session as before.
      logger.log('warn', 'session title unavailable', {
        runId: live.state.run.id,
        agentRunId,
        ...errorFields(error),
      });
      return undefined;
    }
  }

  /** The agent's provider (`EngineAgent.provider`, fixed when it was created). */
  function providerOf(live: LiveRun, agentRunId: string): ManagedProviderId {
    return live.state.agents.find((a) => a.id === agentRunId)?.provider ?? 'claude-code';
  }

  /**
   * ADR-0031 §2: the adapter of the agent's own provider, or undefined when the server has none.
   * Never another provider's: the run would record one provider while a different one did the work.
   */
  function adapterOf(live: LiveRun, agentRunId: string): ManagedExecutionAdapter | undefined {
    return deps.adapters.get(providerOf(live, agentRunId));
  }

  function roleOf(live: LiveRun, agentRunId: string): string {
    return live.state.agents.find((a) => a.id === agentRunId)?.role ?? 'An agent';
  }

  /** An agent whose provider has no adapter in this server ends with `provider-unavailable`. */
  function refuseNoAdapter(live: LiveRun, agentRunId: string): void {
    const provider = providerOf(live, agentRunId);
    mailbox.discardQueued(live, agentRunId);
    countDiagnostic('provider-unavailable');
    logger.log('warn', 'agent provider has no adapter', {
      runId: live.state.run.id,
      agentRunId,
      provider,
    });
    endWithError(live, agentRunId, 'provider-unavailable');
    appComment(
      live,
      `${roleOf(live, agentRunId)} did not start: ${MANAGED_PROVIDER_NAMES[provider]} is not set up on this server.`,
    );
  }

  /**
   * CX-4: the agent ends without running (`failure`), and the ticket says why in one line of app
   * copy (the adapter's fixed availability sentence, or a capability refusal's line).
   */
  function refuseStart(
    live: LiveRun,
    agentRunId: string,
    failure: ManagedFailureCode,
    code: string,
    line: string,
  ): void {
    mailbox.discardQueued(live, agentRunId);
    logger.log('warn', 'agent start failed', { runId: live.state.run.id, agentRunId, code });
    endWithError(live, agentRunId, failure);
    appComment(live, `${roleOf(live, agentRunId)} did not start: ${line}`);
  }

  /**
   * CX-4: the cached availability of a provider when it may be used without asking the adapter:
   * always for an adapter without `checkAvailable`; an `ok` for the server's lifetime; a failure
   * for `AVAILABILITY_RECHECK_MS`. Undefined: ask (`checkAvailability`).
   */
  function cachedAvailability(adapter: ManagedExecutionAdapter): Availability | undefined {
    if (adapter.checkAvailable === undefined) return { ok: true };
    const cached = availability.get(adapter.provider);
    if (cached === undefined) return undefined;
    if (cached.result.ok) return cached.result;
    const age = deps.now().getTime() - cached.checkedAt.getTime();
    return age < AVAILABILITY_RECHECK_MS ? cached.result : undefined;
  }

  /** CX-4: the provider's availability, asking the adapter when the cache cannot answer. */
  function checkAvailability(adapter: ManagedExecutionAdapter): Promise<Availability> {
    const cached = cachedAvailability(adapter);
    if (cached !== undefined) return Promise.resolve(cached);
    const provider = adapter.provider;
    const running = availabilityChecks.get(provider);
    if (running !== undefined) return running;
    const check = (async (): Promise<Availability> => {
      let result: Availability;
      try {
        result = (await adapter.checkAvailable?.()) ?? { ok: true };
      } catch (error) {
        logger.log('warn', 'managed provider check failed', { provider, ...errorFields(error) });
        result = { ok: false, reason: AVAILABILITY_CHECK_FAILED };
      }
      availability.set(provider, { result, checkedAt: deps.now() });
      // The provider id only: never the reason's text or anything about the account.
      if (result.ok) logger.log('info', 'managed provider available', { provider });
      else {
        countDiagnostic('provider-unavailable');
        logger.log('warn', 'managed provider unavailable', { provider });
      }
      return result;
    })().finally(() => availabilityChecks.delete(provider));
    availabilityChecks.set(provider, check);
    return check;
  }

  /**
   * Starts the agent once its provider is known to be available (CX-4): at once when the cache
   * says so, else after the check, holding its messages meanwhile (`starting`). An unavailable
   * provider ends the agent with `provider-unavailable` and the adapter's reason on the ticket.
   */
  function launch(live: LiveRun, input: LaunchInput): void {
    // ADR-0034 (CM-2): while the run's map is being built, a launch waits for it at most until
    // the run's wait window ends (15 s after the run started); then it goes on without it.
    const waiting = live.codeMap?.waiting ?? null;
    if (waiting === null) {
      launchAvailable(live, input);
      return;
    }
    const { agentRunId } = input;
    live.starting.add(agentRunId);
    track(
      waiting.then(() => {
        live.starting.delete(agentRunId);
        if (!stillStarting(live, agentRunId)) return;
        launchAvailable(live, input);
      }),
    );
  }

  function launchAvailable(live: LiveRun, input: LaunchInput): void {
    const { agentRunId } = input;
    const adapter = adapterOf(live, agentRunId);
    if (adapter === undefined) {
      refuseNoAdapter(live, agentRunId);
      return;
    }
    const refuse = (reason: string) =>
      refuseStart(live, agentRunId, 'provider-unavailable', 'provider-unavailable', reason);
    const cached = cachedAvailability(adapter);
    // CX-3b: an adapter that denies reads for every agent waits for the deny list once.
    const waitsForDenyList = adapter.capabilities.denyRead && denyReadList === undefined;
    if (cached !== undefined && (!cached.ok || !waitsForDenyList)) {
      if (cached.ok) launchOn(live, input, adapter);
      else refuse(cached.reason);
      return;
    }
    live.starting.add(agentRunId);
    track(
      (async () => {
        const result = cached ?? (await checkAvailability(adapter));
        if (result.ok && adapter.capabilities.denyRead) await loadDenyReadList();
        live.starting.delete(agentRunId);
        if (!stillStarting(live, agentRunId)) return;
        if (result.ok) launchOn(live, input, adapter);
        else refuse(result.reason);
      })(),
    );
  }

  /**
   * CX-3b: the deny-read list every agent of a `denyRead` adapter gets (`spec.denyRead`), the same
   * list Full auto uses (`fullAutoDenyRead`). Loaded once; a failure leaves it unset, so the agent
   * is refused (`launchOn`) and the next start tries again.
   */
  let denyReadList: readonly string[] | undefined;
  async function loadDenyReadList(): Promise<readonly string[] | undefined> {
    if (denyReadList !== undefined) return denyReadList;
    try {
      denyReadList = await fullAutoPaths.denyRead();
    } catch (error) {
      countDiagnostic('deny-read-unavailable');
      logger.log('warn', 'deny-read list failed', errorFields(error));
    }
    return denyReadList;
  }

  function launchOn(live: LiveRun, input: LaunchInput, adapter: ManagedExecutionAdapter): void {
    const runId = live.state.run.id;
    const { agentRunId, kind, setup } = input;
    const canStartHelpers = input.canStartHelpers === true;
    const provider = adapter.provider;
    const spec: ManagedAgentSpec = {
      agentRunId,
      kind,
      cwd: input.cwd,
      prompt: withStartingPoints(live, input.prompt, input.startingPoints),
      // ADR-0019 §6: the stage's model, else the agent file's, else the project's (Phase 4); an
      // inherited model of another provider is skipped (ADR-0031).
      model: resolveAgentModel({
        stage: input.model,
        agentFile: input.agentFile?.model,
        project: setup.model,
        provider,
      }),
    };
    if (setup.context.trim() !== '') spec.context = setup.context;
    const repoMap = repoMapFor(live);
    if (repoMap !== undefined) spec.repoMap = repoMap;
    // ADR-0028 §1: only when the node sets one (absent: the model's default).
    if (input.effort !== undefined) spec.effort = input.effort;
    // ADR-0024 §1: named when it starts, from app data only (ticket key and block label).
    const title = sessionTitle(live, agentRunId);
    if (title !== undefined) spec.title = title;
    // Every role has control tools: since ADR-0033 §3 every helper, the tester and every reviewer
    // can `ask_lead`, besides a ticket run's `report_work` (ADR-0026 §3). A refusal rejects the
    // promise; the adapter returns it to the model as a tool error. The engine scopes each caller's
    // calls (`leadToolCall`, `controlToolsFor`): a parent helper's to its own children, the
    // planner's to submit_plan, the reviewer's to post_review (and ask_lead), a helper's or
    // tester's to report_work and ask_lead (report_work only in a ticket run).
    spec.leadTools = (name, input) => leadTool(live, agentRunId, name, input);
    // A rework turn never starts helpers (ADR-0021 §3).
    if (kind === 'worker' && canStartHelpers && input.rework === undefined) {
      spec.canStartHelpers = true;
    }
    if (input.rework !== undefined) spec.rework = { ...input.rework };
    if (input.reviewScope !== undefined) spec.reviewScope = input.reviewScope;
    if (input.readOnlyDirs !== undefined) spec.readOnlyDirs = input.readOnlyDirs;
    if (input.plugin !== undefined) spec.skillPlugin = input.plugin;
    if (input.agentFile !== undefined) spec.profile = input.agentFile.profile;
    // ADR-0022, ADR-0023 §5: only helpers and the tester are protected; the adapter ignores it
    // for others. Full auto (auto mode plus the sandbox) or the sandbox alone, never both.
    const protection = input.protection;
    if (protection !== undefined && hasReviewableChange(kind)) {
      const paths: FullAutoSpec = {
        tempDir: protection.paths.tempDir,
        denyRead: [...protection.paths.denyRead],
        // F-1: the worktree's git folders, which sandboxed commands may not write.
        ...(protection.paths.gitDirs !== undefined && {
          gitDirs: [...protection.paths.gitDirs],
        }),
      };
      if (protection.autoMode) spec.fullAuto = paths;
      else spec.sandbox = paths;
    }
    // CX-3: the approval mode the gate decides by (`agentModeOf`, already tightened), for an
    // adapter whose provider enforces it itself (Codex).
    if (hasReviewableChange(kind)) {
      const mode = agentModeOf(live, agentRunId);
      if (mode !== undefined) spec.approvalMode = mode;
    }
    // CX-3b: a provider that can deny reads denies the Full auto list to every agent, whatever
    // its role or mode. Without the list the agent does not start (ADR-0022 fail closed).
    if (adapter.capabilities.denyRead) {
      if (denyReadList === undefined) {
        countDiagnostic('capability-refused-deny-read');
        refuseStart(
          live,
          agentRunId,
          'sandbox-unavailable',
          'deny-read',
          DENY_READ_UNAVAILABLE_LINE,
        );
        return;
      }
      spec.denyRead = [...denyReadList];
    }
    // ADR-0031 §5: refuse what the provider cannot hold; strip only what merely helps.
    const refusal: CapabilityRefusal | null = capabilityRefusal(
      spec,
      adapter.capabilities,
      provider,
    );
    if (refusal !== null) {
      countDiagnostic(`capability-refused-${refusal.code}`);
      refuseStart(live, agentRunId, refusal.failure, refusal.code, refusal.line);
      return;
    }
    if (dropsSkills(spec, adapter.capabilities)) {
      delete spec.skillPlugin;
      countDiagnostic('skills-not-loaded');
      logger.log('info', 'project skills not loaded', { runId, agentRunId, provider });
      // Once per agent run: a rework turn of the same helper says nothing new.
      if (input.rework === undefined)
        appComment(live, skillsIgnoredLine(roleOf(live, agentRunId), provider));
    }
    let handle: ManagedAgentHandle;
    try {
      handle = adapter.start(spec, {
        requestPermission: (request) => askOwner(live, agentRunId, kind, request),
      });
    } catch (error) {
      logger.log('warn', 'agent start failed', { runId, agentRunId, ...errorFields(error) });
      endWithError(live, agentRunId);
      return;
    }
    live.handles.set(agentRunId, handle);
    logger.log('info', 'agent started', { runId, agentRunId, kind });
    mailbox.started(live, agentRunId);
    const usage = { provider, cwd: spec.cwd, model: spec.model };
    const pumping = pump(live, agentRunId, handle, usage).catch((error: unknown) => {
      logger.log('error', 'agent pump failed', errorFields(error));
    });
    pumps.add(pumping);
    void pumping.finally(() => pumps.delete(pumping));
  }

  /**
   * ADR-0032 §5: for a provider whose usage ACP does not read from files (Codex), records the
   * agent's session (on `started`) and each `usage` event through the ingestion pipeline. Never
   * throws: a failed write is counted and logged, and the run goes on (its budget still counts
   * the usage).
   */
  function usageRecorder(runId: string, source: UsageSource): (event: ManagedAgentEvent) => void {
    const ingest = deps.ingestManaged;
    if (ingest === undefined || !SELF_RECORDED_USAGE.has(source.provider)) return () => undefined;
    let sessionId: string | null = null;
    let model = source.model;
    return (event) => {
      if (event.type !== 'started' && event.type !== 'usage') return;
      const observedAt = deps.now().toISOString();
      let events: NormalizedEvent[];
      if (event.type === 'started') {
        sessionId = event.providerSessionId;
        model = event.model ?? model;
        events = managedSessionEvents({
          provider: source.provider,
          providerSessionId: sessionId,
          observedAt,
          cwd: source.cwd,
          model,
        });
      } else {
        if (sessionId === null) {
          countDiagnostic('managed-usage-without-session');
          return;
        }
        events = [
          managedUsageEvent({
            provider: source.provider,
            providerSessionId: sessionId,
            observedAt,
            messageId: event.messageId,
            model,
            tokens: event.tokens,
          }),
        ];
      }
      try {
        ingest(events);
      } catch (error) {
        countDiagnostic('managed-usage-not-recorded');
        logger.log('error', 'managed usage not recorded', { runId, ...errorFields(error) });
      }
    };
  }

  async function pump(
    live: LiveRun,
    agentRunId: string,
    handle: ManagedAgentHandle,
    usage: UsageSource,
  ) {
    const runId = live.state.run.id;
    const record = usageRecorder(runId, usage);
    try {
      for await (const event of handle.events) {
        if (closed) break;
        record(event);
        const result = apply(live, (s, c) => agentEvent(s, agentRunId, event, c));
        if (!result.ok) {
          logger.log('warn', 'agent event refused', {
            runId,
            agentRunId,
            code: result.refusal.code,
          });
        }
        if (event.type === 'finished') warnOnCost(live, event.reportedCostUsd);
      }
    } catch (error) {
      logger.log('warn', 'agent stream failed', { runId, agentRunId, ...errorFields(error) });
    }
    // A rework turn's new process may already hold the slot; only drop this one.
    if (live.handles.get(agentRunId) === handle) live.handles.delete(agentRunId);
    if (closed) return;
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    // ADR-0021: AWAITING_REVIEW is live but has no process: its turn already ended.
    if (agent !== undefined && isActiveAgentStatus(agent.status) && !live.handles.has(agentRunId)) {
      // The stream ended without a `finished` event: the agent is gone either way.
      apply(live, (s, c) =>
        agentEvent(s, agentRunId, { type: 'finished', outcome: 'error', reportedCostUsd: null }, c),
      );
    }
    maybeCompleteCancellation(live);
  }

  /**
   * ADR-0014: a soft warning when one agent's provider-reported cost passes the run's value. Per
   * agent only: costs of different agents are never added up. It never stops anything.
   */
  function warnOnCost(live: LiveRun, cost: number | null): void {
    const limit = live.state.run.budget.softCostUsdPerRun;
    if (cost === null || limit === null || !(cost > limit)) return;
    counters.costWarnings++;
    logger.log('warn', 'agent estimated cost above the warning', {
      runId: live.state.run.id,
      estimatedCostUsd: cost,
      warnAtUsd: limit,
    });
  }

  /** The approval bridge (ADR-0013 §4): engine → approval row → SSE → owner decision → resolve. */
  function askOwner(
    live: LiveRun,
    agentRunId: string,
    kind: RunAgentKind,
    request: PermissionRequest,
  ): Promise<PermissionDecision> {
    const runId = live.state.run.id;
    if (kind === 'lead') {
      // ADR-0013 §2: the lead runs read-only in the owner's tree; nothing to ask the owner.
      counters.leadToolUsesDenied++;
      logger.log('info', 'lead tool use denied', { runId, agentRunId, code: 'lead-read-only' });
      return Promise.resolve({ allow: false, message: LEAD_READ_ONLY_MESSAGE });
    }
    if (isReadOnlyRole(kind)) {
      // ADR-0019: the planner, the reviewer and the researcher (ADR-0037 §3) only read; their
      // tool uses are denied the same way.
      countDiagnostic('read-only-tool-denied');
      logger.log('info', 'read-only agent tool use denied', { runId, agentRunId, kind });
      return Promise.resolve({
        allow: false,
        message:
          kind === 'planner'
            ? PLANNER_READ_ONLY_MESSAGE
            : kind === 'researcher'
              ? RESEARCHER_READ_ONLY_MESSAGE
              : REVIEWER_READ_ONLY_MESSAGE,
      });
    }
    const target = allowlistTarget(request.toolName, toolInputOf(request));
    const readAllowlist = hooks.allowlist;
    // ADR-0022, ADR-0023 §5: for a helper or tester whose node runs Full auto in this run, nothing
    // waits for the owner. What still reaches the gate (an auto-mode escalation) runs only when the
    // Auto edits rules allow it, and is otherwise denied. Other agents of the run ask as usual.
    if (hasReviewableChange(kind) && agentModeOf(live, agentRunId) === 'full-auto') {
      return fullAutoGate(live, agentRunId, kind, request, target, readAllowlist);
    }
    if (target === null || readAllowlist === undefined) {
      return parkForOwner(live, agentRunId, request);
    }
    // The project allowlist may pre-approve it (ADR-0013 amendment): paths are resolved first.
    return (async () => {
      let verdict: AllowlistVerdict | undefined;
      try {
        verdict = await checkAllowlist(live, agentRunId, kind, target, readAllowlist);
      } catch (error) {
        // Fail closed: the owner is asked.
        logger.log('warn', 'allowlist check failed', { runId, agentRunId, ...errorFields(error) });
      }
      return parkForOwner(live, agentRunId, request, verdict);
    })();
  }

  async function fullAutoGate(
    live: LiveRun,
    agentRunId: string,
    kind: RunAgentKind,
    request: PermissionRequest,
    target: AllowlistTarget | null,
    readAllowlist: ControlWorkspaceHooks['allowlist'],
  ): Promise<PermissionDecision> {
    const runId = live.state.run.id;
    let verdict: AllowlistVerdict | undefined;
    if (target !== null && readAllowlist !== undefined) {
      try {
        verdict = await checkAllowlist(live, agentRunId, kind, target, readAllowlist);
      } catch (error) {
        logger.log('warn', 'allowlist check failed', { runId, agentRunId, ...errorFields(error) });
      }
    }
    // The agent's mode is Full auto, so the engine pre-approves an allowed verdict: never parked.
    if (verdict?.allowed === true) return parkForOwner(live, agentRunId, request, verdict);
    countDiagnostic('full-auto-denied');
    logger.log('info', 'full auto tool use denied', {
      runId,
      agentRunId,
      // A tool name, never its input.
      tool: request.toolName,
    });
    return { allow: false, message: FULL_AUTO_DENIED_MESSAGE };
  }

  async function checkAllowlist(
    live: LiveRun,
    agentRunId: string,
    agentKind: RunAgentKind,
    target: AllowlistTarget,
    readAllowlist: NonNullable<ControlWorkspaceHooks['allowlist']>,
  ): Promise<AllowlistVerdict | undefined> {
    // ADR-0021: a run with a snapshotted policy is judged by it, never by the live project setup;
    // ADR-0023 §5: with this agent's own mode for the run (its node's, tightened), never the lead's
    // or another node's. The engine checks the verdict against the same mode again.
    const policy = live.state.approvalPolicy;
    const mode = agentModeOf(live, agentRunId);
    const context = await readAllowlist(
      live.state.run.projectId,
      policy === undefined ? undefined : { ...policy, mode: mode ?? policy.mode },
    );
    if (context === null) return undefined;
    const row = store.repos.workspaces.getByAgentRun(agentRunId);
    const ws =
      row === undefined || row.state !== 'active' ? undefined : await workspaceFor(live, row);
    return allowlistVerdict({ target, context, workspace: ws ?? null, agentKind });
  }

  /**
   * The approval mode this agent runs with (`effectiveMode`): its node's mode for the run, or the
   * run's mode for an agent the program has no node for. Undefined for the lead, the planner and
   * reviewers (never covered by a mode) and for runs without an approval policy.
   */
  function agentModeOf(live: LiveRun, agentRunId: string): ProjectApprovals['mode'] | undefined {
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    return agent === undefined ? undefined : effectiveMode(live.state, agent);
  }

  /**
   * Records the request with the engine: auto-approved when the allowlist allows it, otherwise an
   * approval the agent waits on until the owner (or the timeout) decides.
   */
  function parkForOwner(
    live: LiveRun,
    agentRunId: string,
    request: PermissionRequest,
    verdict?: AllowlistVerdict,
  ): Promise<PermissionDecision> {
    const runId = live.state.run.id;
    let result: Applied<{ id: string; status: string }>;
    try {
      result = apply(live, (s, c) =>
        requestPermission(
          s,
          // Named fields only: nothing else from the adapter's request reaches the engine state.
          {
            agentRunId,
            toolName: request.toolName,
            toolUseId: request.toolUseId,
            summary: request.summary,
          },
          c,
          verdict === undefined ? {} : { allowlist: verdict },
        ),
      );
    } catch (error) {
      logger.log('error', 'approval request failed', { runId, agentRunId, ...errorFields(error) });
      return Promise.resolve({ allow: false, message: 'The control plane could not record this.' });
    }
    if (!result.ok) {
      logger.log('info', 'approval refused', { runId, agentRunId, code: result.refusal.code });
      return Promise.resolve({ allow: false, message: result.refusal.message });
    }
    const approvalId = result.value.id;
    if (result.value.status === 'approved') {
      logger.log('info', 'approval allowed by the project allowlist', { runId, approvalId });
      return Promise.resolve({ allow: true });
    }
    return new Promise((resolve) => permissions.set(approvalId, resolve));
  }

  /**
   * Lead tool calls: the engine validates (ADR-0013); a refusal is returned to the model as an
   * error. ADR-0021: `view_change` gets the change's diff appended (at most 32 KiB in all, sent
   * and never stored); `merge_change` answers once the server's merge is done or blocked.
   * ADR-0033: `message_agent` and `ask_lead` answer with the message's delivery state;
   * `get_review_findings` gets the change's stored findings appended (refused when none are).
   */
  async function leadTool(
    live: LiveRun,
    agentRunId: string,
    name: string,
    input: unknown,
  ): Promise<string> {
    const runId = live.state.run.id;
    const [result, sends] = mailbox.capture(() =>
      apply(live, (s, c) =>
        leadToolCall(
          s,
          { callerAgentRunId: agentRunId, name, input, registeredProjectIds: projectIds() },
          c,
        ),
      ),
    );
    if (!result.ok) {
      logger.log('info', 'lead tool refused', { runId, tool: name, code: result.refusal.code });
      throw new Error(result.refusal.message);
    }
    logger.log('info', 'lead tool called', { runId, tool: name });
    if (name === 'code_map') return codeMapReply(live, input);
    if (name === 'view_change') {
      const target = LeadToolInputs.view_change.safeParse(input);
      if (!target.success) return result.value;
      const change = await loop.changeDiff(live, target.data.agentId, VIEW_DIFF_MAX_BYTES);
      return viewChangeReply(result.value, change?.diff ?? null);
    }
    if (name === 'merge_change') {
      const target = LeadToolInputs.merge_change.safeParse(input);
      const merging = target.success ? live.merges.get(target.data.agentId) : undefined;
      if (merging === undefined) return result.value;
      return (await merging).reply;
    }
    if (name === 'message_agent' || name === 'ask_lead') {
      const sent = sends.find((r) => r.entry?.from === agentRunId);
      if (sent === undefined) return result.value;
      return `${result.value.replace(/\.$/, '')}: ${deliveryLine(sent)}`;
    }
    if (name === 'get_review_findings') {
      const target = LeadToolInputs.get_review_findings.safeParse(input);
      const findings = target.success ? storedFindings(live, target.data.agentId) : null;
      if (findings === null) {
        logger.log('info', 'lead tool refused', { runId, tool: name, code: 'no-findings' });
        throw new Error(
          'No review findings are stored for that change yet (no review agent has reviewed it). Use view_change to see the change.',
        );
      }
      return `${result.value}\n${findings}`;
    }
    return result.value;
  }

  /**
   * ADR-0033 §5: the latest review agent findings stored for a change (its round's row and the
   * findings comment, ADR-0021 §6), for the lead; null when none are stored. Sent, never logged.
   */
  function storedFindings(live: LiveRun, agentRunId: string): string | null {
    const rows = store.loopRepos.changeReviews
      .listForAgentRun(agentRunId)
      .filter(
        (r) => r.runId === live.state.run.id && r.reviewer === 'agent' && r.commentId !== null,
      );
    const latest = rows
      .map((r, i) => ({ r, i }))
      .sort((x, y) => x.r.round - y.r.round || x.i - y.i)
      .at(-1)?.r;
    if (latest === undefined || latest.commentId === null) return null;
    const comment = store.workspaceRepos.comments.getById(latest.commentId);
    if (comment === undefined) return null;
    const reviewer =
      latest.reviewerAgentRunId === null
        ? 'a review agent'
        : `${roleOf(live, latest.reviewerAgentRunId)} (agentId ${latest.reviewerAgentRunId})`;
    return [
      `Review round ${latest.round}, by ${reviewer}. Verdict: ${latest.verdict ?? 'none'}.`,
      `Findings:\n${comment.body}`,
    ].join('\n');
  }

  async function workspaceFor(live: LiveRun, row: WorkspaceRow): Promise<Workspace> {
    const known = live.workspaces.get(row.agentRunId);
    if (known !== undefined) return known;
    const project = deps.repos.projects.getById(row.projectId);
    const ws = await workspaceFromRow(row, project?.rootPath ?? null, deps.git);
    live.workspaces.set(row.agentRunId, ws);
    return ws;
  }

  function detail(live: LiveRun): RunDetailDto {
    const runId = live.state.run.id;
    const followUp = followUpView(live.state, followUpFacts(live));
    const dto = toRunDetail(live.state, {
      stored: store.repos.agentRuns.listForRun(runId),
      workspaces: store.repos.workspaces.listForRun(runId),
      messages: store.repos.messages.list(runId, { limit: MAX_PAGE_SIZE }),
      ...(followUp !== undefined && { followUp }),
    });
    // ADR-0033 §7: metadata only, the latest entries; absent while the run has none.
    if (live.mail.outbox.length > 0) dto.outbox = mailbox.outbox(live);
    // ADR-0021: absent for runs before it, so their detail is unchanged.
    const policy = live.state.approvalPolicy;
    if (policy !== undefined) dto.approvalMode = policy.mode;
    const integration = live.state.integration;
    if (integration !== undefined) {
      const branch = store.loopRepos.ticketBranches.getByRun(runId);
      dto.ticketBranch = branch === undefined ? null : toTicketBranchDto(branch);
      const program = programOf(live.state);
      dto.changes = toChangeReviewDtos({
        agents: live.state.agents,
        reviews: store.loopRepos.changeReviews.listForRun(runId),
        checks: store.loopRepos.checkCommits.listForRun(runId),
        maxReworkRounds: integration.maxReworkRounds,
        // ADR-0023: each change's rounds come from its node's review route (the lead's, plus the
        // reviewer's on route c); a version 1 run's route carries its single limit.
        maxRoundsOf: (agentRunId) => {
          const agent = live.state.agents.find((a) => a.id === agentRunId);
          if (agent === undefined) return integration.maxReworkRounds;
          const route = reviewRouteOf(program, agent);
          return route.by === 'agent' && route.then === 'direct'
            ? route.leadRounds + route.reviewerRounds
            : route.leadRounds;
        },
      });
      dto.reviewer = integration.reviewer;
      dto.maxReworkRounds = integration.maxReworkRounds;
    }
    return dto;
  }

  function agentDto(live: LiveRun, agentRunId: string): AgentRunDto {
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    if (agent === undefined) throw notFound(`Agent ${agentRunId} not found`);
    return toAgentDto(
      agent,
      store.repos.agentRuns.getById(agentRunId)?.sessionId ?? null,
      store.repos.workspaces.getByAgentRun(agentRunId),
    );
  }

  /**
   * ADR-0026 §5: a change whose worktree was removed (merged or discarded), from its recorded
   * commits: the worktree's start (`baseCommit`) to its sealed head. Empty when either is not
   * recorded or git no longer has it. Computed per request, never stored.
   */
  async function recordedChange(
    live: LiveRun,
    row: WorkspaceRow,
  ): Promise<{
    files: ReviewDto['agents'][number]['files'];
    diff: string;
    diffTruncated: boolean;
  }> {
    const none = { files: [], diff: '', diffTruncated: false };
    const head = store.loopRepos.workspaceChanges.getByAgentRun(row.agentRunId)?.headCommit ?? null;
    const project = deps.repos.projects.getById(live.state.run.projectId);
    if (head === null || row.baseCommit === null || project === undefined) return none;
    try {
      const changes = await deps.workspaces.diffCommits(project.rootPath, row.baseCommit, head);
      return changes ?? none;
    } catch (error) {
      if (!(error instanceof WorkspaceError)) throw error;
      logger.log('warn', 'recorded change unavailable', {
        runId: live.state.run.id,
        agentRunId: row.agentRunId,
        code: error.code,
      });
      return none;
    }
  }

  async function review(runId: string): Promise<ReviewDto> {
    const live = get(runId);
    const agents: ReviewDto['agents'] = [];
    const tip = store.loopRepos.ticketBranches.getByRun(runId)?.headCommit;
    for (const agent of live.state.agents) {
      // Live helpers and testers are still changing their tree; they are reviewed once they stop.
      // ADR-0021: in a loop run, a change is listed once it is sealed, until it is decided.
      const state =
        agent.review ??
        (agent.change !== undefined && agent.change.headCommit !== null ? 'pending' : null);
      if (!hasReviewableChange(agent.kind) || state === null) continue;
      const row = store.repos.workspaces.getByAgentRun(agent.id);
      if (row === undefined) continue;
      const base = {
        agentRunId: agent.id,
        role: agent.role,
        branch: row.branch,
        baseBranch: row.baseBranch,
        state,
      };
      if (row.state === 'removed') {
        // ADR-0026 §5: a decided change's worktree is gone; its files come from the recorded
        // commits while git has them (empty otherwise, and for runs before the review loop).
        agents.push({ ...base, ...(await recordedChange(live, row)) });
        continue;
      }
      try {
        const ws = await workspaceFor(live, row);
        const sealed = agent.change !== undefined && agent.change.headCommit !== null;
        // A sealed change is shown against the current ticket tip: only what it adds.
        const changes =
          sealed && tip !== undefined
            ? await deps.workspaces.changeDiff(ws, tip)
            : await deps.workspaces.changes(ws);
        store.repos.workspaces.setReview(row.id, {
          reviewState: row.reviewState,
          changedFiles: changes.files.length,
        });
        agents.push({ ...base, ...changes });
      } catch (error) {
        if (!(error instanceof WorkspaceError)) throw error;
        logger.log('warn', 'review changes unavailable', {
          runId,
          agentRunId: agent.id,
          code: error.code,
        });
      }
    }
    return { runId, agents };
  }

  async function applyReview(
    runId: string,
    agentRunId: string,
    action: 'merge' | 'discard',
  ): Promise<'merged' | 'discarded' | 'no-changes'> {
    const live = get(runId);
    const check = checkReviewAction(live.state, agentRunId);
    if (check !== null) throw refusalError(check);
    if (reviewing.has(agentRunId)) {
      throw new HttpError(409, 'review_in_progress', 'This review is already being applied');
    }
    reviewing.add(agentRunId);
    try {
      const role = live.state.agents.find((a) => a.id === agentRunId)?.role;
      const row = store.repos.workspaces.getByAgentRun(agentRunId);
      let outcome: 'merged' | 'discarded' | 'no-changes' = 'no-changes';
      if (row !== undefined && row.state === 'active') {
        const ws = await workspaceFor(live, row);
        // Let the observation pipeline read the worker's transcript while its root still exists.
        await deps.flushIngestion?.().catch(() => undefined);
        if (action === 'merge') {
          const merged = await deps.workspaces.merge(ws, role === undefined ? {} : { role });
          outcome = merged.outcome;
        } else {
          outcome = 'discarded';
        }
        // Recorded before the worktree goes, so a crash in between never loses a merge.
        store.repos.workspaces.setReview(row.id, { reviewState: outcome });
        try {
          // After a merge the branch is in the base; the worktree and branch are released.
          await deps.workspaces.discard(ws);
          store.repos.workspaces.markRemoved(row.id);
          live.workspaces.delete(agentRunId);
        } catch (error) {
          logger.log('warn', 'workspace release failed', {
            runId,
            agentRunId,
            ...errorFields(error),
          });
        }
      } else if (row !== undefined && row.reviewState !== 'pending') {
        outcome = row.reviewState;
      }
      applyOrThrow(live, (s, c) => recordReview(s, agentRunId, outcome, c));
      logger.log('info', 'review recorded', { runId, agentRunId, outcome });
      return outcome;
    } catch (error) {
      if (error instanceof WorkspaceError) {
        logger.log('info', 'review refused', { runId, agentRunId, code: error.code });
        throw workspaceError(error);
      }
      throw error;
    } finally {
      reviewing.delete(agentRunId);
    }
  }

  function sweep(): void {
    if (closed) return;
    const now = deps.now();
    for (const live of runs.values()) {
      const runId = live.state.run.id;
      try {
        if (live.state.approvals.some((a) => isApprovalOverdue(a, now, approvalTimeoutMs))) {
          const result = apply(live, (s, c) => expireApprovals(s, c, approvalTimeoutMs));
          if (result.ok) logger.log('info', 'approvals expired', { runId, count: result.value });
        }
        const run = live.state.run;
        // P-D: the time a run waits only for the owner's decision does not count.
        if (WORKING.includes(run.status) && isRunOverdue(live.state, now, runTimeoutMs)) {
          logger.log('warn', 'run timed out', { runId });
          apply(live, timeOutRun);
        }
        if (
          live.state.run.status === 'CANCELLING' &&
          live.cancellingSince !== null &&
          now.getTime() - live.cancellingSince >= cancelGraceMs
        ) {
          // The grace period is over: drop what is still running and finish the cancellation.
          for (const handle of live.handles.values()) handle.abort();
          live.handles.clear();
          live.starting.clear();
          logger.log('warn', 'run cancellation forced', { runId });
          maybeCompleteCancellation(live);
        }
      } catch (error) {
        logger.log('error', 'control sweep failed', { runId, ...errorFields(error) });
      }
    }
  }

  // Restart (ADR-0013 §7): nothing is relaunched; live work becomes NEEDS_REVIEW.
  for (const run of store.repos.runs.listByStatus(NON_TERMINAL)) {
    const state = store.load(run.id);
    if (state === undefined) continue;
    const live = newLive(state);
    runs.set(run.id, live);
    const result = recoverAfterRestart(state, ctx());
    if (result.ok) {
      store.commit(state, result.state, []);
      live.state = result.state;
      live.cancellingSince = null;
      // A run that was being stopped finishes stopping here (ADR-0013 §7): its facts-only
      // summary, unless it already has one (`endTrigger` is null for NEEDS_REVIEW).
      const ended = endTrigger(state, result.state);
      if (ended !== null) summaries.schedule(live, ended);
      logger.log('info', 'run recovered after restart', {
        runId: run.id,
        status: result.state.run.status,
      });
    }
    if (live.state.run.status === 'REVIEW') resolveEmptyReviews(live);
  }

  const runExists = (runId: string) => store.repos.runs.getById(runId) !== undefined;

  return {
    enabled: deps.enabled,
    csrfToken,
    attachmentFiles,

    activeRuns(projectId) {
      const active = new Map<string, RunStatus>();
      for (const run of store.repos.runs.listByStatus(NON_TERMINAL)) {
        if (run.projectId === projectId) active.set(run.id, run.status);
      }
      for (const live of runs.values()) {
        const run = live.state.run;
        if (run.projectId !== projectId) continue;
        const working =
          NON_TERMINAL.includes(run.status) ||
          live.handles.size > 0 ||
          live.starting.size > 0 ||
          live.followUp !== undefined ||
          live.merges.size > 0;
        if (working) active.set(run.id, run.status);
      }
      for (const op of store.loopRepos.conflictResolutions.listActive()) {
        if (op.projectId !== projectId || active.has(op.runId)) continue;
        const status =
          runs.get(op.runId)?.state.run.status ?? store.repos.runs.getById(op.runId)?.status;
        if (status !== undefined) active.set(op.runId, status);
      }
      return [...active].map(([runId, status]) => ({ runId, status }));
    },

    forgetRuns(runIds) {
      for (const runId of runIds) runs.delete(runId);
    },

    async start() {
      // No agent survives a restart: reviewers' checkouts and skills plugins are temporary
      // (ADR-0019). Removed even with managed agents off, since nothing can use them.
      try {
        // ADR-0036: a folder of a run whose row is gone (a removed project) is deleted with the
        // file system only: no git command on the owner's repository, no branch deleted.
        const checkouts = await reviewCheckouts.cleanupOrphans(runExists);
        const plugins = await skillsPlugins.cleanupAll();
        // ADR-0022: Full auto's per-run sandbox temp folders.
        const sandboxTemp = await fullAutoPaths.cleanupAll();
        // ADR-0021: temporary checkouts of ticket branch tips (checks, update from base).
        const tipCheckouts = await deps.workspaces.cleanupCheckouts(runExists);
        logger.log('info', 'temporary agent folders cleaned', {
          checkouts,
          plugins,
          tipCheckouts,
          sandboxTemp,
        });
      } catch (error) {
        logger.log('warn', 'temporary agent folder cleanup failed', errorFields(error));
      }
      if (!deps.enabled) return;
      // ADR-0030: interrupted conflict resolutions end (never relaunched or republished), and
      // their resolvers' half-done worktrees are discarded before the orphan cleanup.
      await resolution.recover((runId) => runs.get(runId));
      // Worktrees the database still references stay, NEEDS_REVIEW ones included.
      const keep = store.repos.workspaces
        .listActive()
        .map((w) => ({ runId: w.runId, agentId: w.agentRunId }));
      try {
        const result = await deps.workspaces.cleanupOrphans(keep, runExists);
        logger.log('info', 'orphan worktrees cleaned', {
          removed: result.removed.length,
          kept: result.kept,
          failed: result.failed,
        });
      } catch (error) {
        logger.log('warn', 'orphan worktree cleanup failed', errorFields(error));
      }
      if (sweepIntervalMs !== null && sweepTimer === undefined) {
        sweepTimer = setInterval(sweep, sweepIntervalMs);
        sweepTimer.unref();
      }
    },

    async close() {
      closed = true;
      if (sweepTimer !== undefined) clearInterval(sweepTimer);
      for (const resolve of permissions.values()) {
        resolve({ allow: false, message: 'The control plane is shutting down.' });
      }
      permissions.clear();
      for (const live of runs.values()) {
        for (const handle of live.handles.values()) handle.abort();
        live.followUp?.abort();
      }
      // An agent stream that ignores abort must not hold up shutdown past the grace period;
      // nothing it emits is recorded any more (`closed`).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, cancelGraceMs);
        timer.unref();
      });
      await Promise.race([Promise.allSettled([...pumps]), grace]);
      clearTimeout(timer);
      while (tasks.size > 0) await Promise.allSettled([...tasks]);
    },

    listRuns() {
      return store.repos.runs.list({ limit: 100 }).map(toRunSummary);
    },

    getRun(runId) {
      return detail(get(runId));
    },

    createRun(body) {
      const input = StartRunRequestSchema.parse(body);
      const project = deps.repos.projects.getById(input.projectId);
      const runId = newId();
      const title = (input.title ?? `Run in ${project?.name ?? 'project'}`).slice(0, 200);
      const result = createRun(
        {
          runId,
          leadAgentRunId: newId(),
          projectId: input.projectId,
          title,
          ...(input.budget !== undefined && { budget: input.budget }),
          registeredProjectIds: projectIds(),
        },
        ctx(),
      );
      if (!result.ok) throw refusalError(result.refusal);
      store.commit(null, result.state, []);
      const live = newLive(result.state);
      runs.set(runId, live);
      notify('runs-changed', live);
      logger.log('info', 'run created', { runId, projectId: input.projectId });
      return detail(live);
    },

    chat(runId, body) {
      const input = ChatRequestSchema.parse(body);
      const live = get(runId);
      if (leadHasEnded(live.state)) {
        // ADR-0020: the owner's message brings the ended lead back for one answers-only turn.
        const facts = followUpFacts(live);
        applyOrThrow(live, (s, c) => followUpChat(s, input.text, c, facts));
        logger.log('info', 'follow-up turn requested', { runId });
        const [stored] = store.repos.messages.list(runId, { limit: 1 });
        if (stored === undefined || stored.role !== 'owner') {
          throw new HttpError(500, 'internal_error', 'The message was not stored');
        }
        return toChatMessageDto(stored, true);
      }
      applyOrThrow(live, (s, c) => ownerChat(s, input.text, c));
      // Stored in the same synchronous step, so the newest message is this one.
      const [stored] = store.repos.messages.list(runId, { limit: 1 });
      if (stored === undefined || stored.role !== 'owner') {
        throw new HttpError(500, 'internal_error', 'The message was not stored');
      }
      return toChatMessageDto(stored);
    },

    decideApproval(approvalId, body) {
      const input = ApprovalDecisionRequestSchema.parse(body);
      const row = store.repos.approvals.getById(approvalId);
      if (row === undefined) {
        throw new HttpError(404, 'approval_not_found', `Approval ${approvalId} not found`);
      }
      const live = get(row.runId);
      applyOrThrow(live, (s, c) =>
        decideApproval(
          s,
          approvalId,
          input.decision,
          c,
          input.message === undefined ? {} : { message: input.message },
        ),
      );
      logger.log('info', 'approval decided', {
        runId: row.runId,
        approvalId,
        decision: input.decision,
      });
      const approval = live.state.approvals.find((a) => a.id === approvalId);
      if (approval === undefined) throw notFound(`Approval ${approvalId} not found`);
      return toApprovalDto(approval);
    },

    stopAgent(runId, agentRunId) {
      const live = get(runId);
      const agent = live.state.agents.find((a) => a.id === agentRunId);
      if (agent?.kind === 'lead' && leadHasEnded(live.state) && hasFollowUpTurn(live)) {
        // The owner's Stop on the ended lead ends its follow-up turn (ADR-0020).
        applyOrThrow(live, stopFollowUp);
        logger.log('info', 'follow-up turn stopped by owner', { runId });
        return agentDto(live, agentRunId);
      }
      applyOrThrow(live, (s, c) => stopAgent(s, agentRunId, c));
      logger.log('info', 'agent stopped by owner', { runId, agentRunId });
      return agentDto(live, agentRunId);
    },

    messageAgent(runId, agentRunId, body) {
      const input = ChatRequestSchema.parse(body);
      const live = get(runId);
      const lead = live.state.agents.find((a) => a.kind === 'lead');
      if (lead === undefined) throw notFound(`Run ${runId} has no lead agent`);
      // The engine's `message_agent` checks apply unchanged (run active, worker live, budget).
      applyOrThrow(live, (s, c) =>
        leadToolCall(
          s,
          {
            callerAgentRunId: lead.id,
            name: 'message_agent',
            input: { agentId: agentRunId, text: input.text },
            registeredProjectIds: projectIds(),
          },
          c,
        ),
      );
      logger.log('info', 'agent messaged by owner', { runId, agentRunId });
      return agentDto(live, agentRunId);
    },

    stopRun(runId) {
      const live = get(runId);
      applyOrThrow(live, cancelRun);
      logger.log('info', 'run stopped by owner', { runId });
      return summaryOf(live.state);
    },

    review,

    async reviewAction(runId, body) {
      const input = ReviewActionRequestSchema.parse(body);
      const live = get(runId);
      if (live.state.integration !== undefined) {
        // ADR-0021: the owner decides a change instead of the lead (merges go into the ticket
        // branch, never the base branch); the engine checks each action first.
        await loop.ownerChangeAction(live, input, (failedChecks) => {
          const role = live.state.agents.find((a) => a.id === input.agentRunId)?.role ?? 'Helper';
          try {
            hooks.mergedAnyway?.({
              runId,
              agentRunId: input.agentRunId,
              role,
              reason: input.reason ?? '',
              failedChecks,
            });
          } catch (error) {
            logger.log('error', 'merge-anyway record failed', { runId, ...errorFields(error) });
          }
        });
        logger.log('info', 'change decided by owner', {
          runId,
          agentRunId: input.agentRunId,
          action: input.action,
        });
        return review(runId);
      }
      // A run without the review loop has no rework: each change is merged or discarded.
      if (input.action === 'rework') {
        throw new HttpError(
          409,
          'rework_unavailable',
          'This run has no review loop, so its changes cannot be sent back for rework',
        );
      }
      if (input.action === 'discard') {
        await applyReview(runId, input.agentRunId, 'discard');
        return review(runId);
      }
      // ADR-0017 §4: a failed required check blocks a plain merge; "merge anyway" needs a reason.
      const gate = hooks.reviewGate?.(runId, input.agentRunId) ?? {
        failedRequired: [],
        running: false,
      };
      if (gate.running) {
        throw new HttpError(
          409,
          'checks_running',
          'The checks are still running on these changes; wait for them to finish',
        );
      }
      const failed = gate.failedRequired;
      if (input.action === 'merge') {
        if (failed.length > 0) {
          throw new HttpError(
            409,
            'checks_failed',
            `A required check did not pass (${failed.join(', ')}); fix it, or merge anyway with a reason`,
          );
        }
        await applyReview(runId, input.agentRunId, 'merge');
        return review(runId);
      }
      if (failed.length === 0) {
        throw new HttpError(
          409,
          'merge_anyway_unavailable',
          'There are no failed checks to override; use merge instead',
        );
      }
      const outcome = await applyReview(runId, input.agentRunId, 'merge');
      const reason = input.reason ?? '';
      if (outcome === 'merged' && hooks.mergedAnyway !== undefined) {
        const role =
          get(runId).state.agents.find((a) => a.id === input.agentRunId)?.role ?? 'Helper';
        try {
          hooks.mergedAnyway({
            runId,
            agentRunId: input.agentRunId,
            role,
            reason,
            failedChecks: failed,
          });
        } catch (error) {
          logger.log('error', 'merge-anyway record failed', { runId, ...errorFields(error) });
        }
      }
      logger.log('info', 'merged anyway', { runId, agentRunId: input.agentRunId, outcome });
      return review(runId);
    },

    createTicketRun(input) {
      if (closed)
        throw refusalError({ code: 'run-not-active', message: 'The server is shutting down.' });
      const runId = newId();
      const result = createRun(
        {
          runId,
          leadAgentRunId: newId(),
          projectId: input.projectId,
          title: input.title.slice(0, 200),
          budget: input.budget,
          limits: input.limits,
          ticket: {
            ticketId: input.ticketId,
            leadPrompt: input.leadPrompt,
            ...(input.plannerPrompt !== undefined && { plannerPrompt: input.plannerPrompt }),
            ...(input.researcherPrompt !== undefined && {
              researcherPrompt: input.researcherPrompt,
            }),
          },
          ...(input.workflow !== undefined && { workflow: input.workflow }),
          ...(input.reviewLoop !== undefined && { reviewLoop: input.reviewLoop }),
          ...(input.approvals !== undefined && { approvals: input.approvals }),
          ...(input.graph !== undefined && { graph: input.graph }),
          ...(input.graphContext !== undefined && { graphContext: input.graphContext }),
          registeredProjectIds: projectIds(),
        },
        ctx(),
      );
      if (!result.ok) throw refusalError(result.refusal);
      const inTransaction = input.inTransaction;
      commit(null, result.state, result.effects, inTransaction && (() => inTransaction(runId)));
      const live = newLive(result.state);
      runs.set(runId, live);
      startCodeMap(live);
      notify('runs-changed', live);
      perform(live, result.effects);
      afterCommit(null, live.state);
      logger.log('info', 'ticket run created', { runId, projectId: input.projectId });
      return detail(live);
    },

    continueRun(runId) {
      const live = get(runId);
      applyOrThrow(live, continueStages);
      logger.log('info', 'stages continued by owner', { runId });
      return detail(live);
    },

    runWorkflow(runId) {
      const state = get(runId).state;
      const dto = deriveRunWorkflow(state);
      if (state.integration === undefined || dto.review !== undefined) return dto;
      const changes = state.agents.flatMap((a) => (a.change === undefined ? [] : [a.change]));
      return { ...dto, review: reviewCounts(changes) };
    },

    runWorkflowGraph(runId) {
      const state = get(runId).state;
      return { runId, graph: runGraphV3Of(state), ...deriveRunWorkflowGraph(state) };
    },

    ticketBranch(runId) {
      const live = get(runId);
      // ADR-0030: a project that delegated conflict resolution updates a moved target by itself.
      resolution.maybeAutoStart(live);
      return loop.ticketBranchReview(live);
    },

    conflictResolution(runId) {
      return resolution.view(get(runId));
    },

    startConflictResolution(runId) {
      return resolution.startByOwner(get(runId));
    },

    cancelConflictResolution(runId) {
      return resolution.cancel(get(runId));
    },

    promoteConflictResolution(runId, body) {
      return resolution.promote(get(runId), body);
    },

    async ticketBranchAction(runId, body) {
      const live = get(runId);
      await loop.ticketBranchAction(live, body, {
        ownerComment: (text) => {
          // The owner's own words (ADR-0016, ADR-0021 §6), kept on the ticket.
          const ticketId = live.state.run.ticketId;
          if (ticketId === null) return;
          try {
            store.workspaceRepos.comments.insert({
              ticketId,
              runId,
              author: 'owner',
              body: text.slice(0, 8000),
              kind: 'comment',
            });
          } catch (error) {
            logger.log('error', 'owner comment not stored', { runId, ...errorFields(error) });
          }
        },
        // ADR-0024 §3: the merge line, app data only (branch names and a commit id).
        appComment: (text) => appComment(live, text),
      });
      // ADR-0030: a merge moved a target; other tickets of the project waiting on it may update
      // themselves when their project delegated it.
      if (live.state.run.status === 'COMPLETED') {
        for (const other of runs.values()) {
          if (other === live || other.state.run.projectId !== live.state.run.projectId) continue;
          if (other.state.run.status === 'REVIEW') resolution.maybeAutoStart(other);
        }
      }
      return loop.ticketBranchReview(live);
    },

    async resetTicketBranch(runId, body) {
      const live = get(runId);
      await loop.resetTicketBranch(live, body);
      return loop.ticketBranchReview(live);
    },

    openPullRequest(runId, body, ticket) {
      return loop.openPullRequest(get(runId), body, ticket);
    },

    refreshPullRequest(runId) {
      return loop.refreshPullRequest(get(runId));
    },

    decidePlan(runId, planId, decision, comment) {
      const live = get(runId);
      const plan = applyOrThrow(live, (s, c) => decidePlan(s, planId, decision, c, comment));
      logger.log('info', 'plan decided by owner', { runId, planId, decision });
      return plan;
    },

    decidePlanOption(runId, decision, input) {
      const live = get(runId);
      const option = applyOrThrow(live, (s, c) => decidePlanOption(s, decision, c, input));
      logger.log('info', 'plan option decided by owner', {
        runId,
        planOptionId: option?.id ?? null,
        decision,
      });
      return option;
    },

    peek(runId) {
      return runs.get(runId)?.state;
    },

    async agentWorkspace(runId, agentRunId) {
      const row = store.repos.workspaces.getByAgentRun(agentRunId);
      if (row === undefined || row.runId !== runId || row.state !== 'active') return undefined;
      return workspaceFor(get(runId), row);
    },

    extraRoots() {
      const roots = store.repos.workspaces
        .listActive()
        .map((w) => ({ projectId: w.projectId, rootPath: w.worktreePath }));
      // A reviewer's session is the project's too, while its checkout exists.
      for (const { projectId, checkout } of activeCheckouts.values()) {
        roots.push({ projectId, rootPath: checkout.path });
      }
      return roots;
    },

    isManagedPath(cwd) {
      return worktreesDirs.some((dir) => isPathInside(dir, cwd));
    },

    sweep,

    async idle() {
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (tasks.size === 0) {
          await new Promise((resolve) => setImmediate(resolve));
          if (tasks.size === 0) return;
        }
        await Promise.allSettled([...tasks]);
      }
    },

    counters: () => ({ ...counters, diagnostics: { ...counters.diagnostics } }),

    checkProvider(provider) {
      const adapter = deps.adapters.get(provider);
      if (adapter === undefined) {
        return Promise.resolve({
          ok: false,
          reason: 'This provider is not set up on this server.',
        });
      }
      return checkAvailability(adapter);
    },

    providerAvailability() {
      return [...deps.adapters.values()].map((adapter) => {
        if (adapter.checkAvailable === undefined) {
          return { provider: adapter.provider, available: true, reason: null, checkedAt: null };
        }
        const cached = availability.get(adapter.provider);
        if (cached === undefined) {
          return { provider: adapter.provider, available: null, reason: null, checkedAt: null };
        }
        return {
          provider: adapter.provider,
          available: cached.result.ok,
          reason: cached.result.ok ? null : cached.result.reason.slice(0, 300),
          checkedAt: cached.checkedAt.toISOString(),
        };
      });
    },
  };
}
