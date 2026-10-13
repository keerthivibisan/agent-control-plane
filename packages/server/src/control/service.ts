import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  APPROVAL_TIMEOUT_MS,
  isPathInside,
  type ManagedAgentEvent,
  type ManagedAgentHandle,
  type ManagedExecutionAdapter,
  type PermissionDecision,
  type PermissionRequest,
  type RegisteredRoot,
  type RunStatus,
} from '@acp/core';
import {
  ApprovalDecisionRequestSchema,
  ChatRequestSchema,
  ReviewActionRequestSchema,
  StartRunRequestSchema,
  type AgentRunDto,
  type ApprovalDto,
  type ChatMessageDto,
  type ReviewDto,
  type RunDetailDto,
  type RunSummaryDto,
  type StreamNoticeDto,
} from '@acp/core/api';
import { MAX_PAGE_SIZE, type AcpDatabase, type Repositories, type WorkspaceRow } from '@acp/db';
import {
  agentEvent,
  cancelRun,
  checkReviewAction,
  completeCancellation,
  createRun,
  decideApproval,
  expireApprovals,
  isApprovalOverdue,
  isLiveAgentStatus,
  isRunPastDeadline,
  leadToolCall,
  ownerChat,
  recordReview,
  recoverAfterRestart,
  requestPermission,
  stopAgent,
  timeOutRun,
  type EngineContext,
  type EngineEffect,
  type EngineResult,
  type Refusal,
  type RunState,
} from '@acp/orchestrator';
import { HttpError, notFound } from '../errors.js';
import { errorFields, type Logger } from '../logger.js';
import {
  WorkspaceError,
  type GitRunner,
  type Workspace,
  type WorkspaceManager,
} from '../workspace/index.js';
import { createCsrfToken } from './csrf.js';
import { refusalError, workspaceError } from './errors.js';
import {
  summaryOf,
  toAgentDto,
  toApprovalDto,
  toChatMessageDto,
  toRunDetail,
  toRunSummary,
} from './mappers.js';
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
  'RUNNING',
  'BLOCKED',
  'REVIEW',
  'CANCELLING',
  'NEEDS_REVIEW',
];
/** Run states the run timeout applies to; a run under review waits for the owner. */
const WORKING: readonly RunStatus[] = ['QUEUED', 'RUNNING', 'BLOCKED'];

export const DEFAULT_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
/** Stop all: abort, then give the processes this long before the run is marked cancelled anyway. */
const DEFAULT_CANCEL_GRACE_MS = 10_000;

export const LEAD_READ_ONLY_MESSAGE =
  'The lead agent works read-only in the project. Start a worker agent to change files or run commands.';

export interface ControlServiceDeps {
  db: AcpDatabase;
  repos: Repositories;
  /** The managed adapter; undefined when managed execution is off. */
  adapter: ManagedExecutionAdapter | undefined;
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
  /** Interval of the approval-expiry / run-timeout sweep; null disables the timer (tests). */
  sweepIntervalMs?: number | null;
  /** Ingests what is on disk now; awaited before a worker's worktree is removed. */
  flushIngestion?: () => Promise<void>;
  newId?: () => string;
  csrfToken?: string;
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
  /** Merge or discard one worker's changes; returns the updated review. */
  reviewAction(runId: string, body: unknown): Promise<ReviewDto>;
  /** Active worktrees as extra roots of their run's project (scheduler and pipeline). */
  extraRoots(): RegisteredRoot[];
  /** True for paths under the managed worktrees directory (never offered as a new project). */
  isManagedPath(cwd: string): boolean;
  /** Expires overdue approvals, times out runs and finishes stuck cancellations. */
  sweep(): void;
  /** Tests: resolves when no worker start, send or pump step is in flight. */
  idle(): Promise<void>;
  counters(): ControlCounters;
}

