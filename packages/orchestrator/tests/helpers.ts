import type { ManagedAgentEvent, TokenCounts } from '@acp/core';
import { agentEvent, createRun, leadToolCall, ownerChat } from '../src/index.js';
import type { EngineContext, EngineResult, RunState } from '../src/index.js';

/** Synthetic test data only; nothing here comes from real Claude Code sessions. */

export const PROJECT = 'proj-1';
export const REGISTERED = [PROJECT];
export const RUN = 'run-1';
export const LEAD = 'lead-1';

export const T0 = Date.parse('2026-10-11T10:00:00.000Z');

/** A context with a fixed clock (ms offset from T0) and sequential ids. */
export function makeCtx(offsetMs = 0, prefix = 'id'): EngineContext {
  let n = 0;
  return { now: new Date(T0 + offsetMs), newId: () => `${prefix}-${++n}` };
}

export function ok<T>(result: EngineResult<T>): Extract<EngineResult<T>, { ok: true }> {
  if (!result.ok)
    throw new Error(`expected ok, got ${result.refusal.code}: ${result.refusal.message}`);
  return result;
}

export function refused<T>(result: EngineResult<T>): string {
  if (result.ok) throw new Error('expected a refusal');
  return result.refusal.code;
}

export function tokens(
  output: number | null,
  input: number | null = 10,
  cw: number | null = 0,
  cr: number | null = 1000,
): TokenCounts {
  return { input, output, cacheCreation: cw, cacheRead: cr };
}

export function newRun(maxTokensPerAgent = 1000): RunState {
  return ok(
    createRun(
      {
        runId: RUN,
        leadAgentRunId: LEAD,
        projectId: PROJECT,
        title: 'Test run',
        budget: { maxTokensPerAgent, softCostUsdPerRun: null },
        registeredProjectIds: REGISTERED,
      },
      makeCtx(),
    ),
  ).state;
}

export function event(state: RunState, agentId: string, e: ManagedAgentEvent, offsetMs = 1000) {
  return agentEvent(state, agentId, e, makeCtx(offsetMs));
}

/** A run whose lead is RUNNING (the owner sent the first message, the SDK reported init). */
export function runningRun(maxTokensPerAgent = 1000): RunState {
  let s = ok(ownerChat(newRun(maxTokensPerAgent), 'build it', makeCtx(100))).state;
  s = ok(event(s, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
  return s;
}

/** Starts a worker through the lead's `start_agent`; returns the state and the new worker id. */
export function startWorker(
  state: RunState,
  role = 'Builder',
  prefix = `w${state.agents.length}`,
): { state: RunState; id: string } {
  const result = ok(
    leadToolCall(
      state,
      {
        callerAgentRunId: LEAD,
        name: 'start_agent',
        input: { role, task: 'Do the thing' },
        registeredProjectIds: REGISTERED,
      },
      makeCtx(2000, prefix),
    ),
  );
  const id = `${prefix}-1`;
  const started = ok(
    event(
      result.state,
      id,
      { type: 'started', providerSessionId: `sess-${id}`, model: null },
      3000,
    ),
  );
  return { state: started.state, id };
}

export function statusOf(state: RunState, id: string) {
  const a = state.agents.find((x) => x.id === id);
  if (a === undefined) throw new Error(`no agent ${id}`);
  return a.status;
}

export const TICKET = 'ticket-1';

/** A plan-first ticket run (ADR-0016) whose lead is RUNNING in PLANNING. */
export function planningRun(
  limits: { maxConcurrentHelpers: number; maxDepth: number } = {
    maxConcurrentHelpers: 3,
    maxDepth: 1,
  },
  maxTokensPerAgent = 1000,
): RunState {
  const created = ok(
    createRun(
      {
        runId: RUN,
        leadAgentRunId: LEAD,
        projectId: PROJECT,
        title: 'WEB-1 Dark mode',
        budget: { maxTokensPerAgent, softCostUsdPerRun: null },
        limits,
        ticket: { ticketId: TICKET, leadPrompt: 'Ticket WEB-1: plan first' },
        registeredProjectIds: REGISTERED,
      },
      makeCtx(),
    ),
  ).state;
  return ok(event(created, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null }))
    .state;
}

export const PLAN_INPUT = {
  summary: 'Add a theme store and a settings toggle.',
  steps: [
    { title: 'Theme store', role: 'Store', detail: 'Persist the theme.' },
    { title: 'Toggle', role: 'UI', detail: 'Add the switch.' },
    { title: 'Wire up', role: 'UI', detail: 'Connect the toggle to the store.' },
  ],
};

/** The lead submits a plan; returns the state (PLAN_REVIEW) and the new plan's id. */
export function submitPlanFor(state: RunState, prefix = 'p'): { state: RunState; planId: string } {
  const r = ok(
    leadToolCall(
      state,
      {
        callerAgentRunId: LEAD,
        name: 'submit_plan',
        input: PLAN_INPUT,
        registeredProjectIds: REGISTERED,
      },
      makeCtx(1500, prefix),
    ),
  );
  return { state: r.state, planId: `${prefix}-1` };
}

export function agentOf(state: RunState, id: string) {
  const a = state.agents.find((x) => x.id === id);
  if (a === undefined) throw new Error(`no agent ${id}`);
  return a;
}
