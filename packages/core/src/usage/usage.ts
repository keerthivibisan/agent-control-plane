import { z } from 'zod';

const TokenCountSchema = z.number().int().nonnegative().nullable();

/**
 * Token counts by category. `null` means the source did not report that category:
 * it is unavailable and must never be coerced to 0 (ADR-0006).
 * Categories are priced differently and are never summed into one "total" for cost purposes.
 */
export const TokenCountsSchema = z.object({
  input: TokenCountSchema,
  output: TokenCountSchema,
  cacheCreation: TokenCountSchema,
  cacheRead: TokenCountSchema,
});
export type TokenCounts = z.infer<typeof TokenCountsSchema>;

/**
 * Usage reported for one provider API response (one assistant message).
 *
 * Dedup identity is (provider, messageId) across ALL sessions and files: Claude Code writes several
 * transcript lines per message with growing output counts, and forked sessions copy earlier messages
 * into new files under a new session id. See docs/usage-accounting.md.
 */
export const PerTurnUsageSchema = z.object({
  kind: z.literal('per-turn'),
  messageId: z.string().min(1),
  requestId: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  tokens: TokenCountsSchema,
});
export type PerTurnUsage = z.infer<typeof PerTurnUsageSchema>;

/**
 * Scope a cumulative snapshot covers. Claude Code's `cost-state` records do not state whether they
 * include subagents, so the adapter must report `unknown` unless the scope is verified.
 */
export const SnapshotScopeSchema = z.enum(['session', 'session-including-subagents', 'unknown']);

/**
 * A provider-reported running total. Stored as a snapshot and NEVER summed with per-turn usage
 * or with other snapshots (ADR-0006).
 */
export const CumulativeUsageSnapshotSchema = z.object({
  kind: z.literal('cumulative-snapshot'),
  scope: SnapshotScopeSchema,
  /** Token totals keyed by provider model identifier. */
  byModel: z.record(z.string().min(1), TokenCountsSchema),
  /** Provider-reported cost. Always treated as `estimated` provenance; null when not reported. */
  reportedCostUsd: z.number().nonnegative().nullable(),
});
export type CumulativeUsageSnapshot = z.infer<typeof CumulativeUsageSnapshotSchema>;
