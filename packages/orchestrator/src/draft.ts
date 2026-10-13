import { redact } from '@acp/core';
import type {
  AgentRunStatus,
  OrchestrationRun,
  PermissionDecision,
  RunStatus,
  TicketPlan,
} from '@acp/core';
import { agentBudgetUsage, budgetOvershoot, isOverBudget } from './budget.js';
import type { UsageLedger } from './budget.js';
import {
  assertAgentTransition,
  assertRunTransition,
  isLiveAgentStatus,
  isTerminalRunStatus,
} from './transitions.js';
import { agentDepth, childrenOf } from './tree.js';
import type {
  ApprovalDecider,
  EngineAgent,
  EngineApproval,
  EngineContext,
  EngineEffect,
  RunLimits,
  RunState,
} from './state.js';

/** Max length of an approval summary or activity line shown in the panel (ADR-0013 §4). */
export const SUMMARY_MAX_CHARS = 200;

/** Redacts secrets and caps the length; summaries come from tool targets, which may hold anything. */
export function cleanSummary(text: string, fallback: string): string {
  const flat = redact(text).replace(/\s+/g, ' ').trim();
  const value = flat.length > 0 ? flat : fallback;
  return value.length <= SUMMARY_MAX_CHARS ? value : `${value.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
}

const RESUME_AFTER_RAISE = 'The owner raised your budget. Continue your task.';
const DENIED_BY_OWNER = 'The owner denied this action.';
const DENIED_NO_ANSWER = 'No answer from the owner in time; the action was denied.';
const DENIED_AGENT_STOPPED = 'The agent was stopped; the action was denied.';

/**
 * A mutable working copy of a `RunState` used inside one command. Commands copy the input state
 * into a draft, apply changes, then `finish()` returns a fresh state; the input is never mutated.
 * Every status change goes through the transition tables (throws `IllegalTransitionError`).
 */
export class Draft {
  run: OrchestrationRun;
  readonly agents: EngineAgent[];
  readonly approvals: EngineApproval[];
  ledger: UsageLedger;
  readonly plans: TicketPlan[];
  readonly limits: RunLimits | undefined;
  readonly effects: EngineEffect[] = [];
  private readonly nowIso: string;
  private readonly hadPlans: boolean;

  constructor(
    state: RunState,
    readonly ctx: EngineContext,
  ) {
    this.run = { ...state.run, budget: { ...state.run.budget } };
    this.agents = state.agents.map((a) => ({ ...a }));
    this.approvals = state.approvals.map((a) => ({ ...a }));
    this.ledger = state.ledger;
    this.plans = (state.plans ?? []).map((p) => ({ ...p }));
    this.hadPlans = state.plans !== undefined;
    this.limits = state.limits === undefined ? undefined : { ...state.limits };
    this.nowIso = ctx.now.toISOString();
  }

  get now(): string {
    return this.nowIso;
  }

  agent(id: string): EngineAgent | undefined {
    return this.agents.find((a) => a.id === id);
  }

  lead(): EngineAgent | undefined {
    return this.agents.find((a) => a.kind === 'lead');
  }

  workers(): EngineAgent[] {
    return this.agents.filter((a) => a.kind === 'worker');
  }

  liveWorkers(): EngineAgent[] {
    return this.workers().filter((a) => isLiveAgentStatus(a.status));
  }

  idInUse(id: string): boolean {
    return (
      id === this.run.id ||
      this.agents.some((a) => a.id === id) ||
      this.approvals.some((a) => a.id === id) ||
      this.plans.some((p) => p.id === id)
    );
  }

  /** A fresh id from the context; throws if it collides, which would corrupt the run. */
  freshId(): string {
    const id = this.ctx.newId();
    if (id.length === 0 || this.idInUse(id)) throw new DuplicateIdError(id);
    return id;
  }

  setRunStatus(to: RunStatus): void {
    if (this.run.status === to) return;
    assertRunTransition(this.run.status, to);
    this.run.status = to;
    if (isTerminalRunStatus(to)) this.run.endedAt = this.now;
  }

  setAgentStatus(agent: EngineAgent, to: AgentRunStatus): void {
    if (agent.status === to) return;
    assertAgentTransition(agent.status, to);
    agent.status = to;
    if (!isLiveAgentStatus(to)) {
      agent.endedAt = this.now;
      if (agent.kind === 'worker' && agent.review === null) agent.review = 'pending';
    }
  }

  /** Ends a live agent and settles its open approvals first, so no SDK callback is left hanging. */
  endAgent(agent: EngineAgent, to: AgentRunStatus, abort: boolean): void {
    if (!isLiveAgentStatus(agent.status)) return;
    this.settlePendingApprovals(agent.id, 'denied', DENIED_AGENT_STOPPED);
    this.setAgentStatus(agent, to);
    if (abort) this.effects.push({ type: 'abort-agent', agentRunId: agent.id });
  }

  /**
   * Ends an agent and everything below it, descendants first (ADR-0013 amendment: "Stop all stops
   * descendants first"), so a parent helper cannot start replacements while its children stop.
   */
  endAgentTree(agent: EngineAgent, to: AgentRunStatus, abort: boolean, seen = new Set<string>()): void {
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    for (const child of childrenOf(this, agent.id)) this.endAgentTree(child, to, abort, seen);
    this.endAgent(agent, to, abort);
  }

  /** Live workers, deepest first; the order in which Stop all ends them. */
  liveWorkersDeepestFirst(): EngineAgent[] {
    return this.liveWorkers()
      .map((a, i) => ({ a, i, depth: agentDepth(this, a) }))
      .sort((x, y) => y.depth - x.depth || x.i - y.i)
      .map((x) => x.a);
  }

  /** Closes every pending approval of one agent (or all agents when `agentRunId` is null). */
  settlePendingApprovals(
    agentRunId: string | null,
    status: 'denied' | 'expired',
    message: string,
  ): void {
    for (const approval of this.approvals) {
      if (approval.status !== 'pending') continue;
      if (agentRunId !== null && approval.agentRunId !== agentRunId) continue;
      this.closeApproval(approval, status, { allow: false, message }, null);
    }
  }

  closeApproval(
    approval: EngineApproval,
    status: 'approved' | 'denied' | 'expired',
    decision: PermissionDecision,
    decidedBy: ApprovalDecider | null = null,
  ): void {
    approval.status = status;
    approval.decidedAt = this.now;
    approval.decidedBy = decidedBy;
    // Budget approvals have no SDK callback waiting; only tool-use approvals resolve a promise.
    if (approval.kind === 'tool-use') {
      this.effects.push({ type: 'resolve-permission', approvalId: approval.id, decision });
    }
  }

  /** Recomputes the agent's budget from the ledger and applies the soft cap (ADR-0014). */
  enforceBudget(agent: EngineAgent, overshootReported: boolean): void {
    const { used } = agentBudgetUsage(this.ledger, agent.id);
    agent.budgetTokensUsed = used;
    if (!isOverBudget(used, agent.budgetLimit)) return;

    const overshoot = budgetOvershoot(used, agent.budgetLimit);
    if (overshoot > 0 && !overshootReported) {
      this.effects.push({
        type: 'budget-overshoot',
        agentRunId: agent.id,
        used,
        limit: agent.budgetLimit,
        overshoot,
      });
    }
    // Only a running agent is moved; one waiting for a tool decision is checked when it resumes.
    if (agent.status !== 'RUNNING') return;
    if (this.pendingBudgetApproval(agent.id) !== undefined) return;

    this.setAgentStatus(agent, 'BLOCKED');
    this.effects.push({ type: 'interrupt-agent', agentRunId: agent.id });
    const approval: EngineApproval = {
      id: this.freshId(),
      runId: this.run.id,
      agentRunId: agent.id,
      kind: 'budget-raise',
      toolName: null,
      toolUseId: null,
      summary: cleanSummary(
        `Budget reached: ${formatTokens(used)} of ${formatTokens(agent.budgetLimit)} budget tokens used`,
        'Budget reached',
      ),
      status: 'pending',
      requestedAt: this.now,
      decidedAt: null,
    };
    this.approvals.push(approval);
    this.effects.push({ type: 'approval-requested', approvalId: approval.id });
  }

  pendingBudgetApproval(agentRunId: string): EngineApproval | undefined {
    return this.approvals.find(
      (a) => a.agentRunId === agentRunId && a.kind === 'budget-raise' && a.status === 'pending',
    );
  }

  hasPendingToolApproval(agentRunId: string): boolean {
    return this.approvals.some(
      (a) => a.agentRunId === agentRunId && a.kind === 'tool-use' && a.status === 'pending',
    );
  }

  /** After a tool decision: back to RUNNING once nothing else is pending, then re-check budget. */
  resumeAfterToolDecision(agent: EngineAgent): void {
    if (agent.status !== 'WAITING_APPROVAL' || this.hasPendingToolApproval(agent.id)) return;
    this.setAgentStatus(agent, 'RUNNING');
    this.enforceBudget(agent, true);
  }

  resumeAfterRaise(agent: EngineAgent): void {
    this.setAgentStatus(agent, 'RUNNING');
    this.effects.push({ type: 'send-to-agent', agentRunId: agent.id, text: RESUME_AFTER_RAISE });
  }

  /**
   * Derives the run status from its agents (orchestration-lifecycle §0):
   * - QUEUED → RUNNING once the lead runs; → FAILED if the lead ended without running.
   * - RUNNING ⇄ BLOCKED: BLOCKED when every live agent waits for the owner.
   * - Lead ended and no live worker → REVIEW (or FAILED when the lead failed and no worker exists).
   * - REVIEW → COMPLETED once every worker's changes are merged, discarded, or empty; the lead, if
   *   still live, is then aborted.
   */
  reconcile(): void {
    const lead = this.lead();
    const status = this.run.status;

    // Plan-first (ADR-0016): no helper exists before approval, so a lead that ends here fails the run.
    if (status === 'PLANNING' || status === 'PLAN_REVIEW') {
      if (lead === undefined || !isLiveAgentStatus(lead.status)) this.setRunStatus('FAILED');
      return;
    }

    if (status === 'QUEUED' && lead !== undefined) {
      if (lead.status === 'RUNNING' || lead.status === 'WAITING_APPROVAL') {
        this.setRunStatus('RUNNING');
      } else if (!isLiveAgentStatus(lead.status)) {
        this.setRunStatus('FAILED');
        return;
      }
    }

    if (this.run.status === 'RUNNING' || this.run.status === 'BLOCKED') {
      const leadLive = lead !== undefined && isLiveAgentStatus(lead.status);
      const workers = this.workers();
      if (!leadLive && this.liveWorkers().length === 0) {
        const leadFailed =
          lead !== undefined && lead.status !== 'SUCCEEDED' && lead.status !== 'CANCELLED';
        this.setRunStatus(workers.length === 0 && leadFailed ? 'FAILED' : 'REVIEW');
      } else {
        const live = this.agents.filter((a) => isLiveAgentStatus(a.status));
        const allWaiting = live.every(
          (a) => a.status === 'WAITING_APPROVAL' || a.status === 'BLOCKED',
        );
        this.setRunStatus(allWaiting ? 'BLOCKED' : 'RUNNING');
      }
    }

    if (this.run.status === 'REVIEW') {
      const unresolved = this.workers().some((w) => w.review === null || w.review === 'pending');
      if (!unresolved) {
        this.setRunStatus('COMPLETED');
        // The conversation is over; stop the lead if it is still waiting for chat.
        for (const agent of this.agents) this.endAgent(agent, 'CANCELLED', true);
      }
    }
  }

  finish(): RunState {
    this.run.updatedAt = this.now;
    const state: RunState = {
      run: this.run,
      agents: this.agents,
      approvals: this.approvals,
      ledger: this.ledger,
    };
    if (this.limits !== undefined) state.limits = this.limits;
    if (this.hadPlans || this.plans.length > 0) state.plans = this.plans;
    return state;
  }

  static readonly messages = {
    deniedByOwner: DENIED_BY_OWNER,
    deniedNoAnswer: DENIED_NO_ANSWER,
    deniedAgentStopped: DENIED_AGENT_STOPPED,
  } as const;
}

/** The context's id generator returned an id already used in this run. */
export class DuplicateIdError extends Error {
  override readonly name = 'DuplicateIdError';
  readonly code = 'duplicate-id' as const;
  constructor(readonly id: string) {
    super('generated id is empty or already used in this run');
  }
}

/** Plain digit grouping without locale data, so output is identical everywhere. */
export function formatTokens(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
