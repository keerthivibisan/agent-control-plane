import type { TokenCounts } from '../usage/usage.js';

/**
 * Phase 3 policy limits (ADR-0013). The engine enforces them; the model is never trusted to.
 */
export const MAX_CONCURRENT_CHILD_AGENTS = 3;
/** Children of the lead agent may not start agents of their own. */
export const MAX_DELEGATION_DEPTH = 1;
/** Default per-agent budget in budget tokens (ADR-0014); the owner can change it per run. */
export const DEFAULT_AGENT_BUDGET_TOKENS = 500_000;
/** An approval nobody answers is denied after this long (ADR-0013). */
export const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Budget tokens for one usage record (ADR-0014): output plus new input, i.e. uncached input and
 * cache writes. Cache reads are tracked but not counted, because one turn re-reads the whole
 * context and they would exhaust any cap almost at once. Returns null when none of the counted
 * categories was reported (unavailable, never 0).
 */
export function budgetTokens(tokens: TokenCounts): number | null {
  const parts = [tokens.input, tokens.cacheCreation, tokens.output];
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}
