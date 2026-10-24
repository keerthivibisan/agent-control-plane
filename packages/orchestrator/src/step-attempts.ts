import type { ProgramHelperNode, TicketPlan } from '@acp/core';
import { refusal } from './errors.js';
import type { Refusal } from './errors.js';
import { programOf, resolveHelper } from './program.js';
import { stageOf } from './stages.js';
import type { EngineAgent, RunState } from './state.js';

/**
 * F-2 (T-1 after ACPGIT-3): replacement helpers are bounded per plan step. The lead of ACPGIT-3
 * started a new helper after every failed seal, and each did the same: a loop only the lead's
 * budget would have ended. Rework rounds were bounded; replacements were not.
 *
 * A **lost attempt** is a helper whose change was discarded (by the lead or the owner) or could
 * not be saved (`sealFailure`, also while it waits to be discarded). Work that merged, or that had
 * no changes, never counts, so a well-behaved run is never limited by this.
 *
 * - **Per plan step:** a step is the helper node a start resolves to plus its role (as the lead
 *   names a step's helper; case and spacing aside). It may lose `stepAttemptLimit` attempts:
 *   1 + the run's rework rounds, at least 2 (with the default 2 rounds, 3), times the steps of the
 *   approved plan with that role and node (at least one).
 * - **Per run** (so renaming the role cannot escape it): `stepAttemptLimit` times the approved
 *   plan's steps (at least one).
 *
 * Past either, `start_agent` is refused with a plain message: the lead hands over (request_review)
 * and the owner decides. Runs without the review loop have no discard, so no limit.
 */

/** Lost attempts one plan step may have before `start_agent` is refused for it. */
export function stepAttemptLimit(state: Pick<RunState, 'integration'>): number {
  return Math.max(2, 1 + (state.integration?.maxReworkRounds ?? 0));
}

/** A helper whose work was lost: its change was discarded or could not be saved. */
function isLostAttempt(agent: EngineAgent): boolean {
  const change = agent.change;
  return (
    agent.kind === 'worker' &&
    change !== undefined &&
    (change.state === 'discarded' || change.sealFailure !== undefined)
  );
}

const norm = (role: string): string => role.trim().replace(/\s+/g, ' ').toLowerCase();

/** The latest approved plan, or null. */
function approvedPlan(state: RunState): TicketPlan | null {
  let approved: TicketPlan | null = null;
  for (const plan of state.plans ?? []) {
    if (plan.status === 'approved' && (approved === null || plan.version > approved.version)) {
      approved = plan;
    }
  }
  return approved;
}

/** The approved plan's steps (node id and role of each); empty without one. */
function planSteps(state: RunState): { node: string | null; role: string }[] {
  const plan = approvedPlan(state);
  if (plan === null) return [];
  // The nodes `submit_plan` resolved (in memory), else the same resolution by each step's role.
  const resolved = state.planStepHelpers?.[plan.id];
  const program = programOf(state);
  return plan.steps.map((step, i) => {
    const byRole = () => {
      const r = resolveHelper(program, { role: step.role });
      return r.ok ? r.node.id : null;
    };
    return { node: resolved?.[i] ?? byRole(), role: norm(step.role) };
  });
}

export interface StepAttempts {
  /** Lost attempts of this step (node and role), and how many it may have. */
  step: { lost: number; allowed: number };
  /** Lost attempts of the whole run, and how many it may have. */
  run: { lost: number; allowed: number };
}

/** Lost attempts so far for a start of `role` on `node`, and the limits that apply. */
export function stepAttempts(state: RunState, node: ProgramHelperNode, role: string): StepAttempts {
  const limit = stepAttemptLimit(state);
  const key = norm(role);
  const steps = planSteps(state);
  const lost = state.agents.filter(isLostAttempt);
  const sameStep = steps.filter((s) => s.node === node.id && s.role === key).length;
  return {
    step: {
      lost: lost.filter((a) => stageOf(a) === node.id && norm(a.role) === key).length,
      allowed: limit * Math.max(1, sameStep),
    },
    run: { lost: lost.length, allowed: limit * Math.max(1, steps.length) },
  };
}

/**
 * `start_agent` of `role` on `node` (F-2): refused once its plan step, or the whole run, lost every
 * attempt it may have. Null in runs without the review loop.
 */
export function checkStepAttempts(
  state: RunState,
  node: ProgramHelperNode,
  role: string,
): Refusal | null {
  if (state.integration === undefined) return null;
  const { step, run } = stepAttempts(state, node, role);
  const what =
    step.lost >= step.allowed
      ? `${step.lost} helpers for this step (${role.trim()})`
      : run.lost >= run.allowed
        ? `${run.lost} helpers in this run`
        : null;
  if (what === null) return null;
  return refusal(
    'attempts-exhausted',
    `${what} had their work discarded or could not save it, which is as many as this run allows. Do not start another one: decide the changes still waiting, hand over with request_review, and say in your summary what is still missing. The owner decides what happens next.`,
  );
}
