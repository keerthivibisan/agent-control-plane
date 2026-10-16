import { redact } from '@acp/core';
import type {
  AgentRunStatus,
  OrchestrationRun,
  PermissionDecision,
  ProjectWorkflow,
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
import { agentDepth, childrenOf, descendantsOf } from './tree.js';
import {
  hasReviewableChange,
  isPostMergeRole,
  isSeparatePlanner,
  nextStage,
  launchFields,
  reviewerBrief,
  testerBrief,
  TESTER_TASK,
} from './stages.js';
import type { PostMergeStage } from './stages.js';
import type {
  ApprovalDecider,
  EngineAgent,
  EngineApproval,
  EngineContext,
  EngineEffect,
  FollowUpState,
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
  readonly workflow: ProjectWorkflow | undefined;
  /** Separate planner mode: the lead's brief until it starts (`RunState.leadBrief`). */
  leadBrief: string | undefined;
  /** After a restart: no stage starts until the owner continues (`RunState.stagesHeld`). */
  stagesHeld: boolean;
  /** The ended lead's follow-up chat (`RunState.followUp`, ADR-0020). */
  followUp: FollowUpState | undefined;
  readonly effects: EngineEffect[] = [];
  private readonly nowIso: string;
  private readonly hadPlans: boolean;
  /** Reviewers that ended in this command; their checkouts are removed after any abort. */
  private readonly endedReviewers: string[] = [];

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
    this.workflow = state.workflow;
    this.leadBrief = state.leadBrief;
    this.stagesHeld = state.stagesHeld === true;
    const followUp = state.followUp;
    this.followUp =
      followUp === undefined
        ? undefined
        : { ...followUp, turn: followUp.turn === null ? null : { ...followUp.turn } };
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

  /** The separate-mode planner (ADR-0019), if the run has one. */
  planner(): EngineAgent | undefined {
    return this.agents.find((a) => a.kind === 'planner');
  }

  /** The agent that writes the plan: the planner in separate mode, else the lead. */
  planningAgent(): EngineAgent | undefined {
    return isSeparatePlanner(this) ? this.planner() : this.lead();
  }

  /** Helpers (workers at any depth). The planner, reviewer and tester are not workers. */
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
      // Helpers and the tester leave a worktree the owner merges or discards (ADR-0019).
      if (hasReviewableChange(agent.kind) && agent.review === null) agent.review = 'pending';
      if (agent.kind === 'reviewer') this.endedReviewers.push(agent.id);
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
  endAgentTree(
    agent: EngineAgent,
    to: AgentRunStatus,
    abort: boolean,
    seen = new Set<string>(),
  ): void {
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    for (const child of childrenOf(this, agent.id)) this.endAgentTree(child, to, abort, seen);
    this.endAgent(agent, to, abort);
  }

  /**
   * Every live agent except the lead, deepest first: the order in which Stop all ends them, before
   * the lead. Helpers of helpers come first; the planner, reviewer and tester have no parent.
   */
  liveNonLeadDeepestFirst(): EngineAgent[] {
    return this.agents
      .filter((a) => a.kind !== 'lead' && isLiveAgentStatus(a.status))
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
    // Depth 2: a parent helper held open for its helpers ends once none of them is live.
    for (const agent of this.agents) {
      if (agent.awaitingHelpers !== true || !isLiveAgentStatus(agent.status)) continue;
      const below = descendantsOf(this, agent.id);
      if (below.some((a) => isLiveAgentStatus(a.status))) continue;
      agent.awaitingHelpers = false;
      this.setAgentStatus(agent, 'SUCCEEDED');
    }

    const lead = this.lead();
    const status = this.run.status;

    // Plan-first (ADR-0016): no helper exists before approval, so a planning agent that ends here
    // fails the run. In separate mode the lead waits (QUEUED) for the approved plan; if the owner
    // stopped it, the run cannot go on either (ADR-0019).
    if (status === 'PLANNING' || status === 'PLAN_REVIEW') {
      const planner = this.planningAgent();
      const plannerGone = planner === undefined || !isLiveAgentStatus(planner.status);
      const leadGone = lead === undefined || !isLiveAgentStatus(lead.status);
      if (plannerGone || leadGone) {
        this.setRunStatus('FAILED');
        for (const agent of this.agents) {
          this.endAgent(agent, 'CANCELLED', agent.status !== 'QUEUED');
        }
      }
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

    // REVIEW covers stages 4–6 (ADR-0019): the owner reviews the helpers' changes, then the
    // reviewer and the tester work after the merge, and the tester's change is reviewed too. The
    // run status stays REVIEW meanwhile; `deriveRunWorkflow` says which stage is active.
    if (this.run.status === 'REVIEW') {
      const unresolved = this.agents.some(
        (a) => hasReviewableChange(a.kind) && (a.review === null || a.review === 'pending'),
      );
      const stageLive = this.agents.some(
        (a) => isPostMergeRole(a.kind) && isLiveAgentStatus(a.status),
      );
      if (!unresolved && !stageLive) {
        const next = nextStage(this);
        if (next === null) {
          this.setRunStatus('COMPLETED');
          // The conversation is over; stop the lead if it is still waiting for chat.
          for (const agent of this.agents) this.endAgent(agent, 'CANCELLED', true);
        } else if (!this.stagesHeld) {
          this.startStage(next);
        }
      }
    }
  }

  /**
   * Starts the reviewer or the tester (ADR-0019). The helpers are done and reviewed, so the lead's
   * conversation is over and it is stopped, as at completion. The new agent counts as one helper;
   * none is live at this point, so it always fits the run's helper limit.
   */
  private startStage(stage: PostMergeStage): void {
    // A reviewer that just ended gives back its checkout before the next stage starts.
    this.flushCheckoutRemovals();
    const lead = this.lead();
    if (lead !== undefined) this.endAgent(lead, 'CANCELLED', true);
    const kind = stage === 'code-review' ? 'reviewer' : 'tester';
    const agent: EngineAgent = {
      id: this.freshId(),
      runId: this.run.id,
      parentAgentRunId: null,
      kind,
      role: kind === 'reviewer' ? 'Reviewer' : 'Tester',
      task: kind === 'tester' ? TESTER_TASK : null,
      status: 'QUEUED',
      sessionId: null,
      budgetTokensUsed: 0,
      createdAt: this.now,
      endedAt: null,
      budgetLimit: this.run.budget.maxTokensPerAgent,
      latestActivity: null,
      review: null,
      reportedCostUsd: null,
      stage,
    };
    if (kind === 'reviewer') agent.reviewPosts = 0;
    this.agents.push(agent);
    this.setAgentStatus(agent, 'STARTING');
    if (kind === 'reviewer') {
      this.effects.push({ type: 'create-review-checkout', agentRunId: agent.id });
    }
    const brief = kind === 'reviewer' ? reviewerBrief(this) : testerBrief(this);
    this.effects.push({
      type: 'start-agent',
      agentRunId: agent.id,
      kind,
      role: agent.role,
      ...launchFields(brief, this.workflow, kind),
    });
  }

  /** Emits `remove-review-checkout` for reviewers that ended in this command, after any abort. */
  flushCheckoutRemovals(): void {
    for (const agentRunId of this.endedReviewers.splice(0)) {
      this.effects.push({ type: 'remove-review-checkout', agentRunId });
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
    if (this.workflow !== undefined) state.workflow = this.workflow;
    if (this.leadBrief !== undefined) state.leadBrief = this.leadBrief;
    if (this.stagesHeld) state.stagesHeld = true;
    if (this.followUp !== undefined) state.followUp = this.followUp;
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
