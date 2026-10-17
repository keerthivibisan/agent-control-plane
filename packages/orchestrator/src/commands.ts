import {
  APPROVAL_TIMEOUT_MS,
  ChangeReviewerModeSchema,
  DEFAULT_AGENT_BUDGET_TOKENS,
  ProjectApprovalsSchema,
  ProjectWorkflowSchema,
  ReworkRoundsSchema,
  TicketBranchNameSchema,
  TokenCountsSchema,
  WorkflowGraphInvalidError,
  WorkflowGraphSchema,
} from '@acp/core';
import type {
  AllowRule,
  ChangeReviewerMode,
  CompileContext,
  ManagedAgentEvent,
  ManagedFailureCode,
  PermissionRequest,
  ProjectApprovals,
  ProjectWorkflow,
  RunBudget,
  WorkflowGraph,
  WorkflowProgram,
} from '@acp/core';
import { recordUsage, EMPTY_LEDGER } from './budget.js';
import { cleanSummary, Draft, DuplicateIdError, formatTokens } from './draft.js';
import { IllegalTransitionError, refusal } from './errors.js';
import { abortFollowUpTurn } from './follow-up.js';
import type { Refusal } from './errors.js';
import { checkRunLimits, DEFAULT_RUN_LIMITS } from './limits.js';
import {
  checkPlanApproved,
  checkProjectRegistered,
  checkReviewAction,
  checkRunActive,
} from './policy.js';
import { ruleAllowedByMode } from './allowlist.js';
import type { AllowlistVerdict } from './allowlist.js';
import {
  enterReview,
  isFinalChangeState,
  notifyLead,
  undecidedChanges,
  waitingLines,
} from './loop.js';
import {
  hasFinalStages,
  hasReviewableChange,
  isReadOnlyRole,
  isStageAgent,
  launchFieldsFor,
  nextStage,
} from './stages.js';
import { effectiveMode, programOf } from './program.js';
import { helperBriefLines } from './briefs.js';
import type {
  EngineAgent,
  EngineApproval,
  EngineContext,
  EngineResult,
  RunIntegration,
  RunLimits,
  RunState,
} from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus, isTerminalRunStatus } from './transitions.js';
import { descendantsOf } from './tree.js';

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
    draft.flushCheckoutRemovals();
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
  /**
   * The project's agent-tree limits (`runSettingsFromSetup`); checked against the hard ceilings.
   * Defaults to the Phase 3 limits (3 helpers, depth 1).
   */
  limits?: RunLimits;
  /**
   * A board ticket run (ADR-0016): plan-first. The run starts in PLANNING. Without a ticket the
   * run is a Phase 3 control-panel run: QUEUED until the owner's first chat message.
   * - `lead` planner mode (the default): the lead starts at once with `leadPrompt` (the ticket
   *   brief, e.g. from `ticketLeadPrompt`).
   * - `separate` planner mode (ADR-0019): the planner starts at once with `plannerPrompt`
   *   (required; `ticketPlannerPrompt`). `leadPrompt` is the lead's brief
   *   (`ticketOrchestratorPrompt`); the lead starts with it, plus the approved plan, on approval.
   * `ticketRunPrompts` builds both for a workflow.
   */
  ticket?: { ticketId: string; leadPrompt: string; plannerPrompt?: string };
  /**
   * The project's workflow (ADR-0019), snapshotted with the run. Ticket runs only. Absent, or
   * `defaultProjectWorkflow()`, gives exactly the Phase 4 flow.
   */
  workflow?: ProjectWorkflow;
  /**
   * The review loop (ADR-0021 §3–4), ticket runs only. Absent: the legacy flow, where the owner
   * reviews and merges each change. The server resolves the run overrides first:
   * `reviewer` = `StartTicketRequest.reviewer ?? reviewStageOf(workflow).reviewer`, and the same
   * for `maxReworkRounds`. `ticketKey` (e.g. `WEB-12`) names the ticket branch.
   */
  reviewLoop?: { ticketKey: string; reviewer: ChangeReviewerMode; maxReworkRounds: number };
  /**
   * The run's approval policy (ADR-0021 §1): `approvalsOf(setup)` with
   * `StartTicketRequest.approvalMode` applied. Snapshotted; later project changes never apply.
   */
  approvals?: ProjectApprovals;
  /**
   * The project's workflow graph (ADR-0023), validated, snapshotted with the run and compiled with
   * `graphContext` into the program the engine follows. Ticket runs only. Absent: the version 1
   * `workflow` (or the default) is migrated and compiled, so the run behaves as before.
   */
  graph?: WorkflowGraph;
  /**
   * What `graph` compiles with: the project's mode, the ticket's and run's mode ceilings, the
   * reviewer and rounds overrides, and the helper limit (which must equal `limits`). Required
   * with `graph`.
   */
  graphContext?: CompileContext;
  registeredProjectIds: Iterable<string>;
}

