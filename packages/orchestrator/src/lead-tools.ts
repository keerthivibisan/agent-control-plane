import { LEAD_TOOL_NAMES, LeadToolInputs, REVIEW_LOOP_TOOL_NAMES } from '@acp/core';
import type { AgentRoleKind, LeadToolName } from '@acp/core';
import type { z } from 'zod';
import { applyCommand, requestReview, stopAgent } from './commands.js';
import { formatTokens } from './draft.js';
import { refusal } from './errors.js';
import { submitPlan } from './plan.js';
import { checkRunActive, checkStartAgent, isAgentOverBudget, mayStartHelpers } from './policy.js';
import { postReview } from './review-tool.js';
import { isSeparatePlanner, launchFields } from './stages.js';
import type { EngineAgent, EngineContext, EngineResult, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';
import { runLimits } from './limits.js';
import { agentDepth } from './tree.js';

export interface LeadToolCall {
  /**
   * The agent that made the call: the lead, or a helper allowed to start helpers (depth 2), which
   * gets the child-management tools for its own children only (ADR-0013 amendment). Also the
   * planner (`submit_plan` only) and the reviewer (`post_review` only), ADR-0019.
   */
  callerAgentRunId: string;
  /** Tool name as the model sent it; anything outside `LeadToolInputs` is refused. */
  name: string;
  /** Raw tool input; validated here with `LeadToolInputs` (ADR-0013). */
  input: unknown;
  /** Projects registered right now; `start_agent` is refused if the run's project is not among them. */
  registeredProjectIds: Iterable<string>;
}

function isLeadToolName(name: string): name is LeadToolName {
  return Object.hasOwn(LeadToolInputs, name);
}

/** Tools a depth-2 parent helper gets (`ManagedAgentSpec.canStartHelpers`); never plan or review. */
export const CHILD_MANAGEMENT_TOOLS: readonly LeadToolName[] = Object.freeze([
  'start_agent',
  'list_agents',
  'message_agent',
  'stop_agent',
  'agent_status',
]);

/** What the planner, reviewer and tester are told when they call a tool that is not theirs. */
const NOT_YOUR_TOOL: Readonly<Record<'planner' | 'reviewer' | 'tester', string>> = Object.freeze({
  planner: 'The planner can only submit the plan (submit_plan).',
  reviewer: 'The reviewer can only post its findings (post_review).',
  tester: 'The tester has no control-plane tools.',
});

/**
 * The control-plane tools one agent may use, for its `ManagedAgentSpec` (ADR-0019; the engine
 * still checks every call):
 * - lead: every lead tool; in separate planner mode, without `submit_plan`;
 * - planner: `submit_plan`; reviewer: `post_review`;
 * - worker: the child-management tools when it may start helpers (depth 2), else none;
 * - tester: none.
 */
export function controlToolsFor(state: RunState, agentRunId: string): readonly string[] {
  const agent = state.agents.find((a) => a.id === agentRunId);
  if (agent === undefined) return [];
  const kind: AgentRoleKind = agent.kind;
  switch (kind) {
    case 'lead':
      // RL-0 placeholder: the review-loop tools (ADR-0021) are offered once RL-A handles them.
      return LEAD_TOOL_NAMES.filter(
        (n) =>
          n !== 'post_review' &&
          !REVIEW_LOOP_TOOL_NAMES.includes(n) &&
          !(n === 'submit_plan' && isSeparatePlanner(state)),
      );
    case 'planner':
      return ['submit_plan'];
    case 'reviewer':
      return ['post_review'];
    case 'worker':
      return mayStartHelpers(state, agent) ? CHILD_MANAGEMENT_TOOLS : [];
    case 'tester':
      return [];
  }
}

/** Field paths and messages only; never echo input values (they may hold task text). */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : 'input'}: ${i.message}`)
    .join('; ');
}

/**
 * Validates and executes one lead tool call. On success `value` is the text returned to the model;
 * on refusal the server returns `refusal.message` to the model instead. Refusals change nothing.
 */
export function leadToolCall(
  state: RunState,
  call: LeadToolCall,
  ctx: EngineContext,
): EngineResult<string> {
  if (!isLeadToolName(call.name)) {
    return { ok: false, refusal: refusal('unknown-tool', 'That is not one of the lead tools.') };
  }
  const caller = state.agents.find((a) => a.id === call.callerAgentRunId);
  if (caller === undefined) {
    return { ok: false, refusal: refusal('unknown-agent', 'Unknown calling agent.') };
  }
  if (caller.kind === 'planner' || caller.kind === 'reviewer' || caller.kind === 'tester') {
    // ADR-0019: the planner's one tool is submit_plan; the reviewer's is post_review.
    const own =
      (caller.kind === 'planner' && call.name === 'submit_plan') ||
      (caller.kind === 'reviewer' && call.name === 'post_review');
    if (!own) return { ok: false, refusal: refusal('not-lead', NOT_YOUR_TOOL[caller.kind]) };
  } else if (call.name === 'post_review') {
    return { ok: false, refusal: refusal('not-lead', 'Only the reviewer can post a review.') };
  } else if (caller.kind !== 'lead') {
    // A helper may manage its own children only when the run allows depth 2 (ADR-0013 amendment).
    const childTool = CHILD_MANAGEMENT_TOOLS.includes(call.name);
    if (!childTool || !mayStartHelpers(state, caller)) {
      return {
        ok: false,
        refusal:
          call.name === 'start_agent'
            ? refusal(
                'depth-exceeded',
                runLimits(state).maxDepth === 1
                  ? 'Only the lead agent can start agents.'
                  : 'Helpers of helpers cannot start more agents.',
              )
            : refusal('not-lead', 'Only the lead agent can use this tool.'),
      };
    }
  }
  /** The agents the caller manages: every helper for the lead, its own children for a helper. */
  const manages = (a: EngineAgent): boolean =>
    a.kind === 'worker' && (caller.kind === 'lead' || a.parentAgentRunId === caller.id);
  const findManaged = (agentId: string): EngineAgent | undefined =>
    state.agents.find((a) => a.id === agentId && manages(a));

  switch (call.name) {
    case 'start_agent': {
      const parsed = LeadToolInputs.start_agent.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const { role, task } = parsed.data;
      const policyRefusal = checkStartAgent(state, caller.id, call.registeredProjectIds);
      if (policyRefusal !== null) return { ok: false, refusal: policyRefusal };
      return applyCommand(state, ctx, (d) => {
        const id = d.freshId();
        // Depth of the new helper: one below its caller.
        const canStartHelpers = agentDepth(d, caller) + 2 <= runLimits(d).maxDepth;
        const worker: EngineAgent = {
          id,
          runId: d.run.id,
          parentAgentRunId: caller.id,
          kind: 'worker',
          role,
          task,
          status: 'QUEUED',
          sessionId: null,
          budgetTokensUsed: 0,
          createdAt: d.now,
          endedAt: null,
          budgetLimit: d.run.budget.maxTokensPerAgent,
          latestActivity: null,
          review: null,
          reportedCostUsd: null,
          // Ticket runs record each agent's stage (ADR-0019); helpers of helpers are helpers too.
          ...(d.run.ticketId !== null ? { stage: 'helpers' as const } : {}),
        };
        d.agents.push(worker);
        d.setAgentStatus(worker, 'STARTING');
        d.effects.push({
          type: 'start-agent',
          agentRunId: id,
          kind: 'worker',
          role,
          ...launchFields(task, d.workflow, 'worker'),
          ...(canStartHelpers ? { canStartHelpers: true } : {}),
        });
        return { value: `Started agent ${id} (${role}).` };
      });
    }

    case 'list_agents': {
      const parsed = LeadToolInputs.list_agents.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const workers = state.agents.filter(manages);
      return readOnly(
        state,
        workers.length === 0
          ? 'No agents started yet.'
          : workers
              .map((w) => {
                const under =
                  caller.kind === 'lead' && w.parentAgentRunId !== caller.id
                    ? ` (helper of ${w.parentAgentRunId ?? 'unknown'})`
                    : '';
                return `- ${w.id}: ${w.role}, ${w.status}${under}`;
              })
              .join('\n'),
      );
    }

    case 'agent_status': {
      const parsed = LeadToolInputs.agent_status.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const target = findManaged(parsed.data.agentId);
      if (target === undefined) return unknownWorker();
      return readOnly(state, describeAgent(target));
    }

    case 'message_agent': {
      const parsed = LeadToolInputs.message_agent.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const runRefusal = checkRunActive(state.run.status);
      if (runRefusal !== null) return { ok: false, refusal: runRefusal };
      const target = findManaged(parsed.data.agentId);
      if (target === undefined) return unknownWorker();
      if (!isLiveAgentStatus(target.status)) {
        return { ok: false, refusal: refusal('agent-not-live', 'That agent has stopped.') };
      }
      if (target.awaitingHelpers === true) {
        return {
          ok: false,
          refusal: refusal(
            'agent-not-live',
            'That agent finished its own work and is waiting for its helpers.',
          ),
        };
      }
      if (isAgentOverBudget(target)) {
        return {
          ok: false,
          refusal: refusal(
            'over-budget',
            'That agent reached its budget; the owner must raise it.',
          ),
        };
      }
      const text = parsed.data.text;
      return applyCommand(state, ctx, (d) => {
        // Sent, never stored: lead-to-worker messages are worker conversation (ADR-0015).
        d.effects.push({ type: 'send-to-agent', agentRunId: target.id, text });
        return { value: `Message sent to ${target.role}.` };
      });
    }

    case 'stop_agent': {
      const parsed = LeadToolInputs.stop_agent.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const target = findManaged(parsed.data.agentId);
      if (target === undefined) return unknownWorker();
      return withReply(stopAgent(state, target.id, ctx), `Stopped ${target.role}.`);
    }

    case 'request_review': {
      const parsed = LeadToolInputs.request_review.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      return withReply(requestReview(state, ctx), 'The owner can now review the changes.');
    }

    case 'submit_plan': {
      const parsed = LeadToolInputs.submit_plan.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      return submitPlan(state, caller.id, parsed.data, ctx);
    }

    case 'post_review': {
      const parsed = LeadToolInputs.post_review.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      return postReview(state, caller.id, parsed.data.text, ctx);
    }

    // RL-0 placeholder (ADR-0021): the review-loop tools exist in the contract, but no agent is
    // offered them and no run has the loop yet. RL-A replaces this with the real handlers.
    case 'view_change':
    case 'merge_change':
    case 'request_rework':
    case 'discard_change':
    case 'ask_owner':
    case 'submit_review':
      return {
        ok: false,
        refusal: refusal(
          'run-not-active',
          'This run has no review loop, so this tool is unavailable.',
        ),
      };
  }
}

function describeAgent(a: EngineAgent): string {
  const lines = [
    `${a.role}: ${a.status}`,
    `Budget: ${formatTokens(a.budgetTokensUsed)} of ${formatTokens(a.budgetLimit)} budget tokens`,
  ];
  if (a.latestActivity !== null) lines.push(`Latest activity: ${a.latestActivity}`);
  return lines.join('\n');
}

function invalid(error: z.ZodError): EngineResult<string> {
  return {
    ok: false,
    refusal: refusal('invalid-input', `Invalid input: ${describeIssues(error)}`),
  };
}

function unknownWorker(): EngineResult<string> {
  return { ok: false, refusal: refusal('unknown-agent', 'No agent with that id in this run.') };
}

/** Queries change nothing: the input state comes back as-is, with no effects. */
function readOnly(state: RunState, reply: string): EngineResult<string> {
  return { ok: true, state, effects: [], value: reply };
}

function withReply(result: EngineResult, reply: string): EngineResult<string> {
  return result.ok ? { ...result, value: reply } : result;
}
