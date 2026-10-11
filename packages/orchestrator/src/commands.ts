import { APPROVAL_TIMEOUT_MS, DEFAULT_AGENT_BUDGET_TOKENS, TokenCountsSchema } from '@acp/core';
import type { ManagedAgentEvent, PermissionRequest, RunBudget } from '@acp/core';
import { recordUsage, EMPTY_LEDGER } from './budget.js';
import { cleanSummary, Draft, DuplicateIdError, formatTokens } from './draft.js';
import { IllegalTransitionError, refusal } from './errors.js';
import type { Refusal } from './errors.js';
import { checkProjectRegistered, checkReviewAction, checkRunActive } from './policy.js';
import type {
  EngineAgent,
  EngineApproval,
  EngineContext,
  EngineResult,
  RunState,
} from './state.js';
import { isLiveAgentStatus, isTerminalRunStatus } from './transitions.js';

/** Return value of a command body: a refusal (state unchanged), or a value. */
type Body<T> = Refusal | { value: T };

const isRefusal = <T>(b: Body<T>): b is Refusal => 'code' in b;

/**
 * Runs one command on a draft copy. Refusals and transition errors leave the input state untouched;
 * on success the run status is reconciled from the agents before the new state is returned.
 */
export function applyCommand<T>(
  state: RunState,
  ctx: EngineContext,
  body: (draft: Draft) => Body<T>,
): EngineResult<T> {
  const draft = new Draft(state, ctx);
  try {
    const outcome = body(draft);
    if (isRefusal(outcome)) return { ok: false, refusal: outcome };
    draft.reconcile();
    return { ok: true, state: draft.finish(), effects: draft.effects, value: outcome.value };
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      return { ok: false, refusal: refusal('illegal-transition', error.message) };
    }
    if (error instanceof DuplicateIdError) {
      return { ok: false, refusal: refusal('duplicate-id', error.message) };
    }
    throw error;
  }
}

const done = { value: undefined } as const;

export interface CreateRunInput {
  runId: string;
  leadAgentRunId: string;
  projectId: string;
  title: string;
  /** Defaults to `DEFAULT_AGENT_BUDGET_TOKENS` per agent and no cost warning. */
  budget?: RunBudget;
  registeredProjectIds: Iterable<string>;
}

/**
 * A new run: QUEUED with its lead QUEUED. The lead starts with the owner's first chat message
 * (`ownerChat`), so nothing runs until the owner says what to do.
 */
export function createRun(input: CreateRunInput, ctx: EngineContext): EngineResult<RunState> {
  const projectRefusal = checkProjectRegistered(input.projectId, input.registeredProjectIds);
  if (projectRefusal !== null) return { ok: false, refusal: projectRefusal };
  if (input.runId === input.leadAgentRunId || input.runId === '' || input.leadAgentRunId === '') {
    return { ok: false, refusal: refusal('duplicate-id', 'Run and lead ids must differ.') };
  }
  const budget: RunBudget = input.budget ?? {
    maxTokensPerAgent: DEFAULT_AGENT_BUDGET_TOKENS,
    softCostUsdPerRun: null,
  };
  const now = ctx.now.toISOString();
  const lead: EngineAgent = {
    id: input.leadAgentRunId,
    runId: input.runId,
    parentAgentRunId: null,
    kind: 'lead',
    role: 'Lead',
    task: null,
    status: 'QUEUED',
    sessionId: null,
    budgetTokensUsed: 0,
    createdAt: now,
    endedAt: null,
    budgetLimit: budget.maxTokensPerAgent,
    latestActivity: null,
    review: null,
    reportedCostUsd: null,
  };
  const state: RunState = {
    run: {
      id: input.runId,
      projectId: input.projectId,
      title: input.title,
      status: 'QUEUED',
      budget: { ...budget },
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    },
    agents: [lead],
    approvals: [],
    ledger: EMPTY_LEDGER,
  };
  return { ok: true, state, effects: [], value: state };
}

/**
 * The owner's chat message (ADR-0015: stored). The first one starts the lead; later ones are sent
 * to it. Refused while the lead is over budget, so chat cannot bypass the soft cap.
 */
