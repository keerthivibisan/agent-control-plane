import type {
  AgentRunStatus,
  CompileContext,
  OrchestrationRun,
  PermissionDecision,
  ProjectApprovals,
  ProjectWorkflow,
  RunStatus,
  TicketPlan,
  WorkflowGraph,
  WorkflowNodeId,
  WorkflowProgram,
} from '@acp/core';
import { agentBudgetUsage, budgetOvershoot, isOverBudget } from './budget.js';
import type { UsageLedger } from './budget.js';
import {
  assertAgentTransition,
  assertRunTransition,
  isActiveAgentStatus,
  isLiveAgentStatus,
  isTerminalRunStatus,
} from './transitions.js';
import {
  enterReview,
  promptHandover,
  stoppedWithoutReview,
  sweepLoop,
  undecidedChanges,
  waitingLines,
  waitsOnlyForOwner,
} from './loop.js';
import { agentDepth, childrenOf, descendantsOf } from './tree.js';
import {
  finalStageRole,
  hasReviewableChange,
  isSeparatePlanner,
  isStageAgent,
  launchFieldsFor,
  nextStage,
  reviewerBrief,
  testerBrief,
  TESTER_TASK,
} from './stages.js';
import { agentLaunchMode, finalStageNode, programOf } from './program.js';
import type {
  ApprovalDecider,
  EngineAgent,
  EngineApproval,
  EngineContext,
  EngineEffect,
  FollowUpState,
  OwnerWait,
  RunIntegration,
  RunLimits,
  RunState,
} from './state.js';
import { cleanSummary } from './summary.js';

