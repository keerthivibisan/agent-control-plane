import { DEFAULT_AGENT_BUDGET_TOKENS, TokenCountsSchema } from '@acp/core';
import type { ManagedAgentEvent, RunBudget } from '@acp/core';
import type { FollowUpUnavailableReason, RunFollowUpDto } from '@acp/core/api';
import {
  agentBudgetUsage,
  budgetOvershoot,
  EMPTY_LEDGER,
  isOverBudget,
  recordUsage,
} from './budget.js';
import { Draft } from './draft.js';
import { refusal } from './errors.js';
import type { Refusal } from './errors.js';
import { stageAgentFor, stageModelFor } from './stages.js';
import type { EngineAgent, EngineContext, EngineResult, FollowUpState, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * Follow-up turns of an ended lead (ADR-0020): the owner's message resumes the lead's saved
 * conversation for one answers-only turn. These commands never change the run's or any agent's
 * status (a COMPLETED run stays COMPLETED): they skip `Draft.reconcile`, and the lead's agent
 * record and its budget stay as they ended. The turn's state lives in `RunState.followUp`, in
 * memory only, so a restart relaunches nothing.
 */

/**
 * Written by the app before the owner's message (ADR-0020 §2). The resumed session keeps the
 * system prompt it started with (docs/research/sdk-session-resume-2026-10-16.md §4), so the
 * answers-only rule is stated here and enforced by the adapter's tool options.
 */
export const FOLLOW_UP_PREFACE =
  '[Agent Control Plane] This run has ended. You are back for one turn only, to answer the ' +
  "owner's message below. You can read files in the project, but you cannot change files, run " +
  'commands, start helpers or submit plans. If the owner asks for new code work, tell them it ' +
  'needs a new run with a plan they approve; you may outline what that plan could contain.';

/** The first user message of a follow-up turn: the app's preface, then the owner's own words. */
export function followUpPrompt(message: string): string {
  return `${FOLLOW_UP_PREFACE}\n\nThe owner's message:\n${message}`;
}

/**
 * Budget tokens one follow-up turn may use: the run's per-agent budget, which a ticket run takes
 * from the project's limits (`runSettingsFromSetup`), else the default agent budget.
 */
export function followUpBudgetTokens(budget: RunBudget): number {
  const max = budget.maxTokensPerAgent;
  return Number.isInteger(max) && max > 0 ? max : DEFAULT_AGENT_BUDGET_TOKENS;
}

/** What only the server knows about a run's follow-up chat. */
export interface FollowUpFacts {
  /** Managed agents are on (an adapter is configured). */
  managed: boolean;
  /** The lead's linked provider session id (`agent_run_sessions`, primary), or null. */
  leadSessionId: string | null;
  /**
   * The ended lead's own process is still winding down. Resuming now would put one session in two
   * processes (research §7), so the box waits as if a turn were under way.
   */
  leadProcessActive: boolean;
}

/** The parts of a run (or a command's draft) the follow-up view reads. */
interface FollowUpSubject {
  agents: readonly EngineAgent[];
  followUp?: FollowUpState | undefined;
}

function leadOf(state: FollowUpSubject): EngineAgent | undefined {
  return state.agents.find((a) => a.kind === 'lead');
}

/** True when the run's lead has ended (or never existed): chat goes to a follow-up turn. */
export function leadHasEnded(state: FollowUpSubject): boolean {
  const lead = leadOf(state);
  return lead === undefined || !isLiveAgentStatus(lead.status);
}

const unavailable = (reason: FollowUpUnavailableReason): RunFollowUpDto => ({
  state: 'unavailable',
  reason,
});

/**
 * `RunDetailDto.followUp`: absent while the lead is live (chat goes to it as before); otherwise
 * whether a message can bring it back, is already being answered, or why the chat can't go on.
 */
export function followUpView(
  state: FollowUpSubject,
  facts: FollowUpFacts,
): RunFollowUpDto | undefined {
  if (!leadHasEnded(state)) return undefined;
  if (!facts.managed) return unavailable('managed-off');
  if (leadOf(state) === undefined || facts.leadSessionId === null) {
    return unavailable('no-session');
  }
  if (state.followUp?.sessionGone === true) return unavailable('session-gone');
  if ((state.followUp?.turn ?? null) !== null || facts.leadProcessActive) {
    return { state: 'running', reason: null };
  }
  return { state: 'available', reason: null };
}

const UNAVAILABLE_MESSAGE: Readonly<Record<FollowUpUnavailableReason, string>> = {
  'no-session': "This chat can't be continued: the lead never reported a saved conversation.",
  'session-gone':
    "This chat can't be continued: Claude Code no longer has the lead's conversation.",
  'managed-off': "This chat can't be continued: managed agents are turned off.",
};

type Body<T> = Refusal | { value: T };

/** Like `applyCommand`, but without `reconcile`: a follow-up never moves the run or its agents. */
function applyFollowUp<T>(
  state: RunState,
  ctx: EngineContext,
  body: (draft: Draft) => Body<T>,
): EngineResult<T> {
  const draft = new Draft(state, ctx);
  const outcome = body(draft);
  if ('code' in outcome) return { ok: false, refusal: outcome };
  return { ok: true, state: draft.finish(), effects: draft.effects, value: outcome.value };
}

const done = { value: undefined } as const;

/**
 * The owner's message to an ended lead (ADR-0020 §1): stored, then one follow-up turn starts that
 * resumes the lead's saved session. Refused while a turn runs (one at a time), and when the chat
 * can't be continued (no session, session gone, managed agents off).
 */
export function followUpChat(
  state: RunState,
  text: string,
  ctx: EngineContext,
  facts: FollowUpFacts,
): EngineResult {
  return applyFollowUp(state, ctx, (d) => {
    const message = text.trim();
    if (message.length === 0) return refusal('invalid-input', 'The message is empty.');
    const view = followUpView(d, facts);
    if (view === undefined) {
      return refusal('follow-up-unavailable', 'The lead is still working; chat goes to it.');
    }
    if (view.state === 'running') {
      return refusal('follow-up-running', 'The lead is still answering; wait for its reply.');
    }
    if (view.state === 'unavailable') {
      return refusal('follow-up-unavailable', UNAVAILABLE_MESSAGE[view.reason ?? 'no-session']);
    }
    const lead = d.lead();
    const resumeSessionId = facts.leadSessionId;
    // `followUpView` said available, which needs both.
    if (lead === undefined || resumeSessionId === null) {
      return refusal('follow-up-unavailable', UNAVAILABLE_MESSAGE['no-session']);
    }
    d.followUp = {
      sessionGone: false,
      turn: {
        resumeSessionId,
        budgetLimit: followUpBudgetTokens(d.run.budget),
        ledger: EMPTY_LEDGER,
        budgetTokensUsed: 0,
        resumed: false,
        aborting: false,
      },
    };
    const model = stageModelFor(d.workflow, 'lead');
    const agent = stageAgentFor(d.workflow, 'lead');
    d.effects.push({ type: 'chat-message', role: 'owner', text: message });
    d.effects.push({
      type: 'start-follow-up',
      agentRunId: lead.id,
      resumeSessionId,
      prompt: followUpPrompt(message),
      ...(model !== null ? { model } : {}),
      ...(agent !== null ? { agent } : {}),
    });
    return done;
  });
}

/**
 * One adapter event of the follow-up turn. The lead's text is stored as chat (ADR-0015); usage
 * counts against the turn's budget only (deduplicated by message id, and never a message the run
 * already counted); the reported cost is ignored, since a resumed session's cost includes its
 * earlier spend (research §6). `finished` ends the turn; an error before the session answered
 * means the resume failed, so the session is remembered as gone.
 */
export function followUpEvent(
  state: RunState,
  event: ManagedAgentEvent,
  ctx: EngineContext,
): EngineResult {
  return applyFollowUp(state, ctx, (d) => {
    const turn = d.followUp?.turn ?? null;
    const lead = d.lead();
    if (d.followUp === undefined || turn === null || lead === undefined) {
      return refusal('agent-not-live', 'No follow-up turn is under way.');
    }
    switch (event.type) {
      case 'started':
        // Same session id expected (no fork); usage of another one would not reach the lead.
        if (event.providerSessionId !== turn.resumeSessionId) {
          d.effects.push({
            type: 'diagnostic',
            code: 'follow-up-session-changed',
            agentRunId: lead.id,
          });
        }
        return done;

      case 'activity':
        return done;

      case 'usage': {
        const parsed = TokenCountsSchema.safeParse(event.tokens);
        if (!parsed.success || event.messageId.length === 0) {
          d.effects.push({ type: 'diagnostic', code: 'invalid-usage', agentRunId: lead.id });
          return done;
        }
        turn.resumed = true;
        // A message the run's own ledger already holds was counted for the lead (a replay).
        if (Object.hasOwn(d.ledger.entries, event.messageId)) return done;
        turn.ledger = recordUsage(turn.ledger, lead.id, event.messageId, parsed.data);
        turn.budgetTokensUsed = agentBudgetUsage(turn.ledger, lead.id).used;
        if (!turn.aborting && isOverBudget(turn.budgetTokensUsed, turn.budgetLimit)) {
          turn.aborting = true;
          d.effects.push({
            type: 'budget-overshoot',
            agentRunId: lead.id,
            used: turn.budgetTokensUsed,
            limit: turn.budgetLimit,
            overshoot: budgetOvershoot(turn.budgetTokensUsed, turn.budgetLimit),
          });
          d.effects.push({
            type: 'diagnostic',
            code: 'follow-up-over-budget',
            agentRunId: lead.id,
          });
          d.effects.push({ type: 'abort-follow-up', agentRunId: lead.id });
        }
        return done;
      }

      case 'lead-text':
        if (event.text.trim().length > 0) {
          turn.resumed = true;
          d.effects.push({ type: 'chat-message', role: 'lead', text: event.text });
        }
        return done;

      case 'finished':
        d.followUp = {
          sessionGone: event.outcome === 'error' && !turn.resumed,
          turn: null,
        };
        return done;
    }
  });
}

/** The owner's Stop on a follow-up turn: ends it; its `finished` follows from the adapter. */
export function stopFollowUp(state: RunState, ctx: EngineContext): EngineResult {
  return applyFollowUp(state, ctx, (d) => {
    const turn = d.followUp?.turn ?? null;
    const lead = d.lead();
    if (turn === null || lead === undefined) {
      return refusal('agent-not-live', 'The agent has already stopped.');
    }
    if (!turn.aborting) {
      turn.aborting = true;
      d.effects.push({ type: 'abort-follow-up', agentRunId: lead.id });
    }
    return done;
  });
}

/** Used by Stop all and the run timeout: a follow-up turn under way ends with the run's agents. */
export function abortFollowUpTurn(d: Draft): void {
  const turn = d.followUp?.turn ?? null;
  const lead = d.lead();
  if (turn === null || turn.aborting || lead === undefined) return;
  turn.aborting = true;
  d.effects.push({ type: 'abort-follow-up', agentRunId: lead.id });
}
