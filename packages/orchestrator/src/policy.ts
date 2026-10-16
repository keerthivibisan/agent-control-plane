import type { RunStatus } from '@acp/core';
import { refusal } from './errors.js';
import type { Refusal } from './errors.js';
import { isOverBudget } from './budget.js';
import { runLimits } from './limits.js';
import { countsAsHelper, hasReviewableChange } from './stages.js';
import { agentDepth } from './tree.js';
import { isLiveAgentStatus } from './transitions.js';
import type { EngineAgent, RunState } from './state.js';

/**
 * Policy checks (ADR-0013 §3). The model plans; these decide. Each returns null when allowed, or a
 * typed refusal. They read state only; the commands apply the change.
 */

/** Run states in which new work may be scheduled or agents steered. */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = Object.freeze(['RUNNING', 'BLOCKED']);

export function checkRunActive(status: RunStatus): Refusal | null {
  if (status === 'CANCELLING' || status === 'CANCELLED') {
    return refusal('run-cancelling', 'The run is being stopped; nothing new can start.');
  }
  if (!ACTIVE_RUN_STATUSES.includes(status)) {
    return refusal(
      'run-not-active',
      `The run is ${status.toLowerCase()}; it does not accept this.`,
    );
  }
  return null;
}

export function checkProjectRegistered(
  projectId: string,
  registeredProjectIds: Iterable<string>,
): Refusal | null {
  for (const id of registeredProjectIds) if (id === projectId) return null;
  return refusal('project-not-registered', 'Agents run only for registered projects.');
}

export function isAgentOverBudget(agent: EngineAgent): boolean {
  return agent.status === 'BLOCKED' || isOverBudget(agent.budgetTokensUsed, agent.budgetLimit);
}

/** Plan-first runs (ADR-0016): while planning, helpers, edits and commands wait for approval. */
export function checkPlanApproved(status: RunStatus): Refusal | null {
  if (status === 'PLANNING' || status === 'PLAN_REVIEW') {
    return refusal(
      'plan-not-approved',
      status === 'PLANNING'
        ? 'Plan first: read what you need, then call submit_plan. Helpers, edits and commands wait until the owner approves the plan.'
        : 'Your plan is waiting for the owner. Helpers, edits and commands wait until the owner approves it.',
    );
  }
  return null;
}

/**
 * Whether an agent may start helpers of its own: only the lead and helpers (ADR-0019: the planner,
 * reviewer and tester never do), and the new helper must fit `RunLimits.maxDepth`.
 */
export function mayStartHelpers(state: RunState, agent: EngineAgent): boolean {
  if (agent.kind !== 'lead' && agent.kind !== 'worker') return false;
  return agentDepth(state, agent) + 1 <= runLimits(state).maxDepth;
}

/**
 * `start_agent` policy (ADR-0013 §2–§3 and its amendment): the run accepts work and its plan is
 * approved, the project is registered, the new helper stays within the run's `maxDepth`, the caller
 * is live and within budget, and fewer than the run's `maxConcurrentHelpers` helpers are live
 * (counted over the whole tree).
 */
export function checkStartAgent(
  state: RunState,
  callerAgentRunId: string,
  registeredProjectIds: Iterable<string>,
): Refusal | null {
  if (state.run.status !== 'CANCELLING' && state.run.status !== 'CANCELLED') {
    const planRefusal = checkPlanApproved(state.run.status);
    if (planRefusal !== null) return planRefusal;
  }
  const runRefusal = checkRunActive(state.run.status);
  if (runRefusal !== null) return runRefusal;

  const projectRefusal = checkProjectRegistered(state.run.projectId, registeredProjectIds);
  if (projectRefusal !== null) return projectRefusal;

  const caller = state.agents.find((a) => a.id === callerAgentRunId);
  if (caller === undefined) return refusal('unknown-agent', 'Unknown calling agent.');
  if (!mayStartHelpers(state, caller)) {
    return refusal(
      'depth-exceeded',
      runLimits(state).maxDepth === 1
        ? 'Only the lead agent can start agents.'
        : 'Helpers of helpers cannot start more agents.',
    );
  }
  if (!isLiveAgentStatus(caller.status)) {
    return refusal('agent-not-live', 'The calling agent has ended.');
  }
  if (isAgentOverBudget(caller)) {
    return refusal('over-budget', 'The calling agent reached its budget; the owner must raise it.');
  }

  const { maxConcurrentHelpers } = runLimits(state);
  // The reviewer and the tester count as one helper each (ADR-0019 §3).
  const liveWorkers = state.agents.filter(
    (a) => countsAsHelper(a.kind) && isLiveAgentStatus(a.status),
  ).length;
  if (liveWorkers >= maxConcurrentHelpers) {
    return refusal(
      'too-many-agents',
      `At most ${maxConcurrentHelpers} agents can work at once; wait for one to finish.`,
    );
  }
  return null;
}

/**
 * Owner review actions apply to an ended worker, or the tester (ADR-0019), whose review is pending
 * (ADR-0013 §5).
 */
export function checkReviewAction(state: RunState, agentRunId: string): Refusal | null {
  if (state.run.status !== 'REVIEW' && state.run.status !== 'NEEDS_REVIEW') {
    return refusal('review-not-allowed', 'Changes can be reviewed once every agent has stopped.');
  }
  const agent = state.agents.find((a) => a.id === agentRunId);
  if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
  if (
    !hasReviewableChange(agent.kind) ||
    isLiveAgentStatus(agent.status) ||
    agent.review !== 'pending'
  ) {
    return refusal('review-not-allowed', 'This agent has no changes waiting for review.');
  }
  return null;
}