/** Validates the review-loop and approval inputs (the engine never trusts its caller). */
function checkLoopInputs(
  input: CreateRunInput,
): Refusal | { integration: RunIntegration | undefined; approvals: ProjectApprovals | undefined } {
  let approvals: ProjectApprovals | undefined;
  if (input.approvals !== undefined) {
    const parsed = ProjectApprovalsSchema.safeParse(input.approvals);
    if (!parsed.success) return refusal('invalid-input', 'The approval settings are not valid.');
    approvals = parsed.data;
  }
  const loop = input.reviewLoop;
  if (loop === undefined) return { integration: undefined, approvals };
  if (input.ticket === undefined) {
    return refusal('invalid-input', 'The review loop applies to ticket runs only.');
  }
  if (!TicketBranchNameSchema.safeParse(`acp/${loop.ticketKey}`).success) {
    return refusal('invalid-input', 'The ticket key does not give a valid ticket branch name.');
  }
  const reviewer = ChangeReviewerModeSchema.safeParse(loop.reviewer);
  const rounds = ReworkRoundsSchema.safeParse(loop.maxReworkRounds);
  if (!reviewer.success || !rounds.success) {
    return refusal('invalid-input', 'The review settings are not valid.');
  }
  return {
    integration: {
      reviewer: reviewer.data,
      maxReworkRounds: rounds.data,
      handedOver: false,
      ticketKey: loop.ticketKey,
      ticketBranch: null,
    },
    approvals,
  };
}

/** Validates the workflow against its schema and the run (the engine never trusts its caller). */
function checkWorkflow(
  input: CreateRunInput,
  limits: RunLimits,
): Refusal | { workflow: ProjectWorkflow | undefined; graph: WorkflowGraph | undefined } {
  const ticket = input.ticket;
  let workflow: ProjectWorkflow | undefined;
  if (input.workflow !== undefined) {
    const parsed = ProjectWorkflowSchema.safeParse(input.workflow);
    if (!parsed.success) return refusal('invalid-input', 'The project workflow is not valid.');
    workflow = parsed.data;
    if (workflow.projectId !== input.projectId) {
      return refusal('invalid-input', 'The workflow belongs to another project.');
    }
    if (ticket === undefined) {
      return refusal('invalid-input', 'A workflow applies to ticket runs only.');
    }
  }
  let graph: WorkflowGraph | undefined;
  if (input.graph !== undefined || input.graphContext !== undefined) {
    if (ticket === undefined) {
      return refusal('invalid-input', 'A workflow graph applies to ticket runs only.');
    }
    const parsed = WorkflowGraphSchema.safeParse(input.graph);
    if (!parsed.success || input.graphContext === undefined) {
      return refusal('invalid-input', 'The workflow graph is not valid.');
    }
    if (input.graphContext.maxConcurrentHelpers !== limits.maxConcurrentHelpers) {
      return refusal('invalid-input', "The workflow graph's helper limit is not the run's.");
    }
    graph = parsed.data;
    try {
      programOf({ graph, graphContext: input.graphContext });
    } catch (error) {
      if (error instanceof WorkflowGraphInvalidError) {
        return refusal('invalid-input', error.message);
      }
      throw error;
    }
  }
  return { workflow, graph };
}

