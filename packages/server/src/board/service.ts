import {
  AttachmentNameSchema,
  HARNESS_TICKET_TEMPLATE,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TICKET,
  TICKET_STAGES,
  WorkflowGraphInvalidError,
  approvalsOf,
  compactRunOptions,
  compileWorkflow,
  resolveRunOptions,
  ticketStage,
  tightenMode,
  validateWorkflowGraph,
  type Attachment,
  type CheckRun,
  type SetupRun,
  type CompileContext,
  type ProjectAgentSetup,
  type RunBudget,
  type RunStatus,
  type Ticket,
  type TicketBranchPrefs,
  type TicketBranchPrefsPatch,
  type TicketRunOptions,
  type TicketStage,
  type TokenCounts,
  type WorkflowGraph,
  type WorkflowProgram,
} from '@acp/core';
import {
  ConnectRepositoryRequestSchema,
  CreateBranchRequestSchema,
  CreateRepoProjectRequestSchema,
  CreateRepositoryRequestSchema,
  CreateTicketRequestSchema,
  MoveTicketRequestSchema,
  PlanDecisionRequestSchema,
  StartTicketRequestSchema,
  TicketCommentRequestSchema,
  UpdateProjectSetupRequestSchema,
  UpdateTicketRequestSchema,
  type BoardDto,
  type ContextCandidateDto,
  type HarnessStatusDto,
  type ProjectDto,
  type RunDetailDto,
  type StreamNoticeDto,
  type TicketCardDto,
  type CodeHostStatusDto,
  type ProjectBranchesDto,
  type TicketBranchDto,
  type AttachmentDto,
  type TicketActivityDto,
  type TicketCommentDto,
  type TicketDetailDto,
  type TicketDto,
  type TicketRunOptionsPatch,
  type TicketTotalsDto,
} from '@acp/core/api';
import {
  MAX_PAGE_SIZE,
  createOrchestrationRepositories,
  createRedesignRepositories,
  createHarnessRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  type AcpDatabase,
  type OrchestrationRepositories,
  type Queries,
  type Repositories,
  type StoredRunSnapshot,
  type WorkspaceRepositories,
  withTransaction,
} from '@acp/db';
import {
  deriveRunWorkflow,
  isActiveAgentStatus,
  runSettingsFromSetup,
  ticketRunPrompts,
  type RunLimits,
  type RunState,
} from '@acp/orchestrator';
import { CodeHostError, codeHostHttpError, type CodeHostService } from '../code-host/index.js';
import { managedDisabled, workspaceError } from '../control/errors.js';
import { toRunSummary } from '../control/mappers.js';
import { createRunStore, withPlanDeciders, type RunStore } from '../control/store.js';
import { countsAsHelper } from '../control/roles.js';
import type { ControlService, ControlWorkspaceHooks } from '../control/service.js';
import { HttpError, notFound } from '../errors.js';
import { HarnessError, listContextCandidates } from '../harness/index.js';
import { errorFields, type Logger } from '../logger.js';
import type { ProjectsService } from '../services/projects.js';
import {
  WorkspaceError,
  ticketBranchPlan,
  type GitRunner,
  type WorkspaceManager,
} from '../workspace/index.js';
import type { CheckService } from './checks.js';
import { buildTicketActivity } from './activity.js';
import { attachmentDbError, toAttachmentDto, toCommentDto, toCommentDtos } from './comments.js';
import { allowedMimeType, contentMatches, sha256Of } from '../attachments/content.js';
import { createRepository } from './create-repo.js';
import { dbConflict, harnessError } from './errors.js';
import type { ProjectHarness } from './harness.js';
import { ensureSetup, legacyAllowlistOf } from './setup.js';
import { effectiveWorkflow, projectRunDefaults } from '../workflow/graph.js';
import { createTicketTokens } from '../tokens/service.js';
import {
  createTicketBranchActions,
  type TicketBranchCodeHost,
  type TicketBranchContext,
} from './ticket-branch-actions.js';
import { buildTicketTotals } from './ticket-totals.js';

/** What `POST /api/tickets/:id/attachments` received (ADR-0026 §4). */
export interface AttachmentUpload {
  /** The request's `Content-Type`: the declared type, checked against the allowlist. */
  contentType: string | undefined;
  /** `X-Attachment-Name`, URI-encoded. */
  name: string | undefined;
  /** `?commentId=`: attach to this comment of the ticket. */
  commentId: string | undefined;
  bytes: Uint8Array;
}

/** The decoded `X-Attachment-Name`, or a 400. */
function attachmentName(header: string | undefined): string {
  let decoded: string | undefined;
  try {
    decoded = header === undefined ? undefined : decodeURIComponent(header);
  } catch {
    decoded = undefined;
  }
  const parsed = AttachmentNameSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_attachment_name',
      'X-Attachment-Name must be a plain file name (URI-encoded, no folders)',
    );
  }
  return parsed.data;
}

/**
 * The project's workflow graph cannot run (ADR-0023 §3): the run is not created. The message is
 * plain; the Workflow page shows the issues.
 */
export function workflowCannotRun(errors: number, first: string): HttpError {
  const count = `${errors} problem${errors === 1 ? '' : 's'}`;
  return new HttpError(
    409,
    'workflow_invalid',
    `The project’s workflow cannot run: it has ${count}. ${first} Fix it on the Workflow page.`.replace(
      /\s+/g,
      ' ',
    ),
  );
}

/**
 * The Agent Workspace board (P4-D; README §4, §6, ADR-0016/0017): projects created from the UI,
 * their agent setup, harness and context files, and tickets worked by plan-first runs.
 *
 * Tickets and runs are joined here, never invented: a ticket's column comes from `ticketStage()`
 * over its stored status and its current run; the run itself is the Phase 3 engine's, driven by
 * the control service. Owner text (titles, descriptions, comments) is stored per ADR-0016.
 */

