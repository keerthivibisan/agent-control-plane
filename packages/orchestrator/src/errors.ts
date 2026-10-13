/**
 * Why the engine refused a request (ADR-0013). Refusals are expected outcomes, not bugs: the model
 * or the owner asked for something the policy forbids. They carry a machine code for the server's
 * ErrorDto and a short message that is safe to show the model or the owner (no chat text in it).
 */
export const REFUSAL_CODES = [
  /** The run's project is not (or no longer) a registered project. */
  'project-not-registered',
  /** The run's helper limit (`RunLimits.maxConcurrentHelpers`) is reached. */
  'too-many-agents',
  /** The new agent would be deeper than the run allows (`RunLimits.maxDepth`). */
  'depth-exceeded',
  /** The run is cancelling or cancelled; nothing new is scheduled. */
  'run-cancelling',
  /** The run is in a state that does not accept this request (e.g. REVIEW, COMPLETED). */
  'run-not-active',
  /** The agent reached its budget cap (ADR-0014) and waits for the owner. */
  'over-budget',
  /** Tool input failed `LeadToolInputs` validation. */
  'invalid-input',
  /** Not one of the lead tools (ADR-0012). */
  'unknown-tool',
  /** Only the lead agent may call lead tools. */
  'not-lead',
  'unknown-agent',
  /** The target agent has already ended, or is the lead itself where a worker is required. */
  'agent-not-live',
  /** Review was requested while workers are still live. */
  'workers-still-running',
  'approval-not-found',
  /** The approval was already decided or expired. */
  'approval-not-pending',
  /** Review actions are only valid for an ended worker with a pending review, in REVIEW or NEEDS_REVIEW. */
  'review-not-allowed',
  /** A state change the transition tables do not allow. */
  'illegal-transition',
  /** An id supplied by the caller is already used in this run. */
  'duplicate-id',
  /** Plan-first (ADR-0016): helpers, edits and commands wait until the owner approves a plan. */
  'plan-not-approved',
  'plan-not-found',
  /** The plan is not the one waiting for the owner's decision (already decided or superseded). */
  'plan-not-pending',
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export interface Refusal {
  code: RefusalCode;
  message: string;
}

export function refusal(code: RefusalCode, message: string): Refusal {
  return { code, message };
}

/** Thrown by the low-level transition helpers; the command layer turns it into a refusal. */
export class IllegalTransitionError extends Error {
  override readonly name = 'IllegalTransitionError';
  readonly code = 'illegal-transition' as const;
  constructor(
    readonly entity: 'run' | 'agent',
    readonly from: string,
    readonly to: string,
  ) {
    super(`illegal ${entity} transition ${from} -> ${to}`);
  }
}
