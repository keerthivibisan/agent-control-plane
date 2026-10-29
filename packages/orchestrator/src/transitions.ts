import type { AgentRunStatus, RunStatus } from '@acp/core';
import { IllegalTransitionError } from './errors.js';

/**
 * Transition tables for milestone M1 (docs/orchestration-lifecycle.md §0). Anything not listed is
 * illegal. Restart edges (`→ NEEDS_REVIEW`) exist from every live state because interrupted work is
 * never relaunched (ADR-0013 §7).
 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = Object.freeze({
  QUEUED: ['PLANNING', 'RUNNING', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  // Phase 4 plan-first (ADR-0016): the lead submits a plan, the owner approves (→ RUNNING) or
  // requests changes (→ PLANNING). A lead that ends before an approved plan fails the run (no
  // helper can exist yet, so there is nothing to review).
  PLANNING: ['PLAN_REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  PLAN_REVIEW: ['PLANNING', 'RUNNING', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  RUNNING: ['BLOCKED', 'REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  // BLOCKED = every live agent waits for the owner (an approval or a budget decision).
  BLOCKED: ['RUNNING', 'REVIEW', 'FAILED', 'CANCELLING', 'NEEDS_REVIEW'],
  // REVIEW → COMPLETED only once the owner merged or discarded every worker's changes (legacy), or
  // merged or discarded the ticket branch (ADR-0021). REVIEW → RUNNING only for the owner's
  // "request changes" on the ticket branch while the lead is live (ADR-0021 §4).
  REVIEW: ['COMPLETED', 'RUNNING', 'CANCELLING'],
  // After a restart the owner reviews what the interrupted workers left, or cancels.
  NEEDS_REVIEW: ['REVIEW', 'RUNNING', 'CANCELLING'],
  CANCELLING: ['CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
});

export const AGENT_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> =
  Object.freeze({
    QUEUED: ['STARTING', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW'],
    // → AWAITING_REVIEW (ADR-0021 §3): a helper or tester of a review-loop run ended its turn.
    STARTING: [
      'RUNNING',
      'AWAITING_REVIEW',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
      'NEEDS_REVIEW',
    ],
    RUNNING: [
      'WAITING_APPROVAL',
      'BLOCKED',
      'AWAITING_REVIEW',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
      'NEEDS_REVIEW',
    ],
    // The SDK is parked in our permission callback, so it cannot succeed from here; it can crash.
    WAITING_APPROVAL: ['RUNNING', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_REVIEW'],
    // Budget soft cap (ADR-0014): the owner raises the cap (→ RUNNING) or stops the agent.
    BLOCKED: [
      'RUNNING',
      'AWAITING_REVIEW',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
      'NEEDS_REVIEW',
    ],
    // ADR-0021 review loop: no process runs while the change is sealed, reviewed and decided.
    // Rework → STARTING; merged or no changes → SUCCEEDED; discarded or Stop all → CANCELLED;
    // restart → NEEDS_REVIEW. FAILED is kept for a corrupt or unknown end.
    AWAITING_REVIEW: ['STARTING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW'],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: [],
    TIMED_OUT: [],
    NEEDS_REVIEW: ['STARTING'],
  });

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = Object.freeze(
  (Object.keys(RUN_TRANSITIONS) as RunStatus[]).filter((s) => RUN_TRANSITIONS[s].length === 0),
);
// A recovered agent has no process, even if an owner action can later restart it. Keep process
// liveness independent of the legal transition table so reopening a state cannot make it live.
export const TERMINAL_AGENT_STATUSES: readonly AgentRunStatus[] = Object.freeze([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'NEEDS_REVIEW',
]);

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
  return !TERMINAL_AGENT_STATUSES.includes(status);
}

/**
 * Active = live and not AWAITING_REVIEW (ADR-0021): a process runs (or is starting) for it. Used for
 * the helper limit, the live-worker checks and BLOCKED; an agent waiting for its change to be
 * decided has no process and holds no slot. Same as live for runs without the review loop.
 */
export function isActiveAgentStatus(status: AgentRunStatus): boolean {
  return status !== 'AWAITING_REVIEW' && isLiveAgentStatus(status);
}
