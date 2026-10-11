import { budgetTokens } from '@acp/core';
import type { TokenCounts } from '@acp/core';

/**
 * Budget accounting for managed agents (ADR-0014, usage-accounting §4–§5).
 *
 * The SDK reports usage per assistant message and may repeat a message with growing output counts,
 * so the ledger keeps one entry per messageId (dedup is global within the run, not per agent) and
 * selects the observation with the most output. It never sums repeated reports.
 *
 * Attribution: usage-accounting attributes to the earliest occurrence, but `ManagedAgentEvent` has
 * no provider timestamp, and arrival order is not evidence. Each agent is its own SDK query, so a
 * messageId reported by two agents is not expected; if it happens, the entry is attributed to the
 * smallest agentRunId so that replaying the same reports in any order gives the same budgets.
 */
export interface LedgerEntry {
  messageId: string;
  /** Every agent that reported this message, sorted; the first one is charged. */
  agentRunIds: readonly string[];
  /** The selected observation's counts (max output; see `compareUsage`). */
  tokens: TokenCounts;
}

export interface UsageLedger {
  readonly entries: Readonly<Record<string, LedgerEntry>>;
}

export const EMPTY_LEDGER: UsageLedger = Object.freeze({ entries: Object.freeze({}) });

const rank = (n: number | null): number => (n === null ? -1 : n);

/**
 * Total order on observations of one message: most output first (usage-accounting §5.1), then the
 * remaining counts as tie-breaks. Two observations that compare equal have identical counts, so the
 * selection does not depend on the order reports arrive in.
 */
export function compareUsage(a: TokenCounts, b: TokenCounts): number {
  const keys = (t: TokenCounts): number[] => [
    rank(t.output),
    rank(budgetTokens(t)),
    rank(t.input),
    rank(t.cacheCreation),
    rank(t.cacheRead),
  ];
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Adds one usage report. Pure: returns a new ledger. */
export function recordUsage(
  ledger: UsageLedger,
  agentRunId: string,
  messageId: string,
  tokens: TokenCounts,
): UsageLedger {
  const existing = Object.hasOwn(ledger.entries, messageId) ? ledger.entries[messageId] : undefined;
  const entry: LedgerEntry =
    existing === undefined
      ? { messageId, agentRunIds: [agentRunId], tokens: { ...tokens } }
      : {
          messageId,
          agentRunIds: existing.agentRunIds.includes(agentRunId)
            ? existing.agentRunIds
            : [...existing.agentRunIds, agentRunId].sort(),
          tokens: compareUsage(tokens, existing.tokens) > 0 ? { ...tokens } : existing.tokens,
        };
  // A computed key defines an own property even for "__proto__", so any messageId is safe.
  return { entries: { ...ledger.entries, [messageId]: entry } };
}

export interface AgentBudgetUsage {
  /** Budget tokens charged to the agent (ADR-0014). Messages with no counted category add nothing. */
  used: number;
  /** Messages charged to the agent with at least one counted category. */
  countedMessages: number;
  /** Messages charged to the agent whose counted categories were all unavailable (null). */
  unavailableMessages: number;
}

export function agentBudgetUsage(ledger: UsageLedger, agentRunId: string): AgentBudgetUsage {
  let used = 0;
  let countedMessages = 0;
  let unavailableMessages = 0;
  for (const entry of Object.values(ledger.entries)) {
    if (entry.agentRunIds[0] !== agentRunId) continue;
    const b = budgetTokens(entry.tokens);
    if (b === null) unavailableMessages++;
    else {
      used += b;
      countedMessages++;
    }
  }
  return { used, countedMessages, unavailableMessages };
}

/** How far past its cap an agent is. 0 while under or at the cap. */
export function budgetOvershoot(used: number, limit: number): number {
  return Math.max(0, used - limit);
}

/** The soft cap is reached once usage is at or above the limit (ADR-0014). */
export function isOverBudget(used: number, limit: number): boolean {
  return used >= limit;
}