interface LiveRun {
  state: RunState;
  handles: Map<string, ManagedAgentHandle>;
  /** Workers whose worktree is being created. */
  starting: Set<string>;
  /** Messages for workers that are still starting. */
  pendingSends: Map<string, string[]>;
  /** Workspaces created by this process. */
  workspaces: Map<string, Workspace>;
  cancellingSince: number | null;
}

type Applied<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

export function createControlService(deps: ControlServiceDeps): ControlService {
  const { logger } = deps;
  const store: RunStore = createRunStore({ db: deps.db, now: deps.now });
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

  const worktreesDirs = (() => {
    const dir = join(deps.dataDir, 'worktrees');
    const dirs = [dir];
    try {
      const real = join(realpathSync(deps.dataDir), 'worktrees');
      if (real !== dir) dirs.push(real);
    } catch {
      // The data dir does not exist yet; the plain path is enough.
    }
    return dirs;
  })();

  const ctx = (): EngineContext => ({ now: deps.now(), newId });

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
      pendingSends: new Map(),
      workspaces: new Map(),
      cancellingSince: state.run.status === 'CANCELLING' ? deps.now().getTime() : null,
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
    store.commit(prev, result.state, result.effects);
    live.state = result.state;
    notify('runs-changed', live);
    if (result.effects.some((e) => e.type === 'chat-message')) notify('chat-message', live);
    perform(live, result.effects);
    afterTransition(live, prev);
    return { ok: true, value: result.value };
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
    for (const effect of effects) {
      switch (effect.type) {
        case 'start-agent':
          startAgent(live, effect);
          break;
        case 'send-to-agent':
          sendTo(live, effect.agentRunId, effect.text);
          break;
        case 'interrupt-agent': {
          const handle = live.handles.get(effect.agentRunId);
          // Not awaited: the turn may be parked in a permission callback another effect resolves.
          if (handle !== undefined) track(handle.interrupt());
          break;
        }
        case 'abort-agent': {
          live.pendingSends.delete(effect.agentRunId);
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
    }
    if (status !== prev.run.status) {
      logger.log('info', 'run status changed', { runId: live.state.run.id, status });
    }
  }

  function maybeCompleteCancellation(live: LiveRun): void {
    if (closed || live.state.run.status !== 'CANCELLING') return;
    if (live.handles.size > 0 || live.starting.size > 0) return;
    apply(live, completeCancellation);
    live.cancellingSince = null;
  }

  /** A worker that never got a worktree has nothing to review: record that, not a fake diff. */
  function resolveEmptyReviews(live: LiveRun): void {
    if (closed || live.state.run.status !== 'REVIEW') return;
    for (const agent of live.state.agents) {
      if (agent.kind !== 'worker' || agent.review !== 'pending') continue;
      if (live.starting.has(agent.id) || live.workspaces.has(agent.id)) continue;
      if (store.repos.workspaces.getByAgentRun(agent.id) !== undefined) continue;
      apply(live, (s, c) => recordReview(s, agent.id, 'no-changes', c));
    }
  }

  function endWithError(live: LiveRun, agentRunId: string): void {
    const finished: ManagedAgentEvent = {
      type: 'finished',
      outcome: 'error',
      reportedCostUsd: null,
    };
    defer(() => {
      apply(live, (s, c) => agentEvent(s, agentRunId, finished, c));
      maybeCompleteCancellation(live);
    });
  }

  function startAgent(live: LiveRun, effect: Extract<EngineEffect, { type: 'start-agent' }>): void {
    const runId = live.state.run.id;
    const agentRunId = effect.agentRunId;
    const project = deps.repos.projects.getById(live.state.run.projectId);
    if (project === undefined || deps.adapter === undefined) {
      logger.log('warn', 'agent start failed', { runId, agentRunId, code: 'unavailable' });
      endWithError(live, agentRunId);
      return;
    }
    if (effect.kind === 'lead') {
      // The lead reads the owner's project in place; every change goes through a worker.
      launch(live, agentRunId, 'lead', project.rootPath, effect.prompt);
      return;
    }

    live.starting.add(agentRunId);
    track(
      (async () => {
        let ws: Workspace;
        try {
          ws = await deps.workspaces.create(project.rootPath, runId, agentRunId);
        } catch (error) {
          live.starting.delete(agentRunId);
          live.pendingSends.delete(agentRunId);
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
          live.pendingSends.delete(agentRunId);
          endWithError(live, agentRunId);
          return;
        }
        live.workspaces.set(agentRunId, ws);
        live.starting.delete(agentRunId);
        const agent = live.state.agents.find((a) => a.id === agentRunId);
        if (closed || agent?.status !== 'STARTING') {
          // Stopped while its worktree was being made; the worktree stays for review or discard.
          live.pendingSends.delete(agentRunId);
          defer(() => maybeCompleteCancellation(live));
          return;
        }
        launch(live, agentRunId, 'worker', ws.cwd, effect.prompt);
      })(),
    );
  }

  function launch(
    live: LiveRun,
    agentRunId: string,
    kind: 'lead' | 'worker',
    cwd: string,
    prompt: string,
  ): void {
    const runId = live.state.run.id;
    const adapter = deps.adapter;
    if (adapter === undefined) {
      endWithError(live, agentRunId);
      return;
    }
    let handle: ManagedAgentHandle;
    try {
      handle = adapter.start(
        {
          agentRunId,
          kind,
          cwd,
          prompt,
          model: null,
          ...(kind === 'lead' && {
            // A refusal rejects the promise; the adapter returns it to the model as a tool error.
            leadTools: (name, input) =>
              new Promise<string>((resolve) => resolve(leadTool(live, agentRunId, name, input))),
          }),
        },
        { requestPermission: (request) => askOwner(live, agentRunId, kind, request) },
      );
    } catch (error) {
      logger.log('warn', 'agent start failed', { runId, agentRunId, ...errorFields(error) });
      endWithError(live, agentRunId);
      return;
    }
    live.handles.set(agentRunId, handle);
    logger.log('info', 'agent started', { runId, agentRunId, kind });
    const queued = live.pendingSends.get(agentRunId);
    live.pendingSends.delete(agentRunId);
    for (const text of queued ?? []) sendTo(live, agentRunId, text);
    const pumping = pump(live, agentRunId, handle).catch((error: unknown) => {
      logger.log('error', 'agent pump failed', errorFields(error));
    });
    pumps.add(pumping);
    void pumping.finally(() => pumps.delete(pumping));
  }

  async function pump(live: LiveRun, agentRunId: string, handle: ManagedAgentHandle) {
    const runId = live.state.run.id;
    try {
      for await (const event of handle.events) {
        if (closed) break;
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
    live.handles.delete(agentRunId);
    if (closed) return;
    const agent = live.state.agents.find((a) => a.id === agentRunId);
    if (agent !== undefined && isLiveAgentStatus(agent.status)) {
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

  function sendTo(live: LiveRun, agentRunId: string, text: string): void {
    if (live.starting.has(agentRunId)) {
      const queue = live.pendingSends.get(agentRunId) ?? [];
      queue.push(text);
      live.pendingSends.set(agentRunId, queue);
      return;
    }
    const handle = live.handles.get(agentRunId);
    const runId = live.state.run.id;
    if (handle === undefined) {
      logger.log('warn', 'agent message not delivered', { runId, agentRunId, code: 'no-process' });
      return;
    }
    track(
      handle.send(text).catch((error: unknown) => {
        logger.log('warn', 'agent message not delivered', {
          runId,
          agentRunId,
          ...errorFields(error),
        });
      }),
    );
  }

  /** The approval bridge (ADR-0013 §4): engine → approval row → SSE → owner decision → resolve. */
  function askOwner(
    live: LiveRun,
    agentRunId: string,
    kind: 'lead' | 'worker',
    request: PermissionRequest,
  ): Promise<PermissionDecision> {
    const runId = live.state.run.id;
    if (kind === 'lead') {
      // ADR-0013 §2: the lead runs read-only in the owner's tree; nothing to ask the owner.
      counters.leadToolUsesDenied++;
      logger.log('info', 'lead tool use denied', { runId, agentRunId, code: 'lead-read-only' });
      return Promise.resolve({ allow: false, message: LEAD_READ_ONLY_MESSAGE });
    }
    let result: Applied<{ id: string }>;
    try {
      result = apply(live, (s, c) => requestPermission(s, { ...request, agentRunId }, c));
    } catch (error) {
      logger.log('error', 'approval request failed', { runId, agentRunId, ...errorFields(error) });
      return Promise.resolve({ allow: false, message: 'The control plane could not record this.' });
    }
    if (!result.ok) {
      logger.log('info', 'approval refused', { runId, agentRunId, code: result.refusal.code });
      return Promise.resolve({ allow: false, message: result.refusal.message });
    }
    const approvalId = result.value.id;
    return new Promise((resolve) => permissions.set(approvalId, resolve));
  }

  /** Lead tool calls: the engine validates (ADR-0013); a refusal is returned to the model as an error. */
  function leadTool(live: LiveRun, agentRunId: string, name: string, input: unknown): string {
    const runId = live.state.run.id;
    const result = apply(live, (s, c) =>
      leadToolCall(
        s,
        { callerAgentRunId: agentRunId, name, input, registeredProjectIds: projectIds() },
        c,
      ),
    );
    if (!result.ok) {
      logger.log('info', 'lead tool refused', { runId, tool: name, code: result.refusal.code });
      throw new Error(result.refusal.message);
    }
    logger.log('info', 'lead tool called', { runId, tool: name });
    return result.value;
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
    return toRunDetail(live.state, {
      stored: store.repos.agentRuns.listForRun(runId),
      workspaces: store.repos.workspaces.listForRun(runId),
      messages: store.repos.messages.list(runId, { limit: MAX_PAGE_SIZE }),
    });
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

  async function review(runId: string): Promise<ReviewDto> {
    const live = get(runId);
    const agents: ReviewDto['agents'] = [];
    for (const agent of live.state.agents) {
      // Live workers are still changing their tree; they are reviewed once they stop.
      if (agent.kind !== 'worker' || agent.review === null) continue;
      const row = store.repos.workspaces.getByAgentRun(agent.id);
      if (row === undefined) continue;
      const base = {
        agentRunId: agent.id,
        role: agent.role,
        branch: row.branch,
        baseBranch: row.baseBranch,
        state: agent.review,
      };
      if (row.state === 'removed') {
        agents.push({ ...base, files: [], diff: '', diffTruncated: false });
        continue;
      }
      try {
        const changes = await deps.workspaces.changes(await workspaceFor(live, row));
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
  ): Promise<void> {
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
        if (WORKING.includes(run.status) && isRunPastDeadline(run, now, runTimeoutMs)) {
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
      logger.log('info', 'run recovered after restart', {
        runId: run.id,
        status: result.state.run.status,
      });
    }
    if (live.state.run.status === 'REVIEW') resolveEmptyReviews(live);
  }

  return {
    enabled: deps.enabled,
    csrfToken,

    async start() {
      if (!deps.enabled) return;
      // Worktrees the database still references stay, NEEDS_REVIEW ones included.
      const keep = store.repos.workspaces
        .listActive()
        .map((w) => ({ runId: w.runId, agentId: w.agentRunId }));
      try {
        const result = await deps.workspaces.cleanupOrphans(keep);
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
      if (input.action === 'merge-anyway') {
        // Contract added in P4-0; harness checks (and so "merge anyway") arrive with P4-C/P4-D.
        throw new HttpError(
          409,
          'merge_anyway_unavailable',
          'There are no failed checks to override; use merge instead',
        );
      }
      await applyReview(runId, input.agentRunId, input.action);
      return review(runId);
    },

    extraRoots() {
      return store.repos.workspaces
        .listActive()
        .map((w) => ({ projectId: w.projectId, rootPath: w.worktreePath }));
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
  };
}