export interface BoardService {
  createRepoProject(body: unknown): Promise<ProjectDto>;
  removeProject(projectId: string): void;
  getSetup(projectId: string): Promise<ProjectAgentSetup>;
  putSetup(projectId: string, body: unknown): ProjectAgentSetup;
  harnessStatus(projectId: string): Promise<HarnessStatusDto>;
  runMainChecks(projectId: string): Promise<CheckRun[]>;
  /** Past "Run checks now" results on the main branch, newest first (R-E's history). */
  mainCheckHistory(projectId: string, limit?: number): CheckRun[];
  /** ADR-0027: the setup runs before "Run checks now" on main, newest first. */
  mainSetupHistory(projectId: string, limit?: number): SetupRun[];
  createHarnessTicket(projectId: string): Promise<TicketDto>;
  contextCandidates(projectId: string): Promise<ContextCandidateDto[]>;
  board(projectId: string): Promise<BoardDto>;
  listTickets(projectId: string): TicketCardDto[];
  createTicket(projectId: string, body: unknown): Promise<TicketDto>;
  ticket(ticketId: string): TicketDetailDto;
  updateTicket(ticketId: string, body: unknown): TicketDetailDto;
  moveTicket(ticketId: string, body: unknown): TicketDto;
  /** `body`: `StartTicketRequest` (ADR-0021 per-run overrides); empty uses the project's. */
  startTicket(ticketId: string, body?: unknown): Promise<TicketDetailDto>;
  addComment(ticketId: string, body: unknown): TicketCommentDto;
  /** ADR-0026 §1: the Conversation tab's timeline, built from records. */
  activity(ticketId: string): TicketActivityDto;
  /**
   * ADR-0026 §4: stores one attachment of the owner's on the ticket (or one of its comments) after
   * checking its type, name, size and content.
   */
  uploadAttachment(ticketId: string, input: AttachmentUpload): Promise<AttachmentDto>;
  listAttachments(ticketId: string): AttachmentDto[];
  /** The stored row and the file to serve. */
  attachmentContent(id: string): { attachment: Attachment; path: string };
  deleteAttachment(id: string): Promise<void>;
  decidePlan(ticketId: string, planId: string, body: unknown): TicketDetailDto;
  runChecks(runId: string): CheckRun[];
  runAgentChecks(runId: string, agentRunId: string): Promise<CheckRun[]>;
  /** ADR-0025: what the app can do with the project's `origin` (`gh` by exit code only). */
  codeHostStatus(projectId: string): Promise<CodeHostStatusDto>;
  /** ADR-0025 §7: creates the repository on GitHub and sets it as `origin` (the owner's click). */
  createCodeHostRepository(projectId: string, body: unknown): Promise<CodeHostStatusDto>;
  /** ADR-0025 §7: sets an existing GitHub repository as `origin` (the owner's click). */
  connectCodeHostRepository(projectId: string, body: unknown): Promise<CodeHostStatusDto>;
  /** ADR-0025 §8: the project's local branches, read from git now (no fetch). */
  projectBranches(projectId: string): Promise<ProjectBranchesDto>;
  /** ADR-0025 §8: creates (and, if asked, pushes) a local branch on the owner's click. */
  createProjectBranch(projectId: string, body: unknown): Promise<ProjectBranchesDto>;
  /** ADR-0025 §4: Push & open PR for the ticket's current run's ticket branch. */
  openPullRequest(ticketId: string, body: unknown): Promise<TicketBranchDto>;
  /** ADR-0025: reads the pull request's state now (the owner's view or Refresh). */
  refreshPullRequest(ticketId: string): Promise<TicketBranchDto>;
  /** ADR-0025 §9: merges the open pull request on GitHub (the owner's click), then reads it. */
  mergePullRequest(ticketId: string, body: unknown): Promise<TicketBranchDto>;
  /** ADR-0025 §9: deletes the finished ticket branch on origin and in the project. */
  deleteTicketBranch(ticketId: string, body: unknown): Promise<TicketBranchDto>;
  /** v0.3.0 T-A: how long the ticket took and its tokens (no cost). */
  ticketTotals(ticketId: string): TicketTotalsDto;
  /** What the control service calls back into (ticket status, notices, checks, merge record). */
  controlHooks(): ControlWorkspaceHooks;
}

export interface BoardServiceDeps {
  db: AcpDatabase;
  repos: Repositories;
  queries: Queries;
  projects: ProjectsService;
  control: ControlService;
  harness: ProjectHarness;
  checks: CheckService;
  git: GitRunner;
  now: () => Date;
  publish: (notice: StreamNoticeDto) => void;
  logger: Logger;
  /**
   * ADR-0025: checks a ticket's branch plan (its target and source exist locally, its name is not
   * a long-lived branch) before the run starts. Omitted in tests that do not use git.
   */
  ticketBranches?: Pick<WorkspaceManager, 'checkTicketBranchPlan'>;
  /** ADR-0025: the code host status; omitted, its route answers `code_host_unavailable`. */
  codeHost?: Pick<
    CodeHostService,
    'status' | 'createRepository' | 'connectRepository' | 'branches' | 'createBranch'
  > &
    TicketBranchCodeHost;
  /**
   * Tests only: start ticket runs without the review loop, as runs started before ADR-0021 did, so
   * the legacy flow those runs keep stays covered. Production never sets it.
   */
  legacyTicketRuns?: boolean;
}

/** Run states in which the ticket's run still works or waits for the owner (not terminal). */
const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const RUNNING_RUN: ReadonlySet<RunStatus> = new Set([
  'QUEUED',
  'PLANNING',
  'PLAN_REVIEW',
  'RUNNING',
  'BLOCKED',
  'CANCELLING',
]);
const STOPPED_RUN: ReadonlySet<RunStatus> = new Set(['CANCELLED', 'CANCELLING']);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** What a card and a stage need from a ticket's current run. */
interface RunView {
  status: RunStatus;
  pendingApprovals: number;
  helpersLive: number;
  budgetTokensUsed: number;
  /** The lead agent's own provider-reported cost, when known (estimated; never summed). */
  leadCostUsd: number | null;
  updatedAt: string;
}

/**
 * A ticket's run options after an update (RL-H): a value sets the option, `null` puts it back to
 * the project default, an absent field is kept; `null` for the whole patch clears every option.
 */
export function patchRunOptions(
  current: TicketRunOptions | undefined,
  patch: TicketRunOptionsPatch | null,
): TicketRunOptions {
  if (patch === null) return {};
  return compactRunOptions({
    approvalMode:
      patch.approvalMode === null ? undefined : (patch.approvalMode ?? current?.approvalMode),
    reviewer: patch.reviewer === null ? undefined : (patch.reviewer ?? current?.reviewer),
    maxReworkRounds:
      patch.maxReworkRounds === null
        ? undefined
        : (patch.maxReworkRounds ?? current?.maxReworkRounds),
  });
}

/**
 * A ticket's branch settings after an update (ADR-0025, §10 for `from`): a value sets the field,
 * `null` puts it back to the project's, an absent field is kept; `null` for the whole patch clears
 * them all.
 */
export function patchBranchPrefs(
  current: TicketBranchPrefs | undefined,
  patch: TicketBranchPrefsPatch | null,
): TicketBranchPrefs {
  if (patch === null) return {};
  const name = patch.name === null ? undefined : (patch.name ?? current?.name);
  const target = patch.target === null ? undefined : (patch.target ?? current?.target);
  const from = patch.from === null ? undefined : (patch.from ?? current?.from);
  return {
    ...(name !== undefined && { name }),
    ...(target !== undefined && { target }),
    ...(from !== undefined && { from }),
  };
}

