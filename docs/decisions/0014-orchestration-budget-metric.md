# ADR-0014: Budget metric for managed runs

- **Status:** accepted (project owner, 2026-10-11)
- **Date:** 2026-10-11
- **Resolves:** roadmap Q1

## Context

Local data shows cache-read tokens in the billions for long sessions; one turn re-reads the whole
context. A budget that counts cache reads is used up almost at once (orchestration-lifecycle §4).

## Decision

- **Budget tokens** = output + uncached input + cache write, per usage record
  (`budgetTokens()` in `@acp/core`). Cache reads are tracked and shown, never counted. A record with
  none of the counted categories is unavailable (null), never 0.
- Per-agent cap, default `DEFAULT_AGENT_BUDGET_TOKENS` (500,000), set per run by the owner.
- Usage is deduplicated by `(provider, messageId)` as in usage-accounting §4.
- The cap is **soft**: calls already in flight may overshoot, and the overshoot is reported. Reaching
  it moves the agent to `BLOCKED` and asks the owner (raise the cap, or stop).
- Optional soft warning on provider-reported estimated cost (`softCostUsdPerRun`): it fires when **any
  single agent's** latest reported cost passes the value. Costs of different agents are never added
  up (the Phase 1 rule "cost is never summed" still holds). It never stops anything and is always
  labeled "estimated".
- Duplicate message ids across agents (no timestamp in the managed event) are charged to one agent
  deterministically (the smallest agent run id), so replay order never changes a budget.

## Alternatives considered

Estimated USD from a pricing table (needs Phase 2 pricing first); separate per-category caps (hard to
set sensibly).