export function ownerChat(state: RunState, text: string, ctx: EngineContext): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const message = text.trim();
    if (message.length === 0) return refusal('invalid-input', 'The message is empty.');
    const lead = d.lead();
    if (lead === undefined) return refusal('unknown-agent', 'The run has no lead agent.');

    if (lead.status === 'QUEUED' && d.run.status === 'QUEUED') {
      d.effects.push({ type: 'chat-message', role: 'owner', text: message });
      d.setAgentStatus(lead, 'STARTING');
      d.effects.push({
        type: 'start-agent',
        agentRunId: lead.id,
        kind: 'lead',
        role: lead.role,
        prompt: message,
      });
      return done;
    }

    if (d.run.status !== 'REVIEW') {
      const runRefusal = checkRunActive(d.run.status);
      if (runRefusal !== null) return runRefusal;
    }
    if (!isLiveAgentStatus(lead.status)) {
      return refusal('agent-not-live', 'The lead agent has ended.');
    }
    if (lead.status === 'BLOCKED') {
      return refusal('over-budget', 'The lead agent reached its budget; raise it or stop the run.');
    }
    d.effects.push({ type: 'chat-message', role: 'owner', text: message });
    d.effects.push({ type: 'send-to-agent', agentRunId: lead.id, text: message });
    return done;
  });
}

/**
 * Applies one adapter event. Usage is recorded even after an agent ended (the tokens were spent);
 * text from a worker is dropped and only counted (ADR-0015 stores lead replies only).
 */
export function agentEvent(
  state: RunState,
  agentRunId: string,
  event: ManagedAgentEvent,
  ctx: EngineContext,
): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    const live = isLiveAgentStatus(agent.status);

    switch (event.type) {
      case 'started':
        d.effects.push({
          type: 'link-session',
          agentRunId: agent.id,
          providerSessionId: event.providerSessionId,
        });
        if (agent.status === 'STARTING') d.setAgentStatus(agent, 'RUNNING');
        else if (!live) d.effects.push({ type: 'diagnostic', code: 'event-after-end', agentRunId });
        return done;

      case 'activity':
        agent.latestActivity = cleanSummary(event.summary, 'Working');
        return done;

      case 'usage': {
        const parsed = TokenCountsSchema.safeParse(event.tokens);
        if (!parsed.success || event.messageId.length === 0) {
          d.effects.push({ type: 'diagnostic', code: 'invalid-usage', agentRunId });
          return done;
        }
        d.ledger = recordUsage(d.ledger, agent.id, event.messageId, parsed.data);
        // A message reported by another agent too may move charges; refresh everyone's total.
        for (const a of d.agents) if (a.id !== agent.id) d.enforceBudget(a, true);
        d.enforceBudget(agent, false);
        return done;
      }

      case 'lead-text':
        if (agent.kind !== 'lead') {
          d.effects.push({ type: 'diagnostic', code: 'worker-text-dropped', agentRunId });
          return done;
        }
        if (event.text.trim().length > 0) {
          d.effects.push({ type: 'chat-message', role: 'lead', text: event.text });
        }
        return done;

      case 'finished': {
        const cost = event.reportedCostUsd;
        if (cost !== null && Number.isFinite(cost) && cost >= 0) agent.reportedCostUsd = cost;
        if (!live) return done;
        const to =
          event.outcome === 'success'
            ? 'SUCCEEDED'
            : event.outcome === 'cancelled'
              ? 'CANCELLED'
              : 'FAILED';
        // A blocked or waiting agent cannot succeed mid-turn; treat a success report there as an end.
        if (to === 'SUCCEEDED' && agent.status === 'WAITING_APPROVAL') {
          d.endAgent(agent, 'FAILED', false);
        } else {
          d.endAgent(agent, to, false);
        }
        return done;
      }
    }
  });
}

/**
 * A non-read-only tool use (ADR-0013 §4). Opens an approval and parks the agent in WAITING_APPROVAL.
 * Refused (the server then denies the tool) when the run is stopping or not active, the agent has
 * ended, or the agent is over budget.
 */
export function requestPermission(
  state: RunState,
  request: PermissionRequest,
  ctx: EngineContext,
): EngineResult<EngineApproval> {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(request.agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    const runRefusal = checkRunActive(d.run.status);
    if (runRefusal !== null) return runRefusal;
    if (!isLiveAgentStatus(agent.status)) {
      return refusal('agent-not-live', 'The agent has ended.');
    }
    if (agent.status === 'BLOCKED' || agent.budgetTokensUsed >= agent.budgetLimit) {
      return refusal('over-budget', 'The agent reached its budget; the owner must raise it.');
    }
    if (agent.status === 'STARTING') d.setAgentStatus(agent, 'RUNNING');
    const toolName = cleanSummary(request.toolName, 'Tool');
    const approval: EngineApproval = {
      id: d.freshId(),
      runId: d.run.id,
      agentRunId: agent.id,
      kind: 'tool-use',
      toolName,
      toolUseId: request.toolUseId,
      summary: cleanSummary(request.summary, toolName),
      status: 'pending',
      requestedAt: d.now,
      decidedAt: null,
    };
    d.approvals.push(approval);
    d.setAgentStatus(agent, 'WAITING_APPROVAL');
    d.effects.push({ type: 'approval-requested', approvalId: approval.id });
    return { value: { ...approval } };
  });
}