export function createBoardService(deps: BoardServiceDeps): BoardService {
  const { logger } = deps;
  const ws: WorkspaceRepositories = createWorkspaceRepositories(deps.db, { now: deps.now });
  const orch: OrchestrationRepositories = createOrchestrationRepositories(deps.db, {
    now: deps.now,
  });
  const redesign = createRedesignRepositories(deps.db, { now: deps.now });
  const loop = createReviewLoopRepositories(deps.db, { now: deps.now });
  /** ADR-0027: setup runs (migration 0010). */
  const harnessRepos = createHarnessRepositories(deps.db, { now: deps.now });
  /** Reads run states for the activity timeline (made on first use). */
  let runStore: RunStore | undefined;

  // ------------------------------------------------------------------ helpers

  /** ADR-0025 §9 (G-G): merging the pull request and deleting the ticket branch. */
  const branchActions = createTicketBranchActions({
    refreshPullRequest: (runId) => deps.control.refreshPullRequest(runId),
    peek: (runId) => deps.control.peek(runId),
    branchOf: (runId) => loop.ticketBranches.getByRun(runId),
    logger,
  });
  /** v0.3.0 T-A: the Tokens page's `byTicket` numbers for one ticket. */
  const ticketTokens = createTicketTokens(deps.db);

  async function branchContext(ticket: Ticket, runId: string): Promise<TicketBranchContext> {
    const p = project(ticket.projectId);
    const setup = await setupFor(ticket.projectId).catch(() => undefined);
    return { runId, projectRoot: p.rootPath, strategy: setup?.branching };
  }

  /** The DTO with `localExists` and `headOnOrigin` from local refs, when a code host is wired. */
  async function present(ticket: Ticket, dto: TicketBranchDto): Promise<TicketBranchDto> {
    if (deps.codeHost === undefined) return dto;
    return branchActions.present(deps.codeHost, project(ticket.projectId).rootPath, dto);
  }

  function project(projectId: string) {
    const p = deps.repos.projects.getById(projectId);
    if (p === undefined) throw notFound(`Project ${projectId} not found`);
    return p;
  }

  function requireCodeHost(): NonNullable<BoardServiceDeps['codeHost']> {
    if (deps.codeHost === undefined) {
      throw new HttpError(404, 'code_host_unavailable', 'Code hosting is not available here');
    }
    return deps.codeHost;
  }

  /** A code host call with its refusals as the `ErrorDto` (codes and the app's own words). */
  async function codeHostCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CodeHostError) throw codeHostHttpError(error);
      throw error;
    }
  }

  /** The ticket with its own run options (RL-H, 0007) and branch settings (ADR-0025, 0008). */
  function ticketOrThrow(ticketId: string): Ticket {
    const t = ws.tickets.getById(ticketId);
    if (t === undefined) throw notFound(`Ticket ${ticketId} not found`);
    return withRunOptions(t);
  }

  function withRunOptions(
    ticket: Ticket,
    options: TicketRunOptions | undefined = loop.ticketRunOptions.get(ticket.id),
    branch: TicketBranchPrefs | undefined = loop.ticketBranchPrefs.get(ticket.id),
  ): Ticket {
    return loop.ticketBranchPrefs.withPrefs(
      loop.ticketRunOptions.withOptions(ticket, options),
      branch,
    );
  }

  /** The project's tickets, each with its own run options and branch settings, in number order. */
  function ticketsOf(projectId: string): Ticket[] {
    const options = loop.ticketRunOptions.listForProject(projectId);
    const branches = loop.ticketBranchPrefs.listForProject(projectId);
    return ws.tickets
      .listForProject(projectId)
      .map((t) => withRunOptions(t, options.get(t.id), branches.get(t.id)));
  }

  async function setupFor(projectId: string): Promise<ProjectAgentSetup> {
    const existing = ws.projectSetup.get(projectId);
    if (existing !== undefined) return existing;
    const p = project(projectId);
    const harness = await deps.harness.status(p);
    return ensureSetup(ws, p, {
      harnessExists: harness.state === 'ready' || harness.state === 'partial',
    });
  }

  function notice(
    kind: StreamNoticeDto['kind'],
    ids: { projectId: string; ticketId?: string; runId?: string | null },
  ): void {
    deps.publish({
      kind,
      lastEventId: deps.repos.events.maxId() ?? 0,
      sessionIds: [],
      projectIds: [ids.projectId],
      ...(ids.runId !== undefined && ids.runId !== null && { runIds: [ids.runId] }),
      ...(ids.ticketId !== undefined && { ticketIds: [ids.ticketId] }),
    });
  }

  function viewOfState(state: RunState): RunView {
    const lead = state.agents.find((a) => a.kind === 'lead');
    return {
      status: state.run.status,
      pendingApprovals: state.approvals.filter((a) => a.status === 'pending').length,
      // ADR-0019: the reviewer and the tester count as helpers; ADR-0021: one waiting for its
      // change to be decided has no process.
      helpersLive: state.agents.filter(
        (a) => countsAsHelper(a.kind) && isActiveAgentStatus(a.status),
      ).length,
      budgetTokensUsed: state.agents.reduce((sum, a) => sum + a.budgetTokensUsed, 0),
      leadCostUsd: lead?.reportedCostUsd ?? null,
      updatedAt: state.run.updatedAt,
    };
  }

  /** From the live engine state when this process holds it, else from the database. */
  function runView(runId: string | null): RunView | null {
    if (runId === null) return null;
    const live = deps.control.peek(runId);
    if (live !== undefined) return viewOfState(live);
    const run = orch.runs.getById(runId);
    if (run === undefined) return null;
    const agents = orch.agentRuns.listForRun(runId);
    return {
      status: run.status,
      pendingApprovals: orch.approvals.listForRun(runId).filter((a) => a.status === 'pending')
        .length,
      helpersLive: agents.filter((a) => countsAsHelper(a.kind) && isActiveAgentStatus(a.status))
        .length,
      budgetTokensUsed: agents.reduce((sum, a) => sum + a.budgetTokensUsed, 0),
      // Reported costs are kept in memory only; after a restart they are unavailable.
      leadCostUsd: null,
      updatedAt: run.updatedAt,
    };
  }

  function stageOf(ticket: Ticket, run: RunView | null): TicketStage {
    return ticketStage({
      ticket,
      run: run === null ? null : { status: run.status, pendingApprovals: run.pendingApprovals },
    });
  }

  function toTicketDto(ticket: Ticket, run = runView(ticket.currentRunId)): TicketDto {
    // A ticket read here carries its own settings already; one from a status write gets them now.
    const full =
      ticket.runOptions === undefined || ticket.branch === undefined
        ? withRunOptions(ticket)
        : ticket;
    return { ...full, stage: stageOf(ticket, run) };
  }

  function toCard(ticket: Ticket): TicketCardDto {
    const run = runView(ticket.currentRunId);
    return {
      ...toTicketDto(ticket, run),
      activeHelpers: run?.helpersLive ?? 0,
      budgetTokensUsed: run === null ? null : run.budgetTokensUsed,
      needsYou: run === null ? 0 : run.pendingApprovals + (run.status === 'PLAN_REVIEW' ? 1 : 0),
      latestEstimatedCost:
        run === null
          ? null
          : run.leadCostUsd === null
            ? { provenance: 'unavailable', value: null }
            : { provenance: 'estimated', value: run.leadCostUsd },
      lastActivityAt: run?.updatedAt ?? null,
      lastRunOutcome:
        run === null
          ? null
          : run.status === 'FAILED'
            ? 'failed'
            : STOPPED_RUN.has(run.status)
              ? 'stopped'
              : null,
    };
  }

  /**
   * The ticket's plans, with `decidedBy: 'auto'` on each one a Full auto run approved
   * automatically (ADR-0022, from that run's snapshot).
   */
  function plansWithDeciders(ticketId: string): TicketDetailDto['plans'] {
    const plans = ws.plans.listForTicket(ticketId);
    const snapshots = new Map<string, Pick<StoredRunSnapshot, 'autoApprovedPlanId'> | null>();
    for (const runId of new Set(plans.map((p) => p.runId))) {
      snapshots.set(runId, redesign.runAudit.getRunSnapshot(runId));
    }
    return plans.flatMap((p) => withPlanDeciders([p], snapshots.get(p.runId) ?? null));
  }

  function detail(ticketId: string): TicketDetailDto {
    const ticket = ticketOrThrow(ticketId);
    const runs = orch.runs.list({ ticketId, limit: MAX_PAGE_SIZE }).map(toRunSummary);
    let currentRun: TicketDetailDto['currentRun'] = null;
    if (ticket.currentRunId !== null) {
      try {
        currentRun = deps.control.getRun(ticket.currentRunId);
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 404)) throw error;
      }
    }
    return {
      ticket: toTicketDto(ticket),
      runs,
      currentRun,
      plans: plansWithDeciders(ticketId),
      // ADR-0026: each with its kind (derived for older comments) and attachments.
      comments: toCommentDtos(
        ws.comments.listForTicket(ticketId),
        ws.attachments.listForTicket(ticketId),
      ),
      // With each result's commit (ADR-0021), so a change card shows only its own commit's.
      checks: ticket.currentRunId === null ? [] : loop.checkCommits.listForRun(ticket.currentRunId),
      // ADR-0027: the current run's setup runs (agents' worktrees and check checkouts).
      setupRuns:
        ticket.currentRunId === null ? [] : harnessRepos.setupRuns.listForRun(ticket.currentRunId),
    };
  }

  function tokensLast7Days(projectId: string): TokenCounts {
    const from = new Date(deps.now().getTime() - WEEK_MS).toISOString();
    const group = deps.queries
      .usageSummary('project', { projectId, from })
      .find((g) => g.key === projectId);
    // No records: every category is unavailable (null), never 0.
    return (
      group?.totals.tokens ?? { input: null, output: null, cacheCreation: null, cacheRead: null }
    );
  }

  function isRunOpen(ticket: Ticket): boolean {
    if (ticket.currentRunId === null) return false;
    const run = runView(ticket.currentRunId);
    return run !== null && !TERMINAL_RUN.has(run.status);
  }

  // ------------------------------------------------------------------ run start (ADR-0023)

  /**
   * Validates the graph as the editor and the PUT do, then compiles it with the run's context;
   * any error refuses the start with 409 `workflow_invalid` before the run is created.
   */
  function runnableProgram(
    graph: WorkflowGraph,
    context: CompileContext,
    setup: ProjectAgentSetup,
  ): WorkflowProgram {
    const issues = validateWorkflowGraph(graph, {
      maxConcurrentHelpers: setup.maxConcurrentHelpers,
      projectMode: context.projectMode,
    });
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) throw workflowCannotRun(errors.length, errors[0]?.message ?? '');
    try {
      return compileWorkflow(graph, context);
    } catch (error) {
      if (error instanceof WorkflowGraphInvalidError) {
        throw workflowCannotRun(error.issues.length, error.issues[0]?.message ?? '');
      }
      throw error;
    }
  }

  /** What every ticket run gets, whichever workflow it follows. */
  function runBase(
    ticket: Ticket,
    prompts: { leadPrompt: string; plannerPrompt?: string },
    limits: RunLimits,
    budget: RunBudget,
  ) {
    return {
      projectId: ticket.projectId,
      ticketId: ticket.id,
      title: `${ticket.key} ${ticket.title}`,
      leadPrompt: prompts.leadPrompt,
      ...(prompts.plannerPrompt !== undefined && { plannerPrompt: prompts.plannerPrompt }),
      limits,
      budget,
      inTransaction: (runId: string) => {
        ws.tickets.setStatus(ticket.id, 'ACTIVE', { from: [ticket.status], currentRunId: runId });
      },
    };
  }

  /**
   * ADR-0025: a ticket whose branch has a target or a source (§10; its own or the strategy's) or
   * its own name is checked before the run starts, so a missing target or source is refused now
   * (`target_branch_missing`, `source_branch_missing`), not at plan approval. A ticket with none
   * keeps the behaviour before ADR-0025 (checked at plan approval).
   */
  async function checkBranchPlan(ticket: Ticket, setup: ProjectAgentSetup): Promise<void> {
    const plan = ticketBranchPlan(setup.branching, ticket);
    if (deps.ticketBranches === undefined) return;
    if (plan.target === null && plan.source === null && ticket.branch?.name === undefined) return;
    try {
      await deps.ticketBranches.checkTicketBranchPlan(project(ticket.projectId).rootPath, plan);
    } catch (error) {
      if (error instanceof WorkspaceError) throw workspaceError(error);
      throw error;
    }
  }

  /** The ticket's current run, for its ticket branch (ADR-0021 §4, ADR-0025). */
  function currentRunOf(ticket: Ticket): string {
    if (!deps.control.enabled) throw managedDisabled();
    if (ticket.currentRunId === null) {
      throw new HttpError(409, 'no_ticket_branch', 'The ticket has no run with a ticket branch');
    }
    return ticket.currentRunId;
  }

  /** Re-read: the ticket may have moved while the setup was read. */
  function checkUnchanged(ticket: Ticket): void {
    const fresh = ticketOrThrow(ticket.id);
    if (fresh.status !== ticket.status || fresh.currentRunId !== ticket.currentRunId) {
      throw new HttpError(409, 'conflict', 'The ticket changed meanwhile; reload and try again');
    }
  }

  // ------------------------------------------------------------------ control hooks

  /** The run's stage states and reviewer posts, compared to see a stage change (ADR-0019). */
  function stageSignature(state: RunState): string {
    const stages = deriveRunWorkflow(state)
      .stages.map((st) => `${st.stage}:${st.state}:${st.agentRunIds.join('+')}`)
      .join();
    const posts = state.agents.map((a) => a.reviewPosts ?? 0).join();
    return `${stages}|${posts}`;
  }

  /** An agent's change began waiting for review in this transition. */
  function newlyPending(prev: RunState, next: RunState): boolean {
    const before = new Set(prev.agents.filter((a) => a.review === 'pending').map((a) => a.id));
    return next.agents.some((a) => a.review === 'pending' && !before.has(a.id));
  }

  const hooks: ControlWorkspaceHooks = {
    inCommit(prev, next) {
      // README §6.2: a COMPLETED run makes its ticket DONE (same transaction as the run).
      const ticketId = next.run.ticketId;
      if (ticketId === null || prev === null) return;
      if (prev.run.status === next.run.status || next.run.status !== 'COMPLETED') return;
      const ticket = ws.tickets.getById(ticketId);
      if (ticket?.status === 'ACTIVE' && ticket.currentRunId === next.run.id) {
        ws.tickets.setStatus(ticketId, 'DONE', { from: ['ACTIVE'] });
      }
    },

    afterCommit(prev, next) {
      const ticketId = next.run.ticketId;
      const runId = next.run.id;
      const status = next.run.status;
      const changed = prev === null || prev.run.status !== status;
      if (changed && status === 'REVIEW' && ticketId !== null) {
        // ADR-0021: a loop run's owner merges the ticket branch, so its tip is what gets checked
        // (a temporary detached checkout); a legacy run checks each helper's worktree.
        const tip =
          next.integration === undefined ? undefined : loop.ticketBranches.getByRun(runId);
        if (next.integration === undefined) deps.checks.runOnReview(runId);
        else if (tip !== undefined && tip.state === 'open') {
          // The ticket branch's checks (ADR-0027 §5: required and the branch block's selection);
          // those that already passed on this tip (the branch block ran there) are not rerun.
          deps.checks.startOnCommit(
            runId,
            null,
            tip.headCommit,
            () => {
              notice('tickets-changed', { projectId: next.run.projectId, ticketId, runId });
            },
            undefined,
            { skipPassed: true },
          );
        }
      }
      if (changed && (status === 'CANCELLING' || status === 'CANCELLED' || status === 'FAILED')) {
        deps.checks.abortRun(runId);
      }
      if (ticketId === null) return;
      const plansChanged =
        prev === null ||
        (prev.plans ?? []).map((p) => `${p.id}:${p.status}`).join() !==
          (next.plans ?? []).map((p) => `${p.id}:${p.status}`).join();
      const pending = (s: RunState) => s.approvals.filter((a) => a.status === 'pending').length;
      // ADR-0019: a stage's live state (the ticket page's graph) or a reviewer's post changed.
      const stagesChanged = prev === null || stageSignature(prev) !== stageSignature(next);
      if (
        changed ||
        plansChanged ||
        stagesChanged ||
        (prev !== null && pending(prev) !== pending(next))
      ) {
        notice('tickets-changed', { projectId: next.run.projectId, ticketId, runId });
      }
      // The tester's change waits for review while the run is already REVIEW: check it too.
      if (!changed && status === 'REVIEW' && prev !== null && newlyPending(prev, next)) {
        deps.checks.runOnReview(runId);
      }
    },

    agentSetup: (projectId) => deps.harness.agentSetup(projectId),
    allowlist: (projectId, policy) => deps.harness.allowlist(projectId, policy),
    reviewGate: (runId, agentRunId) => deps.checks.gate(runId, agentRunId),
    commitChecks: {
      gate: (runId, agentRunId, commit, spec) =>
        deps.checks.gateForCommit(runId, agentRunId, commit, spec),
      start: (runId, agentRunId, commit, onFinished, spec, options) =>
        deps.checks.startOnCommit(runId, agentRunId, commit, onFinished, spec, options),
    },
    setupWorktree: (input) => deps.checks.setupWorktree(input),
    // ADR-0030: the trusted harness file (the project's own checkout) for the policy gate.
    readManifest: async (projectId) => {
      const p = deps.repos.projects.getById(projectId);
      return p === undefined ? null : ((await deps.harness.read(p))?.manifest ?? null);
    },

    mergedAnyway({ runId, role, reason, failedChecks }) {
      // The owner's reason is their own text (ADR-0016): kept on the ticket, for the record.
      const ticketId = deps.control.peek(runId)?.run.ticketId ?? null;
      if (ticketId === null) return;
      const body =
        `Merged ${role}'s changes although required checks did not pass ` +
        `(${failedChecks.join(', ')}). Reason: ${reason}`;
      // ADR-0026: a decision note (Conversation), not a comment for the Comments tab.
      ws.comments.insert({
        ticketId,
        runId,
        author: 'owner',
        body: body.slice(0, 8000),
        kind: 'note',
      });
      const t = ws.tickets.getById(ticketId);
      if (t !== undefined) notice('tickets-changed', { projectId: t.projectId, ticketId, runId });
    },
  };

  // ------------------------------------------------------------------ service

  return {
    async createRepoProject(body) {
      const input = CreateRepoProjectRequestSchema.parse(body);
      const rootPath = await createRepository(
        {
          parentDir: input.parentDir,
          name: input.name,
          ...(input.readme !== undefined && { readme: input.readme }),
        },
        deps.git,
      );
      logger.log('info', 'repository created', {});
      const created = await deps.projects.register({ name: input.name, rootPath });
      // A new repository has no harness yet: checks are not pre-approved until one exists.
      ensureSetup(ws, { id: created.id, name: created.name }, { harnessExists: false });
      return created;
    },

    removeProject(projectId) {
      project(projectId);
      // ADR-0016: tickets are never deleted, so a project with tickets (or runs) stays registered.
      if (
        ws.tickets.countForProject(projectId) > 0 ||
        orch.runs.list({ projectId, limit: 1 }).length > 0
      ) {
        throw new HttpError(
          409,
          'project_has_history',
          'This project has tickets or agent runs, which are kept as history, so it stays in the app',
        );
      }
      deps.repos.projects.remove(projectId);
      notice('projects-changed', { projectId });
      logger.log('info', 'project removed', { projectId });
    },

    getSetup: setupFor,

    putSetup(projectId, body) {
      project(projectId);
      const input = UpdateProjectSetupRequestSchema.parse(body);
      // ADR-0021: a request without `approvals` keeps the stored ones (an older client, or the
      // settings form that does not edit them); a setup that never had any keeps none.
      const stored = ws.projectSetup.get(projectId);
      const approvals = input.approvals ?? stored?.approvals;
      // RL-V: `allowlist` is optional. Runs started before ADR-0021 still read it live, so a
      // request that sets only `approvals` keeps it in step with the mode (what the web sent
      // before); a request with neither keeps the stored one.
      const allowlist =
        input.allowlist ??
        (input.approvals !== undefined
          ? legacyAllowlistOf(input.approvals)
          : (stored?.allowlist ?? { editInOwnWorktree: false, runHarnessChecks: false }));
      // ADR-0025: an absent strategy keeps the stored one; `null` removes it.
      const {
        branching: branchingInput,
        setupNetwork: networkInput,
        automation: automationInput,
        ...rest
      } = input;
      const branching =
        branchingInput === undefined ? stored?.branching : (branchingInput ?? undefined);
      // ADR-0027 §2: an absent switch keeps the stored one (off when never set).
      const setupNetwork = networkInput ?? stored?.setupNetwork;
      // ADR-0030: an absent policy keeps the stored one; `null` resets it to the defaults.
      const automation =
        automationInput === undefined ? stored?.automation : (automationInput ?? undefined);
      try {
        const saved = ws.projectSetup.upsert({
          projectId,
          planFirst: true,
          ...rest,
          allowlist,
          ...(approvals !== undefined && { approvals }),
          ...(branching !== undefined && { branching }),
          ...(setupNetwork !== undefined && { setupNetwork }),
          ...(automation !== undefined && { automation }),
        });
        notice('projects-changed', { projectId });
        return saved;
      } catch (error) {
        throw dbConflict(error, 'Another project already uses this project key') ?? error;
      }
    },

    mainSetupHistory: (projectId, limit = 50) => deps.checks.mainSetupHistory(projectId, limit),

    mainCheckHistory(projectId, limit = 50) {
      project(projectId); // 404 for an unknown project
      return ws.checkRuns.listForProjectMain(projectId, { limit });
    },

    async harnessStatus(projectId) {
      return deps.harness.status(project(projectId), { fresh: true });
    },

    runMainChecks: (projectId) => deps.checks.runOnMain(projectId),

    async createHarnessTicket(projectId) {
      await setupFor(projectId);
      const t = HARNESS_TICKET_TEMPLATE;
      const ticket = ws.tickets.insert({
        projectId,
        title: t.title,
        description: t.description,
        type: t.type,
        priority: t.priority,
        labels: [...t.labels],
      });
      notice('tickets-changed', { projectId, ticketId: ticket.id });
      return toTicketDto(ticket);
    },

    async contextCandidates(projectId) {
      const p = project(projectId);
      try {
        return await listContextCandidates(p.rootPath, { git: deps.git });
      } catch (error) {
        if (error instanceof HarnessError) throw harnessError(error);
        throw error;
      }
    },

    async board(projectId) {
      const dto = deps.projects.get(projectId);
      const setup = await setupFor(projectId);
      const harness = await deps.harness.status(project(projectId));
      const cards = ticketsOf(projectId).map(toCard);
      const columns = TICKET_STAGES.map((stage) => ({
        stage,
        tickets: cards.filter((c) => c.stage === stage),
      }));
      const runningRuns = cards.filter((c) => {
        const run = runView(c.currentRunId);
        return c.status === 'ACTIVE' && run !== null && RUNNING_RUN.has(run.status);
      }).length;
      return {
        project: dto,
        projectKey: setup.projectKey,
        harness,
        stats: {
          tokensLast7Days: tokensLast7Days(projectId),
          runningRuns,
          needsYou: cards.reduce((n, c) => n + c.needsYou, 0),
        },
        columns,
      };
    },

    listTickets(projectId) {
      project(projectId);
      return ticketsOf(projectId).map(toCard);
    },

    async createTicket(projectId, body) {
      project(projectId);
      const input = CreateTicketRequestSchema.parse(body);
      await setupFor(projectId);
      // RL-H, ADR-0025: the ticket, its own run options and branch settings are stored together.
      const ticket = loop.ticketBranchPrefs.insert({ projectId, ...input });
      notice('tickets-changed', { projectId, ticketId: ticket.id });
      return toTicketDto(ticket);
    },

    ticket: detail,

    updateTicket(ticketId, body) {
      const current = ticketOrThrow(ticketId);
      const input = UpdateTicketRequestSchema.parse(body);
      withTransaction(deps.db, () => {
        ws.tickets.update(ticketId, {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.labels !== undefined && { labels: input.labels }),
        });
        // RL-H: only future runs see the change; a started run keeps its snapshot.
        if (input.runOptions !== undefined) {
          loop.ticketRunOptions.set(
            ticketId,
            patchRunOptions(current.runOptions, input.runOptions),
          );
        }
        // ADR-0025: only branches made later see the change; an existing ticket branch keeps its
        // name, target and source.
        if (input.branch !== undefined) {
          loop.ticketBranchPrefs.set(ticketId, patchBranchPrefs(current.branch, input.branch));
        }
      });
      notice('tickets-changed', { projectId: current.projectId, ticketId });
      return detail(ticketId);
    },

    moveTicket(ticketId, body) {
      const ticket = ticketOrThrow(ticketId);
      const { status } = MoveTicketRequestSchema.parse(body);
      if (ticket.status === status) return toTicketDto(ticket);
      if (ticket.status === 'DONE') {
        throw new HttpError(
          409,
          'ticket_done',
          'A done ticket stays done; re-run it to work on it again',
        );
      }
      if (status === 'CANCELLED') {
        if (isRunOpen(ticket) && ticket.currentRunId !== null) {
          if (!deps.control.enabled) throw managedDisabled();
          // Cancelling a ticket stops its run (Stop all), deepest agents first.
          deps.control.stopRun(ticket.currentRunId);
        }
      } else if (isRunOpen(ticket)) {
        throw new HttpError(
          409,
          'run_in_progress',
          'The ticket has a run in progress; stop it first',
        );
      }
      let moved: Ticket | undefined;
      try {
        moved = ws.tickets.setStatus(ticketId, status, { from: [ticket.status] });
      } catch (error) {
        throw dbConflict(error, 'The ticket changed meanwhile; reload and try again') ?? error;
      }
      if (moved === undefined) throw notFound(`Ticket ${ticketId} not found`);
      notice('tickets-changed', {
        projectId: ticket.projectId,
        ticketId,
        runId: ticket.currentRunId,
      });
      return toTicketDto(moved);
    },

    async startTicket(ticketId, body) {
      // ADR-0021 §1, §3: per-run overrides; an empty or missing body uses the project's settings.
      const options = StartTicketRequestSchema.parse(body ?? {});
      const ticket = ticketOrThrow(ticketId);
      if (!deps.control.enabled) throw managedDisabled();
      if (ticket.status === 'BACKLOG') {
        throw new HttpError(409, 'ticket_not_ready', 'Move the ticket to Ready before starting it');
      }
      if (ticket.status === 'ACTIVE' && isRunOpen(ticket)) {
        throw new HttpError(409, 'run_in_progress', 'The ticket already has a run in progress');
      }
      const setup = await setupFor(ticket.projectId);
      if (deps.legacyTicketRuns !== true) await checkBranchPlan(ticket, setup);
      const { limits, budget } = runSettingsFromSetup(setup);
      // Snapshotted with the run: later project changes never reach it (ADR-0021 §1).
      const projectApprovals = approvalsOf(setup);
      // ADR-0023: the project's graph (stored, or its version 1 workflow migrated), snapshotted.
      const stored = redesign.workflow.stored(ticket.projectId);
      if (stored === undefined) throw notFound(`Project ${ticket.projectId} not found`);
      const workflow = effectiveWorkflow(stored, projectApprovals.mode);
      const legacy = deps.legacyTicketRuns === true;
      const runOptions = compactRunOptions(options);
      // RL-H: the one-run override wins over the ticket's own options, which win over the
      // project's settings, for the reviewer and the rounds. The command allowlist is always the
      // project's.
      const effective = resolveRunOptions(
        projectRunDefaults(workflow, projectApprovals.mode),
        ticket.runOptions,
        runOptions,
      );
      const reviewLoop = {
        ticketKey: ticket.key,
        reviewer: effective.options.reviewer,
        maxReworkRounds: effective.options.maxReworkRounds,
      };
      let run: RunDetailDto;
      if (legacy && workflow.v1 !== undefined) {
        // Tests only: a version 1 project's legacy run stays exactly as before ADR-0021.
        const prompts = ticketRunPrompts(ticket, limits, workflow.v1, { fullAuto: false });
        checkUnchanged(ticket);
        run = deps.control.createTicketRun({
          ...runBase(ticket, prompts, limits, budget),
          workflow: workflow.v1,
        });
      } else {
        // ADR-0023 §5, refinements 5 and 7: the ticket's and the run's modes are ceilings (each
        // only when set) that can only tighten a node; the reviewer and rounds overrides apply
        // only when the ticket or the run sets them.
        const approvalCeilings = [ticket.runOptions?.approvalMode, runOptions.approvalMode].filter(
          (m) => m !== undefined,
        );
        const graphContext: CompileContext = {
          projectMode: projectApprovals.mode,
          approvalCeilings,
          maxConcurrentHelpers: limits.maxConcurrentHelpers,
          ...(effective.source.reviewer !== 'project' && { reviewer: effective.options.reviewer }),
          ...(effective.source.maxReworkRounds !== 'project' && {
            maxReworkRounds: effective.options.maxReworkRounds,
          }),
        };
        const program = runnableProgram(workflow.graph, graphContext, setup);
        // The run's own mode: the project's, tightened. The engine falls back to it for an agent
        // it cannot map to a node, so that fallback is never looser than the ceilings.
        const approvals = {
          mode: tightenMode(null, projectApprovals.mode, ...approvalCeilings).mode,
          commands: projectApprovals.commands,
        };
        const prompts = ticketRunPrompts(
          ticket,
          limits,
          { plannerMode: program.planner === null ? 'lead' : 'separate' },
          // ADR-0022, ADR-0023 §6: the briefs say so when the plan gate approves at once.
          { fullAuto: program.planAutoApprove },
        );
        checkUnchanged(ticket);
        run = deps.control.createTicketRun({
          ...runBase(ticket, prompts, limits, budget),
          // A version 1 project's runs keep its workflow too, for the version 1 live view.
          ...(workflow.v1 !== undefined && { workflow: workflow.v1 }),
          graph: workflow.graph,
          graphContext,
          ...(!legacy && { reviewLoop, approvals }),
        });
      }
      notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId: run.id });
      logger.log('info', 'ticket started', {
        ticketId,
        runId: run.id,
        approvalMode: legacy ? null : (run.approvalMode ?? null),
        reviewer: legacy ? null : reviewLoop.reviewer,
        // Where each came from (run, ticket or project, RL-H): enum words only, no free text.
        approvalModeFrom: legacy ? null : effective.source.approvalMode,
        reviewerFrom: legacy ? null : effective.source.reviewer,
        maxReworkRoundsFrom: legacy ? null : effective.source.maxReworkRounds,
        workflow: workflow.stored,
      });
      return detail(ticketId);
    },

    addComment(ticketId, body) {
      const ticket = ticketOrThrow(ticketId);
      const input = TicketCommentRequestSchema.parse(body);
      // ADR-0026 §4: files uploaded first are attached with the comment, all or none.
      const ids = input.attachmentIds ?? [];
      let added;
      try {
        added = withTransaction(deps.db, () => {
          const stored = ws.comments.insert({
            ticketId,
            author: 'owner',
            body: input.body,
            kind: input.kind ?? 'comment',
          });
          return {
            comment: stored,
            attachments:
              ids.length === 0 ? [] : ws.attachments.attachToComment(ticketId, stored.id, ids),
          };
        });
      } catch (error) {
        throw attachmentDbError(error) ?? error;
      }
      const { comment, attachments } = added;
      notice('tickets-changed', { projectId: ticket.projectId, ticketId });
      return toCommentDto(comment, attachments);
    },

    activity(ticketId) {
      const ticket = ticketOrThrow(ticketId);
      runStore ??= createRunStore({ db: deps.db, now: deps.now });
      const store = runStore;
      const runs = orch.runs
        .list({ ticketId, limit: MAX_PAGE_SIZE })
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        .map((run) => {
          let state: RunState | undefined;
          try {
            state = deps.control.peek(run.id) ?? store.load(run.id);
          } catch (error) {
            // A run the engine cannot rebuild still shows, with role words for its agents.
            logger.log('warn', 'activity: run state unavailable', {
              runId: run.id,
              ...errorFields(error),
            });
          }
          return {
            run,
            state,
            reviews: loop.changeReviews.listForRun(run.id),
            branch: loop.ticketBranches.getByRun(run.id),
            workspaces: orch.workspaces.listForRun(run.id),
          };
        });
      return buildTicketActivity({
        ticketId,
        ticketKey: ticket.key,
        runs,
        plans: plansWithDeciders(ticketId),
        comments: ws.comments.listForTicket(ticketId),
      });
    },

    async uploadAttachment(ticketId, input) {
      const ticket = ticketOrThrow(ticketId);
      const mimeType = allowedMimeType(input.contentType);
      if (mimeType === null) {
        throw new HttpError(
          415,
          'attachment_type_not_allowed',
          'This file type cannot be attached (images, text, Markdown, CSV, JSON, PDF, zip or gzip)',
        );
      }
      const name = attachmentName(input.name);
      const bytes = input.bytes;
      if (bytes.byteLength === 0) throw new HttpError(400, 'empty_attachment', 'The file is empty');
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new HttpError(413, 'payload_too_large', 'Request body is too large');
      }
      if (!contentMatches(mimeType, bytes)) {
        throw new HttpError(
          415,
          'attachment_content_mismatch',
          `The file's content is not ${mimeType}`,
        );
      }
      if (ws.attachments.countForTicket(ticketId) >= MAX_ATTACHMENTS_PER_TICKET) {
        throw new HttpError(
          409,
          'attachment_conflict',
          `A ticket has at most ${MAX_ATTACHMENTS_PER_TICKET} attachments`,
        );
      }
      const commentId = input.commentId ?? null;
      if (commentId !== null && ws.comments.getById(commentId)?.ticketId !== ticketId) {
        throw new HttpError(404, 'comment_not_found', 'No such comment on this ticket');
      }
      const sha256 = sha256Of(bytes);
      const files = deps.control.attachmentFiles;
      await files.put(sha256, bytes);
      let stored: Attachment;
      try {
        stored = ws.attachments.insert({
          ticketId,
          commentId,
          name,
          mimeType,
          sizeBytes: bytes.byteLength,
          sha256,
        });
      } catch (error) {
        if (ws.attachments.countBySha256(sha256) === 0) await files.remove(sha256);
        throw attachmentDbError(error) ?? error;
      }
      // Sizes and types only: never the name or the content.
      logger.log('info', 'attachment stored', { ticketId, sizeBytes: stored.sizeBytes });
      notice('tickets-changed', { projectId: ticket.projectId, ticketId });
      return toAttachmentDto(stored);
    },

    listAttachments(ticketId) {
      ticketOrThrow(ticketId);
      return ws.attachments.listForTicket(ticketId).map(toAttachmentDto);
    },

    attachmentContent(id) {
      const attachment = ws.attachments.getById(id);
      if (attachment === undefined) {
        throw new HttpError(404, 'attachment_not_found', `Attachment ${id} not found`);
      }
      return { attachment, path: deps.control.attachmentFiles.pathOf(attachment.sha256) };
    },

    async deleteAttachment(id) {
      const removed = ws.attachments.delete(id);
      if (removed === undefined) {
        throw new HttpError(404, 'attachment_not_found', `Attachment ${id} not found`);
      }
      // Content-addressed: the file goes once no row points at it.
      if (ws.attachments.countBySha256(removed.sha256) === 0) {
        await deps.control.attachmentFiles.remove(removed.sha256);
      }
      const ticket = ws.tickets.getById(removed.ticketId);
      if (ticket !== undefined) {
        notice('tickets-changed', { projectId: ticket.projectId, ticketId: ticket.id });
      }
    },

    decidePlan(ticketId, planId, body) {
      const ticket = ticketOrThrow(ticketId);
      const input = PlanDecisionRequestSchema.parse(body);
      const plan = ws.plans.getById(planId);
      if (plan === undefined || plan.ticketId !== ticketId) {
        throw new HttpError(404, 'plan_not_found', `Plan ${planId} not found on this ticket`);
      }
      if (!deps.control.enabled) throw managedDisabled();
      deps.control.decidePlan(plan.runId, planId, input.decision, input.comment);
      // The engine only sends the comment to the lead; it is kept on the ticket (ADR-0016).
      if (input.comment !== undefined) {
        ws.comments.insert({
          ticketId,
          planId,
          author: 'owner',
          body: input.comment,
          kind: 'comment',
        });
      }
      notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId: plan.runId });
      return detail(ticketId);
    },

    runChecks(runId) {
      if (orch.runs.getById(runId) === undefined) throw notFound(`Run ${runId} not found`);
      return loop.checkCommits.listForRun(runId);
    },

    runAgentChecks: (runId, agentRunId) => deps.checks.runForAgent(runId, agentRunId),

    async codeHostStatus(projectId) {
      const p = project(projectId);
      return requireCodeHost().status(p.rootPath);
    },

    async createCodeHostRepository(projectId, body) {
      const p = project(projectId);
      const host = requireCodeHost();
      const input = CreateRepositoryRequestSchema.parse(body);
      return codeHostCall(() => host.createRepository(p.rootPath, input));
    },

    async connectCodeHostRepository(projectId, body) {
      const p = project(projectId);
      const host = requireCodeHost();
      const { repository } = ConnectRepositoryRequestSchema.parse(body);
      return codeHostCall(() => host.connectRepository(p.rootPath, repository));
    },

    async projectBranches(projectId) {
      const p = project(projectId);
      const host = requireCodeHost();
      return codeHostCall(() => host.branches(p.rootPath));
    },

    async createProjectBranch(projectId, body) {
      const p = project(projectId);
      const host = requireCodeHost();
      const input = CreateBranchRequestSchema.parse(body);
      return codeHostCall(() => host.createBranch(p.rootPath, input));
    },

    async openPullRequest(ticketId, body) {
      const ticket = ticketOrThrow(ticketId);
      const runId = currentRunOf(ticket);
      const dto = await deps.control.openPullRequest(runId, body, ticket);
      notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId });
      return present(ticket, dto);
    },

    async refreshPullRequest(ticketId) {
      const ticket = ticketOrThrow(ticketId);
      const runId = currentRunOf(ticket);
      const dto = await deps.control.refreshPullRequest(runId);
      notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId });
      return present(ticket, dto);
    },

    async mergePullRequest(ticketId, body) {
      const ticket = ticketOrThrow(ticketId);
      const runId = currentRunOf(ticket);
      const host = requireCodeHost();
      try {
        return await branchActions.merge(host, await branchContext(ticket, runId), body);
      } finally {
        // Also after a refusal: GitHub may have merged it, and Refresh shows what happened.
        notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId });
      }
    },

    async deleteTicketBranch(ticketId, body) {
      const ticket = ticketOrThrow(ticketId);
      const runId = currentRunOf(ticket);
      const host = requireCodeHost();
      try {
        return await branchActions.remove(host, await branchContext(ticket, runId), body);
      } finally {
        notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId });
      }
    },

    ticketTotals(ticketId) {
      const ticket = ticketOrThrow(ticketId);
      const usage = ticketTokens(ticket.projectId, ticket.id);
      if (usage === undefined) throw notFound(`Project ${ticket.projectId} not found`);
      return buildTicketTotals({
        ticket,
        runs: orch.runs.list({ ticketId, limit: MAX_PAGE_SIZE }),
        usage,
        now: deps.now(),
      });
    },

    controlHooks: () => hooks,
  };
}
