import { LeadToolInputs } from '@acp/core';
import type { LeadToolName } from '@acp/core';
import type { z } from 'zod';
import { applyCommand, requestReview, stopAgent } from './commands.js';
import { formatTokens } from './draft.js';
import { refusal } from './errors.js';
import { checkRunActive, checkStartAgent, isAgentOverBudget } from './policy.js';
import type { EngineAgent, EngineContext, EngineResult, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

export interface LeadToolCall {
  /** The agent that made the call; only the lead may (ADR-0012, depth 1). */
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
  if (caller.kind !== 'lead') {
    // Workers never get lead tools; if one calls anyway, starting agents is a depth violation.
    return {
      ok: false,
      refusal:
        call.name === 'start_agent'
          ? refusal('depth-exceeded', 'Only the lead agent can start agents.')
          : refusal('not-lead', 'Only the lead agent can use this tool.'),
    };
  }

  switch (call.name) {
    case 'start_agent': {
      const parsed = LeadToolInputs.start_agent.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const { role, task } = parsed.data;
      const policyRefusal = checkStartAgent(state, caller.id, call.registeredProjectIds);
      if (policyRefusal !== null) return { ok: false, refusal: policyRefusal };
      return applyCommand(state, ctx, (d) => {
        const id = d.freshId();
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
        };
        d.agents.push(worker);
        d.setAgentStatus(worker, 'STARTING');
        d.effects.push({ type: 'start-agent', agentRunId: id, kind: 'worker', role, prompt: task });
        return { value: `Started agent ${id} (${role}).` };
      });
    }

    case 'list_agents': {
      const parsed = LeadToolInputs.list_agents.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const workers = state.agents.filter((a) => a.kind === 'worker');
      return readOnly(
        state,
        workers.length === 0
          ? 'No agents started yet.'
          : workers.map((w) => `- ${w.id}: ${w.role}, ${w.status}`).join('\n'),
      );
    }

    case 'agent_status': {
      const parsed = LeadToolInputs.agent_status.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const target = findWorker(state, parsed.data.agentId);
      if (target === undefined) return unknownWorker();
      return readOnly(state, describeAgent(target));
    }

    case 'message_agent': {
      const parsed = LeadToolInputs.message_agent.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      const runRefusal = checkRunActive(state.run.status);
      if (runRefusal !== null) return { ok: false, refusal: runRefusal };
      const target = findWorker(state, parsed.data.agentId);
      if (target === undefined) return unknownWorker();
      if (!isLiveAgentStatus(target.status)) {
        return { ok: false, refusal: refusal('agent-not-live', 'That agent has stopped.') };
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
      const target = findWorker(state, parsed.data.agentId);
      if (target === undefined) return unknownWorker();
      return withReply(stopAgent(state, target.id, ctx), `Stopped ${target.role}.`);
    }

    case 'request_review': {
      const parsed = LeadToolInputs.request_review.safeParse(call.input);
      if (!parsed.success) return invalid(parsed.error);
      return withReply(requestReview(state, ctx), 'The owner can now review the changes.');
    }

    case 'submit_plan':
      // Contract added in P4-0; the plan phase itself is P4-A. Until then a plan cannot be filed.
      return {
        ok: false,
        refusal: refusal('invalid-input', 'Plans are not supported by this engine version yet.'),
      };
  }
}

function findWorker(state: RunState, agentId: string): EngineAgent | undefined {
  return state.agents.find((a) => a.id === agentId && a.kind === 'worker');
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