export interface ApprovalDecisionOptions {
  /** Shown to the agent on deny (tool-use). */
  message?: string;
  /** budget-raise approve: the new cap. Defaults to the current cap plus the run's per-agent cap. */
  newLimit?: number;
}

/**
 * The owner's decision. Tool-use: resolves the SDK callback and resumes the agent. Budget-raise:
 * approve raises the cap and resumes; deny stops the agent (ADR-0014: "raise the cap, or stop").
 * A decision after the timeout is refused: the approval has expired, which means deny.
 */
export function decideApproval(
  state: RunState,
  approvalId: string,
  decision: 'approve' | 'deny',
  ctx: EngineContext,
  options: ApprovalDecisionOptions = {},
): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const approval = d.approvals.find((a) => a.id === approvalId);
    if (approval === undefined) return refusal('approval-not-found', 'Unknown approval.');
    if (approval.status !== 'pending') {
      return refusal('approval-not-pending', `This request was already ${approval.status}.`);
    }
    if (isApprovalOverdue(approval, ctx.now)) {
      // Too late: it already counts as denied. `expireApprovals` records the expiry.
      return refusal('approval-not-pending', 'This request expired and was denied.');
    }
    const agent = d.agent(approval.agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');

    if (approval.kind === 'tool-use') {
      if (decision === 'approve') d.closeApproval(approval, 'approved', { allow: true });
      else {
        const message = options.message?.trim();
        d.closeApproval(approval, 'denied', {
          allow: false,
          message:
            message === undefined || message.length === 0 ? Draft.messages.deniedByOwner : message,
        });
      }
      d.resumeAfterToolDecision(agent);
      return done;
    }

    // budget-raise
    if (decision === 'deny') {
      d.closeApproval(approval, 'denied', { allow: false, message: Draft.messages.deniedByOwner });
      d.endAgent(agent, 'CANCELLED', true);
      return done;
    }
    const newLimit = options.newLimit ?? agent.budgetLimit + d.run.budget.maxTokensPerAgent;
    if (!Number.isInteger(newLimit) || newLimit <= agent.budgetTokensUsed) {
      return refusal(
        'invalid-input',
        `The new budget must be above the ${formatTokens(agent.budgetTokensUsed)} budget tokens already used.`,
      );
    }
    d.closeApproval(approval, 'approved', { allow: true });
    agent.budgetLimit = newLimit;
    if (agent.status === 'BLOCKED') d.resumeAfterRaise(agent);
    return done;
  });
}

export function isApprovalOverdue(
  approval: EngineApproval,
  now: Date,
  timeoutMs: number = APPROVAL_TIMEOUT_MS,
): boolean {
  return (
    approval.status === 'pending' && now.getTime() - Date.parse(approval.requestedAt) >= timeoutMs
  );
}

function expireOne(d: Draft, approval: EngineApproval): void {
  d.closeApproval(approval, 'expired', { allow: false, message: Draft.messages.deniedNoAnswer });
  const agent = d.agent(approval.agentRunId);
  if (agent === undefined) return;
  if (approval.kind === 'budget-raise') d.endAgent(agent, 'CANCELLED', true);
  else d.resumeAfterToolDecision(agent);
}

/** Expires every pending approval older than `timeoutMs`; no answer means deny (ADR-0013 §4). */
export function expireApprovals(
  state: RunState,
  ctx: EngineContext,
  timeoutMs: number = APPROVAL_TIMEOUT_MS,
): EngineResult<number> {
  return applyCommand(state, ctx, (d) => {
    let expired = 0;
    for (const approval of d.approvals) {
      if (!isApprovalOverdue(approval, ctx.now, timeoutMs)) continue;
      expireOne(d, approval);
      expired++;
    }
    return { value: expired };
  });
}

/** Stops one agent (owner's Stop or the lead's `stop_agent`): deny its approvals, then abort. */
export function stopAgent(state: RunState, agentRunId: string, ctx: EngineContext): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    if (!isLiveAgentStatus(agent.status)) {
      return refusal('agent-not-live', 'The agent has already stopped.');
    }
    d.endAgent(agent, 'CANCELLED', true);
    return done;
  });
}

