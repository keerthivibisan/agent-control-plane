import {
  HARNESS_TICKET_TEMPLATE,
  TICKET_STAGES,
  approvalsOf,
  reviewStageOf,
  ticketStage,
  type CheckRun,
  type ProjectAgentSetup,
  type RunStatus,
  type Ticket,
  type TicketStage,
  type TokenCounts,
} from '@acp/core';
import {
  CreateRepoProjectRequestSchema,
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
  type StreamNoticeDto,
  type TicketCardDto,
  type TicketCommentDto,
  type TicketDetailDto,
  type TicketDto,
} from '@acp/core/api';
import {
  MAX_PAGE_SIZE,
  createOrchestrationRepositories,
  createRedesignRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  type AcpDatabase,
  type OrchestrationRepositories,
  type Queries,
  type Repositories,
  type WorkspaceRepositories,
} from '@acp/db';
import {
  deriveRunWorkflow,
  isActiveAgentStatus,
  runSettingsFromSetup,
  ticketRunPrompts,
  type RunState,
} from '@acp/orchestrator';
import { managedDisabled } from '../control/errors.js';
import { toRunSummary } from '../control/mappers.js';
import { countsAsHelper } from '../control/roles.js';
import type { ControlService, ControlWorkspaceHooks } from '../control/service.js';
import { HttpError, notFound } from '../errors.js';
import { HarnessError, listContextCandidates } from '../harness/index.js';
import type { Logger } from '../logger.js';
import type { ProjectsService } from '../services/projects.js';
import type { GitRunner } from '../workspace/index.js';
import type { CheckService } from './checks.js';
import { createRepository } from './create-repo.js';
import { dbConflict, harnessError } from './errors.js';
import type { ProjectHarness } from './harness.js';
import { ensureSetup, legacyAllowlistOf } from './setup.js';

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
  decidePlan(ticketId: string, planId: string, body: unknown): TicketDetailDto;
  runChecks(runId: string): CheckRun[];
  runAgentChecks(runId: string, agentRunId: string): Promise<CheckRun[]>;
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

