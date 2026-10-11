import { MAX_CONCURRENT_CHILD_AGENTS, MAX_DELEGATION_DEPTH } from '@acp/core';
import type { RunStatus } from '@acp/core';
import { refusal } from './errors.js';
import type { Refusal } from './errors.js';
import { isOverBudget } from './budget.js';
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

/** Depth of an agent in the run's tree: the lead is 0, its workers 1. */
export function agentDepth(state: RunState, agent: EngineAgent): number {
  let depth = 0;
  let parentId = agent.parentAgentRunId;
  // Bounded by the agent count, so a corrupt cycle cannot loop forever.
  for (let i = 0; parentId !== null && i <= state.agents.length; i++) {
    depth++;
    const parent = state.agents.find((a) => a.id === parentId);
    parentId = parent === undefined ? null : parent.parentAgentRunId;
  }
  return depth;
}

export function isAgentOverBudget(agent: EngineAgent): boolean {
  return agent.status === 'BLOCKED' || isOverBudget(agent.budgetTokensUsed, agent.budgetLimit);
}

/**
 * `start_agent` policy (ADR-0013 §2–§3): the run accepts work, the project is registered, the
 * caller is the lead (the child stays within `MAX_DELEGATION_DEPTH`), the caller is within budget,
 * and fewer than `MAX_CONCURRENT_CHILD_AGENTS` workers are live.
 */
export function checkStartAgent(
  state: RunState,
  callerAgentRunId: string,
  registeredProjectIds: Iterable<string>,
): Refusal | null {
  const runRefusal = checkRunActive(state.run.status);
  if (runRefusal !== null) return runRefusal;

  const projectRefusal = checkProjectRegistered(state.run.projectId, registeredProjectIds);
  if (projectRefusal !== null) return projectRefusal;

  const caller = state.agents.find((a) => a.id === callerAgentRunId);
  if (caller === undefined) return refusal('unknown-agent', 'Unknown calling agent.');
  if (agentDepth(state, caller) + 1 > MAX_DELEGATION_DEPTH) {
    return refusal('depth-exceeded', 'Only the lead agent can start agents.');
  }
  if (!isLiveAgentStatus(caller.status)) {
    return refusal('agent-not-live', 'The calling agent has ended.');
  }
  if (isAgentOverBudget(caller)) {
    return refusal('over-budget', 'The lead agent reached its budget; the owner must raise it.');
  }

  const liveWorkers = state.agents.filter(
    (a) => a.kind === 'worker' && isLiveAgentStatus(a.status),
  ).length;
  if (liveWorkers >= MAX_CONCURRENT_CHILD_AGENTS) {
    return refusal(
      'too-many-agents',
      `At most ${MAX_CONCURRENT_CHILD_AGENTS} agents can work at once; wait for one to finish.`,
    );
  }
  return null;
}

/** Owner review actions apply to an ended worker whose review is pending (ADR-0013 §5). */
export function checkReviewAction(state: RunState, agentRunId: string): Refusal | null {
  if (state.run.status !== 'REVIEW' && state.run.status !== 'NEEDS_REVIEW') {
    return refusal('review-not-allowed', 'Changes can be reviewed once every agent has stopped.');
  }
  const agent = state.agents.find((a) => a.id === agentRunId);
  if (agent === undefined) return refusal('unknown-agent', 'Unknown agent.');
  if (agent.kind !== 'worker' || isLiveAgentStatus(agent.status) || agent.review !== 'pending') {
    return refusal('review-not-allowed', 'This agent has no changes waiting for review.');
  }
  return null;
}
