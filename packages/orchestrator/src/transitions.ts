import type { AgentRunStatus, RunStatus } from '@acp/core';
import { IllegalTransitionError } from './errors.js';

/**
 * Transition tables for milestone M1 (docs/orchestration-lifecycle.md §0). Anything not listed is
 * illegal. Restart edges (`→ NEEDS_REVIEW`) exist from every live state because interrupted work is
 * never relaunched (ADR-0013 §7).
 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = Object.freeze({
  QUEUED: ['RUNNING', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  RUNNING: ['BLOCKED', 'REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  // BLOCKED = every live agent waits for the owner (an approval or a budget decision).
  BLOCKED: ['RUNNING', 'REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  // REVIEW → COMPLETED only once the owner merged or discarded every worker's changes.
  REVIEW: ['COMPLETED', 'CANCELLING'],
  // After a restart the owner reviews what the interrupted workers left, or cancels.
  NEEDS_REVIEW: ['REVIEW', 'CANCELLING'],
  CANCELLING: ['CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
});

export const AGENT_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> =
  Object.freeze({
    QUEUED: ['STARTING', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW'],
    STARTING: ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_REVIEW'],
    RUNNING: [
      'WAITING_APPROVAL',
      'BLOCKED',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
      'NEEDS_REVIEW',
    ],
    // The SDK is parked in our permission callback, so it cannot succeed from here; it can crash.
    WAITING_APPROVAL: ['RUNNING', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_REVIEW'],
    // Budget soft cap (ADR-0014): the owner raises the cap (→ RUNNING) or stops the agent.
    BLOCKED: ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_REVIEW'],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: [],
    TIMED_OUT: [],
    NEEDS_REVIEW: [],
  });

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = Object.freeze(
  (Object.keys(RUN_TRANSITIONS) as RunStatus[]).filter((s) => RUN_TRANSITIONS[s].length === 0),
);
export const TERMINAL_AGENT_STATUSES: readonly AgentRunStatus[] = Object.freeze(
  (Object.keys(AGENT_TRANSITIONS) as AgentRunStatus[]).filter(
    (s) => AGENT_TRANSITIONS[s].length === 0,
  ),
);

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionAgent(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return AGENT_TRANSITIONS[from].includes(to);
}

/** Throws `IllegalTransitionError` unless `from → to` is in `RUN_TRANSITIONS`. */
export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) throw new IllegalTransitionError('run', from, to);
}

/** Throws `IllegalTransitionError` unless `from → to` is in `AGENT_TRANSITIONS`. */
export function assertAgentTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!canTransitionAgent(from, to)) throw new IllegalTransitionError('agent', from, to);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return RUN_TRANSITIONS[status].length === 0;
}

/** Live = not ended: the agent may still run, spend budget, or ask for approval. */
export function isLiveAgentStatus(status: AgentRunStatus): boolean {
  return AGENT_TRANSITIONS[status].length > 0;
}