export function createBoardService(deps: BoardServiceDeps): BoardService {
  const { logger } = deps;
  const ws: WorkspaceRepositories = createWorkspaceRepositories(deps.db, { now: deps.now });
  const orch: OrchestrationRepositories = createOrchestrationRepositories(deps.db, {
    now: deps.now,
  });
  const redesign = createRedesignRepositories(deps.db, { now: deps.now });
  const loop = createReviewLoopRepositories(deps.db, { now: deps.now });

  // ------------------------------------------------------------------ helpers

  function project(projectId: string) {
    const p = deps.repos.projects.getById(projectId);
    if (p === undefined) throw notFound(`Project ${projectId} not found`);
    return p;
  }

  function ticketOrThrow(ticketId: string): Ticket {
    const t = ws.tickets.getById(ticketId);
    if (t === undefined) throw notFound(`Ticket ${ticketId} not found`);
    return t;
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
    return { ...ticket, stage: stageOf(ticket, run) };
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
      plans: ws.plans.listForTicket(ticketId),
      comments: ws.comments.listForTicket(ticketId),
      // With each result's commit (ADR-0021), so a change card shows only its own commit's.
      checks: ticket.currentRunId === null ? [] : loop.checkCommits.listForRun(ticket.currentRunId),
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
          deps.checks.startOnCommit(runId, null, tip.headCommit, () => {
            notice('tickets-changed', { projectId: next.run.projectId, ticketId, runId });
          });
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
      gate: (runId, agentRunId, commit) => deps.checks.gateForCommit(runId, agentRunId, commit),
      start: (runId, agentRunId, commit, onFinished) =>
        deps.checks.startOnCommit(runId, agentRunId, commit, onFinished),
    },

    mergedAnyway({ runId, role, reason, failedChecks }) {
      // The owner's reason is their own text (ADR-0016): kept on the ticket, for the record.
      const ticketId = deps.control.peek(runId)?.run.ticketId ?? null;
      if (ticketId === null) return;
      const body =
        `Merged ${role}'s changes although required checks did not pass ` +
        `(${failedChecks.join(', ')}). Reason: ${reason}`;
      ws.comments.insert({ ticketId, runId, author: 'owner', body: body.slice(0, 8000) });
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
      try {
        const saved = ws.projectSetup.upsert({
          projectId,
          planFirst: true,
          ...input,
          allowlist,
          ...(approvals !== undefined && { approvals }),
        });
        notice('projects-changed', { projectId });
        return saved;
      } catch (error) {
        throw dbConflict(error, 'Another project already uses this project key') ?? error;
      }
    },

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
      const cards = ws.tickets.listForProject(projectId).map(toCard);
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
      return ws.tickets.listForProject(projectId).map(toCard);
    },

    async createTicket(projectId, body) {
      project(projectId);
      const input = CreateTicketRequestSchema.parse(body);
      await setupFor(projectId);
      const ticket = ws.tickets.insert({ projectId, ...input });
      notice('tickets-changed', { projectId, ticketId: ticket.id });
      return toTicketDto(ticket);
    },

    ticket: detail,

    updateTicket(ticketId, body) {
      const current = ticketOrThrow(ticketId);
      const input = UpdateTicketRequestSchema.parse(body);
      ws.tickets.update(ticketId, {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.labels !== undefined && { labels: input.labels }),
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
      const { limits, budget } = runSettingsFromSetup(setup);
      // ADR-0019: the project's workflow (the default until the owner saves one), snapshotted.
      const workflow = redesign.workflow.get(ticket.projectId);
      if (workflow === undefined) throw notFound(`Project ${ticket.projectId} not found`);
      const prompts = ticketRunPrompts(ticket, limits, workflow);
      // Snapshotted with the run: later project changes never reach it (ADR-0021 §1).
      const projectApprovals = approvalsOf(setup);
      const approvals = {
        mode: options.approvalMode ?? projectApprovals.mode,
        commands: projectApprovals.commands,
      };
      const reviewStage = reviewStageOf(workflow);
      const reviewLoop = {
        ticketKey: ticket.key,
        reviewer: options.reviewer ?? reviewStage.reviewer,
        maxReworkRounds: options.maxReworkRounds ?? reviewStage.maxReworkRounds,
      };
      const legacy = deps.legacyTicketRuns === true;
      // Re-read: the ticket may have moved while the setup was read.
      const fresh = ticketOrThrow(ticketId);
      if (fresh.status !== ticket.status || fresh.currentRunId !== ticket.currentRunId) {
        throw new HttpError(409, 'conflict', 'The ticket changed meanwhile; reload and try again');
      }
      const run = deps.control.createTicketRun({
        projectId: ticket.projectId,
        ticketId,
        title: `${ticket.key} ${ticket.title}`,
        leadPrompt: prompts.leadPrompt,
        ...(prompts.plannerPrompt !== undefined && { plannerPrompt: prompts.plannerPrompt }),
        workflow,
        limits,
        budget,
        ...(!legacy && { reviewLoop, approvals }),
        inTransaction: (runId) => {
          ws.tickets.setStatus(ticketId, 'ACTIVE', { from: [ticket.status], currentRunId: runId });
        },
      });
      notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId: run.id });
      logger.log('info', 'ticket started', {
        ticketId,
        runId: run.id,
        approvalMode: legacy ? null : approvals.mode,
        reviewer: legacy ? null : reviewLoop.reviewer,
      });
      return detail(ticketId);
    },

    addComment(ticketId, body) {
      const ticket = ticketOrThrow(ticketId);
      const input = TicketCommentRequestSchema.parse(body);
      const comment = ws.comments.insert({ ticketId, author: 'owner', body: input.body });
      notice('tickets-changed', { projectId: ticket.projectId, ticketId });
      return comment;
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
        ws.comments.insert({ ticketId, planId, author: 'owner', body: input.comment });
      }
      notice('tickets-changed', { projectId: ticket.projectId, ticketId, runId: plan.runId });
      return detail(ticketId);
    },

    runChecks(runId) {
      if (orch.runs.getById(runId) === undefined) throw notFound(`Run ${runId} not found`);
      return loop.checkCommits.listForRun(runId);
    },

    runAgentChecks: (runId, agentRunId) => deps.checks.runForAgent(runId, agentRunId),

    controlHooks: () => hooks,
  };
}