export { SUMMARY_MAX_CHARS, cleanSummary } from './summary.js';

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
  /** The review loop's settings (`RunState.integration`, ADR-0021); undefined: legacy flow. */
  integration: RunIntegration | undefined;
  /** Loop runs: the lead was told to hand over at this idle point (`RunState.handoverPrompted`). */
  handoverPrompted: boolean;
  /** Loop runs: the run's waits for the owner so far (`RunState.ownerWait`, P-D). */
  ownerWait: OwnerWait | undefined;
  /** The run's approval policy (`RunState.approvalPolicy`, ADR-0021). */
  readonly approvalPolicy: ProjectApprovals | undefined;
  /** The run's graph snapshot and its compile context (`RunState.graph`, ADR-0023). */
  readonly graph: WorkflowGraph | undefined;
  readonly graphContext: CompileContext | undefined;
  /** Helper nodes of each submitted plan's steps (`RunState.planStepHelpers`). */
  planStepHelpers: Record<string, readonly WorkflowNodeId[]> | undefined;
  readonly effects: EngineEffect[] = [];
  private readonly nowIso: string;
  private readonly hadPlans: boolean;
  /** Reviewers that ended in this command; their checkouts are removed after any abort. */
  private readonly endedReviewers: string[] = [];
  /** Loop runs: helpers that stopped in this command with work waiting for a decision. */
  private readonly stoppedHelpers: string[] = [];

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
    this.integration = state.integration === undefined ? undefined : { ...state.integration };
    this.handoverPrompted = state.handoverPrompted === true;
    this.ownerWait = state.ownerWait === undefined ? undefined : { ...state.ownerWait };
    this.approvalPolicy = state.approvalPolicy;
    this.graph = state.graph;
    this.graphContext = state.graphContext;
    this.planStepHelpers =
      state.planStepHelpers === undefined ? undefined : { ...state.planStepHelpers };
    for (const a of this.agents) if (a.change !== undefined) a.change = { ...a.change };
    this.nowIso = ctx.now.toISOString();
  }

  get now(): string {
    return this.nowIso;
  }

  /** The run's compiled workflow program (ADR-0023; memoized per snapshot). */
  program(): WorkflowProgram {
    return programOf(this);
  }

  /**
   * ADR-0023 §5: a graph run's `start-agent` fields for a helper or tester (auto mode, sandbox).
   * Version 1 runs get none: their Full auto stays run-level, as before.
   */
  launchModeFields(agent: EngineAgent): { autoMode?: true; sandbox?: true } {
    if (this.graph === undefined) return {};
    const launch = agentLaunchMode(this, agent);
    return {
      ...(launch.autoMode ? { autoMode: true as const } : {}),
      ...(launch.sandbox ? { sandbox: true as const } : {}),
    };
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

  /** Workers with a process (ADR-0021: one waiting for its change to be decided has none). */
  liveWorkers(): EngineAgent[] {
    return this.workers().filter((a) => isActiveAgentStatus(a.status));
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
    const from = agent.status;
    agent.status = to;
    if (!isLiveAgentStatus(to)) {
      agent.endedAt = this.now;
      if (hasReviewableChange(agent.kind)) {
        if (this.integration === undefined) {
          // Helpers and the tester leave a worktree the owner merges or discards (ADR-0019).
          if (agent.review === null) agent.review = 'pending';
        } else if (agent.resolution !== undefined) {
          // ADR-0030: a resolver's half-done merge is never an ordinary change; the server ends
          // its operation's attempt (sealed ones report through `resolverSealed`).
          if (from !== 'AWAITING_REVIEW') {
            this.effects.push({
              type: 'resolver-ended',
              agentRunId: agent.id,
              operationId: agent.resolution.operationId,
            });
          }
        } else if (from !== 'AWAITING_REVIEW' && !this.isStopping()) {
          // ADR-0021: stopped mid-turn while the run goes on; its work waits for a decision.
          stoppedWithoutReview(agent);
          this.stoppedHelpers.push(agent.id);
        }
      }
      if (agent.kind === 'reviewer') this.endedReviewers.push(agent.id);
    }
  }

  /** The run is being stopped or has ended: nothing new is decided or started. */
  isStopping(): boolean {
    return this.run.status === 'CANCELLING' || isTerminalRunStatus(this.run.status);
  }

  /** Ends a live agent and settles its open approvals first, so no SDK callback is left hanging. */
  endAgent(agent: EngineAgent, to: AgentRunStatus, abort: boolean): void {
    if (!isLiveAgentStatus(agent.status)) return;
    // An agent waiting for its change to be decided (ADR-0021) has no process to abort.
    const hasProcess = agent.status !== 'AWAITING_REVIEW';
    this.settlePendingApprovals(agent.id, 'denied', DENIED_AGENT_STOPPED);
    this.setAgentStatus(agent, to);
    if (abort && hasProcess) this.effects.push({ type: 'abort-agent', agentRunId: agent.id });
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
    // ADR-0021: a helper whose turn is over keeps its change for the lead (or owner) to decide;
    // stopping its parent stops work, not decisions. Only Stop all cancels it.
    if (agent.status === 'AWAITING_REVIEW') return;
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
    // ADR-0021: messages about changes are held while the lead is BLOCKED; list what waits.
    const waiting =
      agent.kind === 'lead' && this.integration !== undefined ? waitingLines(this) : [];
    const text =
      waiting.length === 0
        ? RESUME_AFTER_RAISE
        : `${RESUME_AFTER_RAISE}\n\nChanges not decided yet:\n${waiting.join('\n')}`;
    this.effects.push({ type: 'send-to-agent', agentRunId: agent.id, text });
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
      // A helper waiting for its change to be decided (ADR-0021) no longer holds its parent.
      if (below.some((a) => isActiveAgentStatus(a.status))) continue;
      agent.awaitingHelpers = false;
      // ADR-0021: at depth 2 every change goes through the loop, the parent's own too.
      if (this.integration !== undefined) enterReview(this, agent, false);
      else this.setAgentStatus(agent, 'SUCCEEDED');
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

    const loop = this.integration;
    const loopStatus = ['RUNNING', 'BLOCKED', 'REVIEW'].includes(this.run.status);
    if (loop !== undefined && loopStatus) sweepLoop(this, this.stoppedHelpers.splice(0));

    if (this.run.status === 'RUNNING' || this.run.status === 'BLOCKED') {
      const leadLive = lead !== undefined && isLiveAgentStatus(lead.status);
      const workers = this.workers();
      if (!leadLive && this.liveWorkers().length === 0) {
        const leadFailed =
          lead !== undefined && lead.status !== 'SUCCEEDED' && lead.status !== 'CANCELLED';
        this.setRunStatus(workers.length === 0 && leadFailed ? 'FAILED' : 'REVIEW');
      } else {
        // ADR-0021 §5: after the handover the final stages run on the ticket branch while the run
        // stays RUNNING and the lead stays live; with none left, the owner's final merge follows.
        if (loop?.handedOver === true && leadLive && this.loopSettled()) {
          const next = nextStage(this);
          if (next === null) this.setRunStatus('REVIEW');
          else if (!this.stagesHeld) this.startStage(next);
        }
        if (this.run.status === 'RUNNING' || this.run.status === 'BLOCKED') {
          const live = this.agents.filter((a) => isActiveAgentStatus(a.status));
          const allWaiting = live.every(
            (a) => a.status === 'WAITING_APPROVAL' || a.status === 'BLOCKED',
          );
          this.setRunStatus(allWaiting ? 'BLOCKED' : 'RUNNING');
        }
      }
    }

    if (loop !== undefined) {
      promptHandover(this);
      // ADR-0021: REVIEW waits for the owner's single merge of the ticket branch; it never
      // completes by itself. Without a lead (it ended early, or a restart), the final stages
      // start here once every change is decided, as in the legacy flow.
      const leadLive = lead !== undefined && isLiveAgentStatus(lead.status);
      if (this.run.status === 'REVIEW' && !leadLive && this.loopSettled() && !this.stagesHeld) {
        const next = nextStage(this);
        if (next !== null) this.startStage(next);
      }
      return;
    }

    // REVIEW covers stages 4–6 (ADR-0019): the owner reviews the helpers' changes, then the
    // reviewer and the tester work after the merge, and the tester's change is reviewed too. The
    // run status stays REVIEW meanwhile; `deriveRunWorkflow` says which stage is active.
    if (this.run.status === 'REVIEW') {
      const unresolved = this.agents.some(
        (a) => hasReviewableChange(a.kind) && (a.review === null || a.review === 'pending'),
      );
      const stageLive = this.agents.some((a) => isStageAgent(a) && isLiveAgentStatus(a.status));
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
   * P-D: starts or ends the run's current wait for the owner (`waitsOnlyForOwner`), after the
   * command's status changes. A wait ends at the command that ends it (the owner's decision, a
   * helper starting), so its length is known to the millisecond of that command.
   */
  trackOwnerWait(): void {
    const waiting = waitsOnlyForOwner(this);
    const wait = this.ownerWait;
    if (waiting && (wait === undefined || wait.since === null)) {
      this.ownerWait = { since: this.now, totalMs: wait?.totalMs ?? 0 };
    } else if (!waiting && wait !== undefined && wait.since !== null) {
      const waited = Math.max(0, Date.parse(this.now) - Date.parse(wait.since));
      this.ownerWait = { since: null, totalMs: wait.totalMs + waited };
    }
  }

  /** Loop runs: no agent but the lead has a process, and every change is decided. */
  loopSettled(): boolean {
    return (
      !this.agents.some((a) => a.kind !== 'lead' && isActiveAgentStatus(a.status)) &&
      undecidedChanges(this).length === 0
    );
  }

  /**
   * Starts the reviewer or the tester (ADR-0019). The helpers are done and reviewed, so the lead's
   * conversation is over and it is stopped, as at completion. The new agent counts as one helper;
   * none is live at this point, so it always fits the run's helper limit.
   *
   * ADR-0021 (loop runs): the lead stays live; the reviewer reads a detached checkout of the
   * ticket branch tip (`reviewScope: 'final'`) and the tester's worktree starts from that tip.
   */
  private startStage(stage: WorkflowNodeId): void {
    const node = finalStageNode(this.program(), stage);
    if (node === undefined) return;
    // A reviewer that just ended gives back its checkout before the next stage starts.
    this.flushCheckoutRemovals();
    const lead = this.lead();
    const loop = this.integration;
    if (lead !== undefined && loop === undefined) this.endAgent(lead, 'CANCELLED', true);
    const branch = loop?.ticketBranch ?? null;
    const kind = node.kind === 'reviewer' ? 'reviewer' : 'tester';
    const agent: EngineAgent = {
      id: this.freshId(),
      runId: this.run.id,
      parentAgentRunId: null,
      kind,
      role: finalStageRole(node),
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
      stage: node.id,
    };
    if (kind === 'reviewer') agent.reviewPosts = 0;
    this.agents.push(agent);
    this.setAgentStatus(agent, 'STARTING');
    if (kind === 'reviewer') {
      this.effects.push({
        type: 'create-review-checkout',
        agentRunId: agent.id,
        ...(branch !== null ? { ticketBranch: branch } : {}),
      });
    }
    // ADR-0027 §5: the Checks block on the ticket branch sits after `afterStages` final stages;
    // it runs on the tip as the next stage starts (the last position is the owner's merge,
    // whose tip checks the server runs when the run reaches review).
    const branchBlock = loop === undefined ? null : this.program().checkBlocks.branch;
    if (
      branchBlock !== null &&
      this.program().finalStages.findIndex((n) => n.id === node.id) === branchBlock.afterStages
    ) {
      this.effects.push({
        type: 'run-branch-checks',
        blockNodeId: branchBlock.nodeId,
        select: branchBlock.select,
      });
    }
    const brief = kind === 'reviewer' ? reviewerBrief(this) : testerBrief(this);
    const loopFields =
      loop === undefined
        ? {}
        : kind === 'reviewer'
          ? { reviewScope: 'final' as const }
          : branch !== null
            ? { fromBranch: branch }
            : {};
    this.effects.push({
      type: 'start-agent',
      agentRunId: agent.id,
      kind,
      role: agent.role,
      ...launchFieldsFor(this.program(), node.id, brief),
      ...loopFields,
      ...(kind === 'tester' ? this.launchModeFields(agent) : {}),
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
    if (this.integration !== undefined) state.integration = this.integration;
    if (this.handoverPrompted) state.handoverPrompted = true;
    if (this.ownerWait !== undefined) state.ownerWait = this.ownerWait;
    if (this.approvalPolicy !== undefined) state.approvalPolicy = this.approvalPolicy;
    if (this.graph !== undefined) state.graph = this.graph;
    if (this.graphContext !== undefined) state.graphContext = this.graphContext;
    if (this.planStepHelpers !== undefined) state.planStepHelpers = this.planStepHelpers;
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
