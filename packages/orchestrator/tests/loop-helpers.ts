import type { ChangeReviewerMode, ProjectApprovals, ProjectWorkflow } from '@acp/core';
import {
  changeSealed,
  createRun,
  decidePlan,
  leadToolCall,
  ticketBranchCreated,
} from '../src/index.js';
import type { EngineEffect, EngineResult, RunState } from '../src/index.js';
import {
  LEAD,
  PROJECT,
  REGISTERED,
  RUN,
  TICKET,
  agentOf,
  event,
  makeCtx,
  ok,
  submitPlanFor,
} from './helpers.js';
import { PLANNER, submitAs } from './workflow-helpers.js';

/** Review-loop test helpers (ADR-0021). Synthetic data only. */

export const KEY = 'WEB-12';
export const BRANCH = 'acp/WEB-12';
export const COMMIT = 'abc1234';

export interface LoopOptions {
  reviewer?: ChangeReviewerMode;
  rounds?: number;
  workflow?: ProjectWorkflow;
  limits?: { maxConcurrentHelpers: number; maxDepth: number };
  approvals?: ProjectApprovals;
  budget?: number;
}

/** A loop ticket run, created (PLANNING; lead mode: lead STARTING; separate: planner STARTING). */
export function createLoopRun(o: LoopOptions = {}): EngineResult<RunState> {
  const separate = o.workflow?.plannerMode === 'separate';
  return createRun(
    {
      runId: RUN,
      leadAgentRunId: LEAD,
      projectId: PROJECT,
      title: 'WEB-12 Dark mode',
      budget: { maxTokensPerAgent: o.budget ?? 1000, softCostUsdPerRun: null },
      limits: o.limits ?? { maxConcurrentHelpers: 3, maxDepth: 1 },
      ticket: {
        ticketId: TICKET,
        leadPrompt: separate ? 'Lead brief for WEB-12' : 'Ticket WEB-12: plan first',
        ...(separate ? { plannerPrompt: 'Plan ticket WEB-12' } : {}),
      },
      ...(o.workflow !== undefined ? { workflow: o.workflow } : {}),
      reviewLoop: {
        ticketKey: KEY,
        reviewer: o.reviewer ?? 'agent',
        maxReworkRounds: o.rounds ?? 2,
      },
      ...(o.approvals !== undefined ? { approvals: o.approvals } : {}),
      registeredProjectIds: REGISTERED,
    },
    makeCtx(),
  );
}

/** Plan approved, the ticket branch created, the lead RUNNING. */
export function loopRunning(o: LoopOptions = {}): RunState {
  let s = ok(createLoopRun(o)).state;
  const separate = o.workflow?.plannerMode === 'separate';
  const author = separate ? PLANNER : LEAD;
  s = ok(
    event(s, author, { type: 'started', providerSessionId: `sess-${author}`, model: null }),
  ).state;
  let planId: string;
  if (separate) {
    s = ok(submitAs(s, PLANNER)).state;
    planId = 'p-1';
  } else {
    const r = submitPlanFor(s);
    s = r.state;
    planId = r.planId;
  }
  s = ok(decidePlan(s, planId, 'approve', makeCtx(1600, 'd'))).state;
  if (separate) {
    s = ok(event(s, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
  }
  return ok(ticketBranchCreated(s, BRANCH, makeCtx(1700))).state;
}

export function leadTool(
  state: RunState,
  name: string,
  input: unknown,
  prefix = 'lt',
  caller = LEAD,
  offset = 2500,
) {
  return leadToolCall(
    state,
    { callerAgentRunId: caller, name, input, registeredProjectIds: REGISTERED },
    makeCtx(offset, prefix),
  );
}

/** Starts a helper (id `<prefix>-1`) and reports its session. */
export function helper(state: RunState, role: string, prefix: string): RunState {
  const started = ok(leadTool(state, 'start_agent', { role, task: `Build the ${role}` }, prefix));
  const id = `${prefix}-1`;
  return ok(
    event(started.state, id, { type: 'started', providerSessionId: `sess-${id}`, model: null }),
  ).state;
}

export function finishTurn(
  state: RunState,
  id: string,
  outcome: 'success' | 'error' = 'success',
  offset = 4000,
) {
  return event(state, id, { type: 'finished', outcome, reportedCostUsd: null }, offset);
}

/** The server sealed the change (ids for agents the next reconcile starts: `<prefix>-1`, …). */
export function sealed(
  state: RunState,
  id: string,
  prefix = 'rv',
  changed = true,
  headCommit: string | null = COMMIT,
  offset = 5000,
) {
  return changeSealed(
    state,
    id,
    { changed, headCommit, changedFiles: changed ? 2 : 0 },
    makeCtx(offset, prefix),
  );
}

/** Helper `id` finished and was sealed; its review agent is `<prefix>-1`. */
export function readyForReview(state: RunState, id: string, prefix = 'rv'): RunState {
  return ok(sealed(ok(finishTurn(state, id)).state, id, prefix)).state;
}

export function changeOf(state: RunState, id: string) {
  const change = agentOf(state, id).change;
  if (change === undefined) throw new Error(`no change for ${id}`);
  return change;
}

export const types = (effects: readonly EngineEffect[]) => effects.map((e) => e.type);

export function effectsOf<T extends EngineEffect['type']>(
  effects: readonly EngineEffect[],
  type: T,
): Extract<EngineEffect, { type: T }>[] {
  return effects.filter((e): e is Extract<EngineEffect, { type: T }> => e.type === type);
}

/** The text of every message the engine sent to the lead. */
export function leadMessages(effects: readonly EngineEffect[]): string[] {
  return effectsOf(effects, 'send-to-agent')
    .filter((e) => e.agentRunId === LEAD)
    .map((e) => e.text);
}