/** The planner prompt must be there exactly when the program has a planner. */
function checkPlannerPrompt(input: CreateRunInput, program: WorkflowProgram): Refusal | null {
  const prompt = input.ticket?.plannerPrompt;
  if (program.planner === null || input.ticket === undefined) {
    return prompt === undefined
      ? null
      : refusal('invalid-input', 'A planner prompt needs the separate planner mode.');
  }
  return prompt === undefined || prompt.trim().length === 0
    ? refusal('invalid-input', 'The planner prompt is empty.')
    : null;
}

/** A brief with the workflow's helper nodes added (only when it has named helpers). */
function withHelperNodes(
  prompt: string,
  program: WorkflowProgram,
  who: 'lead' | 'planner' | 'lead-plans',
): string {
  const lines = helperBriefLines(program, who);
  return lines.length === 0 ? prompt : `${prompt}\n\n${lines.join('\n')}`;
}

/**
 * A new run. Without a ticket: QUEUED with its lead QUEUED; the lead starts with the owner's first
 * chat message (`ownerChat`), so nothing runs until the owner says what to do. With a ticket
 * (plan-first, ADR-0016): PLANNING with its lead STARTING on the ticket brief (a `start-agent`
 * effect); helpers wait for an approved plan.
 */
export function createRun(input: CreateRunInput, ctx: EngineContext): EngineResult<RunState> {
  const projectRefusal = checkProjectRegistered(input.projectId, input.registeredProjectIds);
  if (projectRefusal !== null) return { ok: false, refusal: projectRefusal };
  if (input.runId === input.leadAgentRunId || input.runId === '' || input.leadAgentRunId === '') {
    return { ok: false, refusal: refusal('duplicate-id', 'Run and lead ids must differ.') };
  }
  const limits: RunLimits = { ...(input.limits ?? DEFAULT_RUN_LIMITS) };
  const limitsRefusal = checkRunLimits(limits);
  if (limitsRefusal !== null) return { ok: false, refusal: limitsRefusal };
  const ticket = input.ticket;
  if (ticket !== undefined) {
    if (ticket.ticketId.length === 0) {
      return { ok: false, refusal: refusal('invalid-input', 'The ticket id is empty.') };
    }
    if (ticket.leadPrompt.trim().length === 0) {
      return { ok: false, refusal: refusal('invalid-input', 'The lead prompt is empty.') };
    }
  }
  const checked = checkWorkflow(input, limits);
  if ('code' in checked) return { ok: false, refusal: checked };
  const { workflow, graph } = checked;
  const loopInputs = checkLoopInputs(input);
  if ('code' in loopInputs) return { ok: false, refusal: loopInputs };
  const graphContext = graph === undefined ? undefined : input.graphContext;
  const program = programOf({
    workflow,
    graph,
    graphContext,
    integration: loopInputs.integration,
    approvalPolicy: loopInputs.approvals,
    limits,
  });
  const plannerRefusal = checkPlannerPrompt(input, program);
  if (plannerRefusal !== null) return { ok: false, refusal: plannerRefusal };
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
  // Ticket runs record each agent's workflow node (ADR-0019, ADR-0023); Phase 3 runs have none.
  if (ticket !== undefined) lead.stage = program.lead.id;
  const state: RunState = {
    run: {
      id: input.runId,
      projectId: input.projectId,
      ticketId: ticket?.ticketId ?? null,
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
    limits,
  };
  if (loopInputs.approvals !== undefined) state.approvalPolicy = loopInputs.approvals;
  if (ticket === undefined) return { ok: true, state, effects: [], value: state };

  const initial: RunState = { ...state, plans: [] };
  if (workflow !== undefined) initial.workflow = workflow;
  if (loopInputs.integration !== undefined) initial.integration = loopInputs.integration;
  if (graph !== undefined && graphContext !== undefined) {
    initial.graph = graph;
    initial.graphContext = graphContext;
  }
  const started = applyCommand(initial, ctx, (d) => {
    d.setRunStatus('PLANNING');
    const draftLead = d.lead();
    if (draftLead === undefined) return refusal('unknown-agent', 'The run has no lead agent.');
    const plannerNode = program.planner;
    if (plannerNode !== null) {
      // ADR-0019: the planner plans; the lead waits (QUEUED) for the approved plan.
      const planner: EngineAgent = {
        ...draftLead,
        id: d.freshId(),
        kind: 'planner',
        role: 'Planner',
        stage: plannerNode.id,
      };
      d.agents.push(planner);
      d.setAgentStatus(planner, 'STARTING');
      d.leadBrief = ticket.leadPrompt;
      d.effects.push({
        type: 'start-agent',
        agentRunId: planner.id,
        kind: 'planner',
        role: planner.role,
        ...launchFieldsFor(
          program,
          plannerNode.id,
          withHelperNodes(ticket.plannerPrompt ?? '', program, 'planner'),
        ),
      });
      return done;
    }
    d.setAgentStatus(draftLead, 'STARTING');
    d.effects.push({
      type: 'start-agent',
      agentRunId: draftLead.id,
      kind: 'lead',
      role: draftLead.role,
      ...launchFieldsFor(
        program,
        program.lead.id,
        withHelperNodes(ticket.leadPrompt, program, 'lead-plans'),
      ),
    });
    return done;
  });
  if (!started.ok) return started;
  return { ...started, value: started.state };
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

    // The owner may talk with the lead while it plans and while the plan waits (ADR-0016); in
    // separate planner mode, with the planner, which holds the conversation until approval.
    const planning = d.run.status === 'PLANNING' || d.run.status === 'PLAN_REVIEW';
    const chatOpen = planning || d.run.status === 'REVIEW';
    if (!chatOpen) {
      const runRefusal = checkRunActive(d.run.status);
      if (runRefusal !== null) return runRefusal;
    }
    const target = planning ? d.planningAgent() : lead;
    if (target === undefined) return refusal('unknown-agent', 'The run has no planner.');
    const who = target.kind === 'planner' ? 'The planner' : 'The lead agent';
    if (!isLiveAgentStatus(target.status)) {
      return refusal('agent-not-live', `${who} has ended.`);
    }
    if (target.status === 'BLOCKED') {
      return refusal('over-budget', `${who} reached its budget; raise it or stop the run.`);
    }
    d.effects.push({ type: 'chat-message', role: 'owner', text: message });
    d.effects.push({ type: 'send-to-agent', agentRunId: target.id, text: message });
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
        // ADR-0021: a rework turn resumes the helper's first session; keep it (evidence only).
        if (
          d.integration !== undefined &&
          hasReviewableChange(agent.kind) &&
          agent.sessionId === null
        ) {
          agent.sessionId = event.providerSessionId;
        }
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
        // The lead's replies, and the planner's while it holds the conversation (separate mode;
        // published under the run's agent voice, 'lead'). Everyone else's text is dropped.
        if (agent.kind !== 'lead' && agent.kind !== 'planner') {
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
        if (agent.status === 'AWAITING_REVIEW') {
          // Its turn already ended (review loop); a second report changes nothing.
          d.effects.push({ type: 'diagnostic', code: 'event-after-end', agentRunId });
          return done;
        }
        // ADR-0022: a Full auto agent whose protections were unavailable did no work. Say why in
        // its Latest line and tell the lead; it then ends like any failed turn.
        if (event.failure !== undefined && event.outcome === 'error') {
          agent.latestActivity = FULL_AUTO_FAILURE_ACTIVITY[event.failure];
          d.effects.push({ type: 'diagnostic', code: 'full-auto-unavailable', agentRunId });
          notifyLead(d, fullAutoFailureNote(agent.role, agent.id, event.failure));
        }
        const to =
          event.outcome === 'success'
            ? 'SUCCEEDED'
            : event.outcome === 'cancelled'
              ? 'CANCELLED'
              : 'FAILED';
        // Depth 2: a parent helper that finished its own work while its helpers still run keeps
        // the subtree open (RUNNING) until they end; `Draft.reconcile` then marks it SUCCEEDED.
        if (
          to === 'SUCCEEDED' &&
          agent.kind === 'worker' &&
          (agent.status === 'RUNNING' || agent.status === 'STARTING') &&
          descendantsOf(d, agent.id).some((a) => isActiveAgentStatus(a.status))
        ) {
          d.setAgentStatus(agent, 'RUNNING');
          agent.awaitingHelpers = true;
          return done;
        }
        // ADR-0021 §3: a helper's or tester's turn that ends (well or with an error) goes to the
        // review loop. One parked in an approval cannot finish its turn, so it ends as before.
        if (
          d.integration !== undefined &&
          hasReviewableChange(agent.kind) &&
          event.outcome !== 'cancelled' &&
          agent.status !== 'WAITING_APPROVAL'
        ) {
          enterReview(d, agent, event.outcome === 'error');
          return done;
        }
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

/** The Latest line of a Full auto agent that could not run protected (ADR-0022). */
export const FULL_AUTO_FAILURE_ACTIVITY: Readonly<Record<ManagedFailureCode, string>> = {
  'auto-mode-unavailable':
    "Could not start: Claude Code's auto mode is not available for this model or account (Full auto needs it)",
  'sandbox-unavailable':
    'Could not start: the operating-system sandbox is not available on this computer (Full auto needs it)',
};

/** The engine's message to the lead about it: every later helper would fail the same way. */
export function fullAutoFailureNote(role: string, id: string, code: ManagedFailureCode): string {
  const why =
    code === 'auto-mode-unavailable'
      ? "Claude Code's auto mode is not available for this model or account"
      : 'the operating-system sandbox is not available on this computer';
  return `${role} (agentId ${id}) could not start in Full auto: ${why}, so it did no work and never ran unprotected. Every helper would fail the same way: do not start more helpers. Once every change is decided, call request_review so the owner sees why.`;
}

export interface RequestPermissionOptions {
  /**
   * The project allowlist's verdict for this request (`evaluateAllowlist`). When it allows, the
   * request is recorded as an approval already approved with `decidedBy: 'allowlist'` and resolved
   * at once; the agent is not parked. Ignored for the lead: the allowlist covers helpers only.
   */
  allowlist?: AllowlistVerdict;
}

/**
 * A non-read-only tool use (ADR-0013 §4). Opens an approval and parks the agent in WAITING_APPROVAL,
 * or, when the project allowlist pre-approves it, records an auto-approved approval (ADR-0013
 * amendment). Refused (the server then denies the tool) when the run is stopping or not active, the
 * plan is not approved yet (plan-first), the agent has ended, or the agent is over budget.
 */
export function requestPermission(
  state: RunState,
  request: PermissionRequest,
  ctx: EngineContext,
  options: RequestPermissionOptions = {},
): EngineResult<EngineApproval> {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(request.agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    if (isReadOnlyRole(agent.kind)) {
      return refusal(
        'unknown-tool',
        'The planner and the reviewer only read; they cannot edit files or run commands.',
      );
    }
    // The tester works after the merge, while the run is in REVIEW (ADR-0019).
    const testerAfterMerge = agent.kind === 'tester' && d.run.status === 'REVIEW';
    if (!testerAfterMerge) {
      const planRefusal = checkPlanApproved(d.run.status);
      if (planRefusal !== null) return planRefusal;
      const runRefusal = checkRunActive(d.run.status);
      if (runRefusal !== null) return runRefusal;
    }
    if (!isLiveAgentStatus(agent.status)) {
      return refusal('agent-not-live', 'The agent has ended.');
    }
    if (agent.status === 'AWAITING_REVIEW') {
      return refusal('agent-not-live', 'The agent finished its turn; its change is under review.');
    }
    if (agent.status === 'BLOCKED' || agent.budgetTokensUsed >= agent.budgetLimit) {
      return refusal('over-budget', 'The agent reached its budget; the owner must raise it.');
    }
    if (agent.status === 'STARTING') d.setAgentStatus(agent, 'RUNNING');
    const toolName = cleanSummary(request.toolName, 'Tool');
    // ADR-0021: a run with an approval policy re-checks the verdict's rule against the agent's
    // mode (ADR-0023 §5: its node's mode for this run) and records the rule. Runs without one
    // keep the legacy allowlist behaviour.
    const verdict = options.allowlist;
    const policy = d.approvalPolicy;
    const mode = effectiveMode(d, agent);
    let allowRule: AllowRule | null = null;
    const preApproved =
      verdict?.allowed === true &&
      (policy === undefined || (mode !== undefined && ruleAllowedByMode(mode, verdict.rule)));
    if (verdict?.allowed === true && policy !== undefined) allowRule = verdict.rule;
    // The tester's allowlist is the helpers' (ADR-0019). The lead, planner and reviewers are never
    // pre-approved, whatever the verdict says.
    if (preApproved && hasReviewableChange(agent.kind)) {
      const auto: EngineApproval = {
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
        decidedBy: null,
        ...(allowRule !== null ? { allowRule } : {}),
      };
      d.approvals.push(auto);
      // Recorded for audit, then resolved at once: the owner is not asked (ADR-0013 amendment).
      d.closeApproval(auto, 'approved', { allow: true }, 'allowlist');
      return { value: { ...auto } };
    }
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
      decidedBy: null,
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
      if (decision === 'approve') d.closeApproval(approval, 'approved', { allow: true }, 'owner');
      else {
        const message = options.message?.trim();
        d.closeApproval(
          approval,
          'denied',
          {
            allow: false,
            message:
              message === undefined || message.length === 0
                ? Draft.messages.deniedByOwner
                : message,
          },
          'owner',
        );
      }
      d.resumeAfterToolDecision(agent);
      return done;
    }

    // budget-raise
    if (decision === 'deny') {
      d.closeApproval(
        approval,
        'denied',
        { allow: false, message: Draft.messages.deniedByOwner },
        'owner',
      );
      d.endAgentTree(agent, 'CANCELLED', true);
      return done;
    }
    const newLimit = options.newLimit ?? agent.budgetLimit + d.run.budget.maxTokensPerAgent;
    if (!Number.isInteger(newLimit) || newLimit <= agent.budgetTokensUsed) {
      return refusal(
        'invalid-input',
        `The new budget must be above the ${formatTokens(agent.budgetTokensUsed)} budget tokens already used.`,
      );
    }
    d.closeApproval(approval, 'approved', { allow: true }, 'owner');
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
  d.closeApproval(
    approval,
    'expired',
    { allow: false, message: Draft.messages.deniedNoAnswer },
    'timeout',
  );
  const agent = d.agent(approval.agentRunId);
  if (agent === undefined) return;
  if (approval.kind === 'budget-raise') d.endAgentTree(agent, 'CANCELLED', true);
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

/**
 * Stops one agent (owner's Stop, or `stop_agent` from the lead or a parent helper): its helpers
 * first (depth 2), then the agent; each one's open approvals are denied before it is aborted.
 */
export function stopAgent(state: RunState, agentRunId: string, ctx: EngineContext): EngineResult {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(agentRunId);
    if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
    if (!isLiveAgentStatus(agent.status)) {
      return refusal('agent-not-live', 'The agent has already stopped.');
    }
    if (agent.status === 'AWAITING_REVIEW') {
      return refusal(
        'agent-not-live',
        'That helper finished its turn and has nothing running; decide its change instead (discard it to drop the work).',
      );
    }
    d.endAgentTree(agent, 'CANCELLED', true);
    return done;
  });
}

/**
 * Stop all (orchestration-lifecycle §2). Order matters and is part of the contract:
 * 1. the run becomes CANCELLING, so nothing new is scheduled (`start_agent` is refused);
 * 2. every pending approval is denied, releasing parked SDK callbacks;
 * 3. every other agent is aborted, deepest first (helpers of helpers before their parents; the
 *    planner, reviewer and tester too, ADR-0019);
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
    // An ended lead's follow-up turn (ADR-0020) ends with the run's agents.
    abortFollowUpTurn(d);
    d.settlePendingApprovals(null, 'denied', Draft.messages.deniedAgentStopped);
    for (const agent of d.liveNonLeadDeepestFirst()) d.endAgent(agent, agentStatus, true);
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
    const loop = d.integration;
    if (loop !== undefined) {
      // ADR-0021 §3: the handover. Every change must be decided; then the final stages run on
      // the ticket branch and the owner merges it once. No new helper starts after this.
      if (loop.handedOver) {
        return refusal('handed-over', 'You already handed the run over.');
      }
      if (d.agents.some((a) => a.kind !== 'lead' && isActiveAgentStatus(a.status))) {
        return refusal(
          'workers-still-running',
          'Some agents are still working; wait for them or stop them first.',
        );
      }
      const waiting = waitingLines(d);
      if (waiting.length > 0) {
        return refusal('changes-undecided', `Decide every change first:\n${waiting.join('\n')}`);
      }
      loop.handedOver = true;
      // `reconcile` starts the next stage, or moves the run to REVIEW for the owner's merge.
      return done;
    }
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
    const runInterrupted = ['QUEUED', 'PLANNING', 'PLAN_REVIEW', 'RUNNING', 'BLOCKED'].includes(
      d.run.status,
    );
    const stageInterrupted = d.agents.some((a) => isStageAgent(a) && isLiveAgentStatus(a.status));
    // ADR-0019: after a restart no stage starts by itself; the owner continues (`continueStages`).
    if (!cancelling && (runInterrupted || stageInterrupted) && hasFinalStages(d)) {
      d.stagesHeld = true;
    }
    d.settlePendingApprovals(null, 'expired', Draft.messages.deniedNoAnswer);
    // The processes are gone: no abort effects, and settled approvals have no callback to resolve.
    d.effects.length = 0;
    // An interrupted follow-up turn just ends (ADR-0020 §3); nothing resumes it.
    if (d.followUp !== undefined) d.followUp = { ...d.followUp, turn: null };
    for (const agent of d.agents) {
      if (isLiveAgentStatus(agent.status)) {
        d.setAgentStatus(agent, cancelling ? 'CANCELLED' : 'NEEDS_REVIEW');
      }
    }
    // ADR-0021 §5: helpers waiting for review and change reviewers became NEEDS_REVIEW above;
    // every undecided change goes to the owner. Nothing is relaunched.
    if (d.integration !== undefined && !cancelling) {
      for (const agent of d.agents) {
        const change = agent.change;
        if (change === undefined || isFinalChangeState(change.state)) continue;
        change.state = 'needs-owner';
        change.merging = false;
      }
    }
    if (cancelling) d.setRunStatus('CANCELLED');
    else if (['QUEUED', 'PLANNING', 'PLAN_REVIEW', 'RUNNING', 'BLOCKED'].includes(d.run.status)) {
      d.setRunStatus('NEEDS_REVIEW');
    }
    return done;
  });
}

/**
 * The owner's "Continue" after a restart (ADR-0019, ADR-0013 §7): a restart interrupted the run,
 * so the next post-merge stage waits (`RunState.stagesHeld`). Once every change is reviewed, this
 * starts it: the code review (again, if the restart cut the reviewer off before it finished), or
 * the unit tests. Nothing else ever relaunches an interrupted agent.
 */
export function continueStages(state: RunState, ctx: EngineContext): EngineResult {
  return applyCommand(state, ctx, (d) => {
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    if (!d.stagesHeld || d.run.status !== 'REVIEW') {
      return refusal('run-not-active', 'Nothing is waiting to continue.');
    }
    if (d.agents.some((a) => a.kind !== 'lead' && isLiveAgentStatus(a.status))) {
      return refusal('workers-still-running', 'Some agents are still working.');
    }
    const unreviewed =
      d.integration !== undefined
        ? undecidedChanges(d).length > 0
        : d.agents.some((a) => hasReviewableChange(a.kind) && a.review === 'pending');
    if (unreviewed) {
      return refusal('review-not-allowed', 'Review the remaining changes first.');
    }
    if (nextStage(d) === null) return refusal('run-not-active', 'No stage is left to start.');
    d.stagesHeld = false;
    // `reconcile` starts the stage.
    return done;
  });
}
