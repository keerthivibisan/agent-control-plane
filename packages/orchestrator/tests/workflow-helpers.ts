import { defaultProjectWorkflow } from '@acp/core';
import type { ProjectWorkflow } from '@acp/core';
import { createRun, decidePlan, leadToolCall, recordReview } from '../src/index.js';
import type { EngineResult, RunState } from '../src/index.js';
import {
  LEAD,
  PLAN_INPUT,
  PROJECT,
  REGISTERED,
  RUN,
  TICKET,
  event,
  makeCtx,
  ok,
  startWorker,
  submitPlanFor,
} from './helpers.js';

/** Workflow-stage test helpers (ADR-0019). Synthetic data only. */

export const WF_TIME = '2026-10-11T09:00:00.000Z';

type StageOverrides = {
  plannerMode?: ProjectWorkflow['plannerMode'];
  codeReview?: boolean;
  unitTests?: boolean;
  skills?: Partial<
    Record<'plan' | 'orchestrate' | 'helpers' | 'code-review' | 'unit-tests', string>
  >;
  models?: Partial<
    Record<'plan' | 'orchestrate' | 'helpers' | 'code-review' | 'unit-tests', string>
  >;
};

export function workflow(o: StageOverrides = {}): ProjectWorkflow {
  const wf = defaultProjectWorkflow(PROJECT, WF_TIME);
  const skill = (k: keyof NonNullable<StageOverrides['skills']>) => o.skills?.[k] ?? null;
  const model = (k: keyof NonNullable<StageOverrides['models']>) => o.models?.[k] ?? null;
  return {
    ...wf,
    plannerMode: o.plannerMode ?? 'lead',
    stages: {
      plan: { model: model('plan'), skill: skill('plan') },
      orchestrate: { model: model('orchestrate'), skill: skill('orchestrate') },
      helpers: { model: model('helpers'), skill: skill('helpers') },
      review: { requireChecks: true },
      'code-review': {
        enabled: o.codeReview ?? false,
        model: model('code-review'),
        skill: skill('code-review'),
      },
      'unit-tests': {
        enabled: o.unitTests ?? false,
        model: model('unit-tests'),
        skill: skill('unit-tests'),
      },
    },
  };
}

export const PLANNER_PROMPT = 'Plan ticket WEB-1';
export const LEAD_BRIEF = 'Lead brief for WEB-1';

/** A ticket run created with a workflow (result, so refusals and effects can be checked). */
export function createWithWorkflow(wf: ProjectWorkflow | undefined): EngineResult<RunState> {
  const separate = wf?.plannerMode === 'separate';
  return createRun(
    {
      runId: RUN,
      leadAgentRunId: LEAD,
      projectId: PROJECT,
      title: 'WEB-1 Dark mode',
      budget: { maxTokensPerAgent: 1000, softCostUsdPerRun: null },
      limits: { maxConcurrentHelpers: 3, maxDepth: 1 },
      ticket: {
        ticketId: TICKET,
        leadPrompt: separate ? LEAD_BRIEF : 'Ticket WEB-1: plan first',
        ...(separate ? { plannerPrompt: PLANNER_PROMPT } : {}),
      },
      ...(wf !== undefined ? { workflow: wf } : {}),
      registeredProjectIds: REGISTERED,
    },
    makeCtx(),
  );
}

/** The separate-mode planner's id: the first id of `createWithWorkflow`'s context. */
export const PLANNER = 'id-1';

/** A ticket run whose planning agent is RUNNING (lead mode: the lead; separate: the planner). */
export function planning(wf: ProjectWorkflow | undefined): RunState {
  const s = ok(createWithWorkflow(wf)).state;
  const author = wf?.plannerMode === 'separate' ? PLANNER : LEAD;
  return ok(event(s, author, { type: 'started', providerSessionId: `sess-${author}`, model: null }))
    .state;
}

export function submitAs(state: RunState, caller: string, prefix = 'p') {
  return leadToolCall(
    state,
    {
      callerAgentRunId: caller,
      name: 'submit_plan',
      input: PLAN_INPUT,
      registeredProjectIds: REGISTERED,
    },
    makeCtx(1500, prefix),
  );
}

/** Plan approved and the lead running (in separate mode the lead starts on approval). */
export function approved(wf: ProjectWorkflow | undefined): RunState {
  let s = planning(wf);
  const separate = wf?.plannerMode === 'separate';
  let planId: string;
  if (separate) {
    const r = ok(submitAs(s, PLANNER));
    s = r.state;
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
  return s;
}

export const WORKER = 'w-1';

/** One helper finished, the lead requested review: the run is REVIEW with the change pending. */
export function helperDone(wf: ProjectWorkflow | undefined): RunState {
  const w = startWorker(approved(wf), 'UI', 'w');
  let s = ok(
    event(w.state, WORKER, { type: 'finished', outcome: 'success', reportedCostUsd: null }, 4000),
  ).state;
  s = ok(
    leadToolCall(
      s,
      {
        callerAgentRunId: LEAD,
        name: 'request_review',
        input: {},
        registeredProjectIds: REGISTERED,
      },
      makeCtx(5000, 'rr'),
    ),
  ).state;
  return s;
}

/** The helper's change is merged (ids for agents the merge starts: `m-1`, `m-2`, …). */
export function merged(wf: ProjectWorkflow | undefined) {
  return recordReview(helperDone(wf), WORKER, 'merged', makeCtx(9000, 'm'));
}

export function finish(state: RunState, id: string, outcome: 'success' | 'error' = 'success') {
  return event(state, id, { type: 'finished', outcome, reportedCostUsd: null }, 10_000);
}

export function postReview(state: RunState, caller: string, text: unknown = 'Looks fine.') {
  return leadToolCall(
    state,
    {
      callerAgentRunId: caller,
      name: 'post_review',
      input: typeof text === 'string' ? { text } : text,
      registeredProjectIds: REGISTERED,
    },
    makeCtx(11_000, 'pr'),
  );
}
