import { CHANGE_DECISION_TOOL_NAMES, LEAD_TOOL_NAMES, LeadToolInputs } from '@acp/core';
import type { AgentRoleKind, LeadToolName } from '@acp/core';
import type { z } from 'zod';
import { beginChangeMerge, recordChangeDecision } from './change-commands.js';
import { applyCommand, requestReview, stopAgent } from './commands.js';
import { formatTokens } from './draft.js';
import { refusal } from './errors.js';
import { changeSummary } from './loop.js';
import { submitPlan } from './plan.js';
import {
  checkNodeInstances,
  checkRunActive,
  checkStartAgent,
  isAgentOverBudget,
  mayStartHelpers,
} from './policy.js';
import { helperNodeOf, programOf, resolveHelper } from './program.js';
import { withAgentNoteLine } from './agent-note.js';
import { reportWork } from './report-tool.js';
import { postReview, submitReview } from './review-tool.js';
import { cleanSummary } from './summary.js';
import {
  hasReviewableChange,
  isChangeReviewer,
  isSeparatePlanner,
  launchFieldsFor,
} from './stages.js';
import type { EngineAgent, EngineContext, EngineResult, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';
import { runLimits } from './limits.js';
import { agentDepth } from './tree.js';

export interface LeadToolCall {
  /**
   * The agent that made the call: the lead, or a helper allowed to start helpers (depth 2), which
   * gets the child-management tools for its own children only (ADR-0013 amendment). Also the
   * planner (`submit_plan` only) and the reviewer (`post_review` only), ADR-0019; and a change
   * reviewer (`submit_review` only), ADR-0021.
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
  tester: 'The tester can only report its work (report_work).',
});

/**
 * The control-plane tools one agent may use, for its `ManagedAgentSpec` (ADR-0019; the engine
 * still checks every call):
 * - lead: every lead tool; in separate planner mode, without `submit_plan`; the change tools
 *   (ADR-0021) only in a run with the review loop;
 * - planner: `submit_plan`; reviewer: `post_review`; change reviewer: `submit_review`;
 * - worker: the child-management tools when it may start helpers (depth 2), else none; none in a
 *   rework turn (ADR-0021); plus `report_work` in a ticket run (ADR-0026 §3);
 * - tester: `report_work` in a ticket run, else none.
 */
export function controlToolsFor(state: RunState, agentRunId: string): readonly string[] {
  const agent = state.agents.find((a) => a.id === agentRunId);
  if (agent === undefined) return [];
  const kind: AgentRoleKind = agent.kind;
  switch (kind) {
    case 'lead':
      return LEAD_TOOL_NAMES.filter(
        (n) =>
          n !== 'post_review' &&
          n !== 'submit_review' &&
          n !== 'report_work' &&
          (state.integration !== undefined || !CHANGE_DECISION_TOOL_NAMES.includes(n)) &&
          !(n === 'submit_plan' && isSeparatePlanner(state)),
      );
    case 'planner':
      return ['submit_plan'];
    case 'reviewer':
      return isChangeReviewer(agent) ? ['submit_review'] : ['post_review'];
    case 'worker': {
      const children =
        agent.change === undefined && mayStartHelpers(state, agent) ? CHILD_MANAGEMENT_TOOLS : [];
      return state.run.ticketId === null ? children : [...children, 'report_work'];
    }
    case 'tester':
      return state.run.ticketId === null ? [] : ['report_work'];
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
  const loop = state.integration !== undefined;
  if (call.name === 'report_work') {
    // ADR-0026 §3: the helper's and tester's note; nobody else has it.
    if (caller.kind !== 'worker' && caller.kind !== 'tester') {
      return {
        ok: false,
        refusal: refusal(
          'not-lead',
          isChangeReviewer(caller)
            ? 'A change reviewer can only submit its review (submit_review).'
            : caller.kind === 'lead'
              ? 'Only helpers and the tester report their work.'
              : NOT_YOUR_TOOL[caller.kind],
        ),
      };
    }
    const parsed = LeadToolInputs.report_work.safeParse(call.input);
    if (!parsed.success) return invalid(parsed.error);
    return reportWork(state, caller.id, parsed.data.note, ctx);
  }
  if (caller.kind === 'planner' || caller.kind === 'reviewer' || caller.kind === 'tester') {
    // ADR-0019: the planner's one tool is submit_plan; the reviewer's is post_review; a change
    // reviewer's (ADR-0021) is submit_review.
    const changeReviewer = isChangeReviewer(caller);
    const own =
      (caller.kind === 'planner' && call.name === 'submit_plan') ||
      (caller.kind === 'reviewer' &&
        call.name === (changeReviewer ? 'submit_review' : 'post_review'));
    if (!own) {
      return {
        ok: false,
        refusal: refusal(
          'not-lead',
          changeReviewer
            ? 'A change reviewer can only submit its review (submit_review).'
            : NOT_YOUR_TOOL[caller.kind],
        ),
      };
    }
  } else if (call.name === 'post_review') {
    return { ok: false, refusal: refusal('not-lead', 'Only the reviewer can post a review.') };
  } else if (call.name === 'submit_review' && loop) {
    return {
      ok: false,
      refusal: refusal('not-lead', 'Only a change reviewer can submit a change review.'),
    };
  } else if (caller.kind !== 'lead') {
    // A helper may manage its own children only when the run allows depth 2 (ADR-0013 amendment),
    // and never in a rework turn (ADR-0021).
    const childTool = CHILD_MANAGEMENT_TOOLS.includes(call.name);
    if (!childTool || !mayStartHelpers(state, caller) || caller.change !== undefined) {
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
  /** ADR-0021: the lead's change tools act on a helper's or the tester's change. */
  const findChangeOwner = (agentId: string): EngineAgent | undefined =>
    state.agents.find((a) => a.id === agentId && hasReviewableChange(a.kind));
  /** Loop runs: the caller's "Latest" line names what it did (ADR-0021 fix). */
  const humanized = (text: string) => (d: { agent: (id: string) => EngineAgent | undefined }) => {
    const self = d.agent(caller.id);
    if (self !== undefined) self.latestActivity = cleanSummary(text, 'Working');
  };

  switch (call.name) {
    case 'start_agent': {
      const parsed = LeadToolInputs.start_agent.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const { role, task, helper } = parsed.data;
      const policyRefusal = checkStartAgent(state, caller.id, call.registeredProjectIds);
      if (policyRefusal !== null) return { ok: false, refusal: policyRefusal };
      // ADR-0023 §7: the helper node to start. A helper's own helpers belong to its node.
      const program = programOf(state);
      const resolved =
        caller.kind === 'worker'
          ? (() => {
              const node = helperNodeOf(program, caller);
              return node === undefined
                ? ({ ok: false, message: 'This workflow has no helper node.' } as const)
                : ({ ok: true, node } as const);
            })()
          : resolveHelper(program, { helper, role });
      if (!resolved.ok) {
        return { ok: false, refusal: refusal('invalid-input', resolved.message) };
      }
      const node = resolved.node;
      const instanceRefusal = checkNodeInstances(state, node);
      if (instanceRefusal !== null) return { ok: false, refusal: instanceRefusal };
      return applyCommand(state, ctx, (d) => {
        const id = d.freshId();
        // Depth of the new helper: one below its caller; its node must allow helpers of its own.
        const canStartHelpers =
          node.canStartHelpers && agentDepth(d, caller) + 2 <= runLimits(d).maxDepth;
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
          // Ticket runs record each agent's node (ADR-0019, ADR-0023).
          ...(d.run.ticketId !== null ? { stage: node.id } : {}),
        };
        d.agents.push(worker);
        d.setAgentStatus(worker, 'STARTING');
        // ADR-0021 §4: helpers of a loop run start from the ticket branch's tip.
        const branch = d.integration?.ticketBranch ?? null;
        d.effects.push({
          type: 'start-agent',
          agentRunId: id,
          kind: 'worker',
          role,
          // ADR-0026 §3: a ticket run's helper ends with its note (`report_work`).
          ...launchFieldsFor(program, node.id, withAgentNoteLine(task, d.run.ticketId !== null)),
          ...(canStartHelpers ? { canStartHelpers: true } : {}),
          ...(branch !== null ? { fromBranch: branch } : {}),
          ...d.launchModeFields(worker),
        });
        if (d.integration !== undefined) humanized(`Started ${role}`)(d);
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
      if (!loop) return readOnly(state, describeAgent(target));
      return applyCommand(state, ctx, (d) => {
        humanized(`Checked on ${target.role}`)(d);
        return { value: describeAgent(target) };
      });
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
      if (target.status === 'AWAITING_REVIEW') {
        return {
          ok: false,
          refusal: refusal(
            'agent-not-live',
            'That helper finished its turn; its change is under review. Use request_rework to send it back with comments.',
          ),
        };
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
        if (d.integration !== undefined) humanized(`Messaged ${target.role}`)(d);
        return { value: `Message sent to ${target.role}.` };
      });
    }

    case 'stop_agent': {
      const parsed = LeadToolInputs.stop_agent.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const target = findManaged(parsed.data.agentId);
      if (target === undefined) return unknownWorker();
      const stopped = stopAgent(state, target.id, ctx);
      if (stopped.ok && loop) {
        const lead = stopped.state.agents.find((a) => a.id === caller.id);
        if (lead !== undefined)
          lead.latestActivity = cleanSummary(`Stopped ${target.role}`, 'Working');
      }
      return withReply(stopped, `Stopped ${target.role}.`);
    }

    case 'request_review': {
      const parsed = LeadToolInputs.request_review.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      return withReply(
        requestReview(state, ctx, { summary: parsed.data.summary }),
        loop
          ? 'Handed over. The final review and tests, if the project runs them, work on the ticket branch and their findings come to you. Then the owner merges the ticket branch.'
          : 'The owner can now review the changes.',
      );
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

    // ADR-0021 review loop. Runs without it never offer these tools; a call is refused.
    case 'view_change': {
      const parsed = LeadToolInputs.view_change.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      if (!loop) return noLoopTool();
      const target = findChangeOwner(parsed.data.agentId);
      if (target?.change === undefined) return unknownChange();
      // The summary only; the server appends the diff (`viewChangeReply`, at most 32 KiB).
      const summary = changeSummary(state, target);
      return applyCommand(state, ctx, (d) => {
        humanized(`Looked at ${target.role}'s change`)(d);
        return { value: summary };
      });
    }

    case 'merge_change': {
      const parsed = LeadToolInputs.merge_change.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      if (!loop) return noLoopTool();
      const target = findChangeOwner(parsed.data.agentId);
      if (target === undefined) return unknownChange();
      // The server merges on `merge-change`, then answers the lead with the result's text.
      return beginChangeMerge(state, target.id, { by: 'lead' }, ctx);
    }

    case 'request_rework': {
      const parsed = LeadToolInputs.request_rework.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      if (!loop) return noLoopTool();
      const target = findChangeOwner(parsed.data.agentId);
      if (target === undefined) return unknownChange();
      return recordChangeDecision(
        state,
        target.id,
        { decision: 'rework', by: 'lead', comments: parsed.data.comments },
        ctx,
      );
    }

    case 'discard_change': {
      const parsed = LeadToolInputs.discard_change.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      if (!loop) return noLoopTool();
      const target = findChangeOwner(parsed.data.agentId);
      if (target === undefined) return unknownChange();
      return recordChangeDecision(
        state,
        target.id,
        { decision: 'discard', by: 'lead', comments: parsed.data.reason },
        ctx,
      );
    }

    case 'ask_owner': {
      const parsed = LeadToolInputs.ask_owner.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      if (!loop) return noLoopTool();
      const target = findChangeOwner(parsed.data.agentId);
      if (target === undefined) return unknownChange();
      return recordChangeDecision(
        state,
        target.id,
        { decision: 'ask-owner', by: 'lead', comments: parsed.data.question },
        ctx,
      );
    }

    case 'submit_review': {
      if (!loop) return noLoopTool();
      const parsed = LeadToolInputs.submit_review.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      return submitReview(state, caller.id, parsed.data, ctx);
    }
  }
}

/** A review-loop tool called in a run without the loop (the same text since RL-0). */
function noLoopTool(): EngineResult<string> {
  return {
    ok: false,
    refusal: refusal('run-not-active', 'This run has no review loop, so this tool is unavailable.'),
  };
}

function unknownChange(): EngineResult<string> {
  return {
    ok: false,
    refusal: refusal('change-not-found', 'No helper with a change in this run has that id.'),
  };
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