/**
 * Stop all (orchestration-lifecycle §2). Order matters and is part of the contract:
 * 1. the run becomes CANCELLING, so nothing new is scheduled (`start_agent` is refused);
 * 2. every pending approval is denied, releasing parked SDK callbacks;
 * 3. workers are aborted;
 * 4. the lead is aborted last, so it cannot start replacements in between.
 * The run becomes CANCELLED with `completeCancellation` once the processes have ended.
 */
export function cancelRun(state: RunState, ctx: EngineContext): EngineResult {
  return stopEverything(state, ctx, 'CANCELLED');
}

/** A run past its deadline (ADR-0013 §3): like Stop all, but live agents end as TIMED_OUT. */
export function timeOutRun(state: RunState, ctx: EngineContext): EngineResult {
  return stopEverything(state, ctx, 'TIMED_OUT');
}

export function isRunPastDeadline(run: RunState['run'], now: Date, timeoutMs: number): boolean {
  return !isTerminalRunStatus(run.status) && now.getTime() - Date.parse(run.createdAt) >= timeoutMs;
}

function stopEverything(
  state: RunState,
  ctx: EngineContext,
  agentStatus: 'CANCELLED' | 'TIMED_OUT',
): EngineResult {
  return applyCommand(state, ctx, (d) => {
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is already being stopped.');
    }
    if (isTerminalRunStatus(d.run.status)) {
      return refusal('run-not-active', 'The run has already ended.');
    }
    d.setRunStatus('CANCELLING');
    d.settlePendingApprovals(null, 'denied', Draft.messages.deniedAgentStopped);
    for (const worker of d.liveWorkers()) d.endAgent(worker, agentStatus, true);
    const lead = d.lead();
    if (lead !== undefined) d.endAgent(lead, agentStatus, true);
    return done;
  });
}

/** CANCELLING → CANCELLED, once the server has seen every aborted query end (or killed it). */
export function completeCancellation(state: RunState, ctx: EngineContext): EngineResult {
  return applyCommand(state, ctx, (d) => {
    if (d.run.status !== 'CANCELLING') {
      return refusal('illegal-transition', 'The run is not being stopped.');
    }
    d.setRunStatus('CANCELLED');
    return done;
  });
}

/**
 * Moves the run to REVIEW (the lead's `request_review`, or the owner). Refused while workers are
 * live. A run with nothing to review goes straight on to COMPLETED.
 */
export function requestReview(state: RunState, ctx: EngineContext): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const runRefusal = checkRunActive(d.run.status);
    if (runRefusal !== null) return runRefusal;
    if (d.liveWorkers().length > 0) {
      return refusal('workers-still-running', 'Some agents are still working; stop them first.');
    }
    d.setRunStatus('REVIEW');
    return done;
  });
}

/**
 * Records the owner's review outcome for one worker after the server merged or discarded its branch
 * (or found no changes). Call `checkReviewAction` before doing the git work.
 */
export function recordReview(
  state: RunState,
  agentRunId: string,
  outcome: 'merged' | 'discarded' | 'no-changes',
  ctx: EngineContext,
): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const reviewRefusal = checkReviewAction(state, agentRunId);
    if (reviewRefusal !== null) return reviewRefusal;
    // A run interrupted by a restart enters REVIEW with the owner's first decision.
    if (d.run.status === 'NEEDS_REVIEW') d.setRunStatus('REVIEW');
    const agent = d.agent(agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    agent.review = outcome;
    return done;
  });
}

/**
 * After a server restart (ADR-0013 §7): nothing is relaunched. Live agents become NEEDS_REVIEW and
 * their approvals expire; a run that was working becomes NEEDS_REVIEW. A run that was being stopped
 * finishes stopping: its agents end as CANCELLED and the run as CANCELLED.
 */
export function recoverAfterRestart(state: RunState, ctx: EngineContext): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const cancelling = d.run.status === 'CANCELLING';
    d.settlePendingApprovals(null, 'expired', Draft.messages.deniedNoAnswer);
    // The processes are gone: no abort effects, and settled approvals have no callback to resolve.
    d.effects.length = 0;
    for (const agent of d.agents) {
      if (isLiveAgentStatus(agent.status)) {
        d.setAgentStatus(agent, cancelling ? 'CANCELLED' : 'NEEDS_REVIEW');
      }
    }
    if (cancelling) d.setRunStatus('CANCELLED');
    else if (['QUEUED', 'RUNNING', 'BLOCKED'].includes(d.run.status)) {
      d.setRunStatus('NEEDS_REVIEW');
    }
    return done;
  });
}
