import {
  HARD_MAX_DEPTH,
  HARD_MAX_HELPERS,
  MAX_CONCURRENT_CHILD_AGENTS,
  MAX_DELEGATION_DEPTH,
} from '@acp/core';
import type { ProjectAgentSetup, RunBudget } from '@acp/core';
import { refusal } from './errors.js';
import type { Refusal } from './errors.js';
import type { RunLimits, RunState } from './state.js';

/** The Phase 3 limits, used for runs created without project limits (ADR-0013). */
export const DEFAULT_RUN_LIMITS: Readonly<RunLimits> = Object.freeze({
  maxConcurrentHelpers: MAX_CONCURRENT_CHILD_AGENTS,
  maxDepth: MAX_DELEGATION_DEPTH,
});

/** The limits a run is held to; runs stored without limits keep the Phase 3 defaults. */
export function runLimits(state: Pick<RunState, 'limits'>): RunLimits {
  return state.limits ?? DEFAULT_RUN_LIMITS;
}

/**
 * Checks limits against the hard ceilings (ADR-0013 amendment). The setup schema already bounds
 * them, but the engine never trusts its caller with a policy limit.
 */
export function checkRunLimits(limits: RunLimits): Refusal | null {
  const { maxConcurrentHelpers: helpers, maxDepth: depth } = limits;
  if (!Number.isInteger(helpers) || helpers < 1 || helpers > HARD_MAX_HELPERS) {
    return refusal('invalid-input', `Helpers at once must be a whole number from 1 to ${HARD_MAX_HELPERS}.`);
  }
  if (!Number.isInteger(depth) || depth < 1 || depth > HARD_MAX_DEPTH) {
    return refusal('invalid-input', `Helper depth must be a whole number from 1 to ${HARD_MAX_DEPTH}.`);
  }
  return null;
}

/** The run settings a project's agent setup implies (README §4.1 step 2). */
export function runSettingsFromSetup(
  setup: Pick<ProjectAgentSetup, 'maxConcurrentHelpers' | 'maxDepth' | 'defaultBudgetTokensPerAgent'>,
): { limits: RunLimits; budget: RunBudget } {
  return {
    limits: { maxConcurrentHelpers: setup.maxConcurrentHelpers, maxDepth: setup.maxDepth },
    budget: { maxTokensPerAgent: setup.defaultBudgetTokensPerAgent, softCostUsdPerRun: null },
  };
}
