# ADR-0032: Usage accounting for managed Codex runs

- **Status:** accepted (project owner go-ahead 2026-11-07; record unit settled by the CX-1 spike,
  see "Amendment after CX-1")
- **Date:** 2026-11-07
- **Deciders:** project owner (CX series, 2026-11-07); implementing agent (draft)
- **Amends:** [docs/usage-accounting.md](../usage-accounting.md) (a Codex section), ADR-0006 and
  ADR-0014 (the budget ledger key)
- **Relates to:** [ADR-0031](0031-codex-provider.md), AGENTS.md §3 rules 1–3

## Context

Claude usage comes from transcripts: one record per API response, keyed by `message.id`, deduped
by `(provider, messageId)`, max output wins (usage-accounting §3–§5). Managed Claude runs also send
a `usage` event per response to the run budget, keyed by the same `messageId`
(`packages/orchestrator/src/budget.ts`).

The Codex app-server (CLI 0.166.0, [research note](../research/codex-app-server-2026-11-07.md))
reports usage only as a notification:

```
thread/tokenUsage/updated { threadId, turnId,
  tokenUsage: { total: Breakdown, last: Breakdown, modelContextWindow } }
Breakdown = { totalTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens,
              outputTokens, reasoningOutputTokens }
```

There is no per-response message id. `total` is cumulative for the thread, so summing it would
break rule 3 ("never sum cumulative snapshots"). The budget ledger is keyed by `messageId` alone,
so ids from two providers could collide.

## Decision

1. **Ledger key.** The run budget dedups by `(provider, messageId)`, the same rule as the
   database. Claude ids are unchanged.
2. **Record unit: one record per Codex turn.** At `turn/completed` the adapter emits one `usage`
   event with `messageId = "turn:" + turnId`. Its counts are the turn's delta of the cumulative
   `total`: the `total` at the last notification of this turn minus the `total` at the last
   notification before the turn (zero for a fresh thread). The delta is computed once, never
   summed again, and its provenance is `derived`.
3. **Mapping to ACP token counts.** `inputTokens − cachedInputTokens` gives uncached input;
   `cachedInputTokens` gives cache read; `cacheWriteInputTokens` gives cache creation;
   `outputTokens` gives output. `reasoningOutputTokens` is part of `outputTokens` and is not added
   again. A field the notification omits is `null`, never 0.
4. **No usage, no number.** A turn that ends with no usage notification records `null` usage
   (unavailable). It never records 0.
5. **Persistence.** The server writes each Codex `usage` event to `usage_records` with
   `provider = 'codex'`, through the same `buildUsageRecord` path, so the Tokens page and the
   budget read one source. The unique `(provider, message_id)` index makes a replay a no-op.
6. **Cost.** Codex reports no cost. Cost stays `null` until the pricing table (Phase 2); no
   combined dollar total across providers is shown.

## To confirm in CX-1 (and amend this ADR if wrong)

- `total` really is cumulative per thread, including after `thread/resume`.
- How many notifications come per turn, and whether `last` is one model request. If `last` is
  exactly one request with a stable order, a per-request record (`turn:<id>:<n>`, provenance
  `observed`) replaces decision 2.
- Whether `cachedInputTokens` is included in `inputTokens`.

## Amendment after CX-1 (2026-11-07, binding; replaces decision 2)

The spike ([research note](../research/codex-app-server-2026-11-07.md), results 3 and 4) showed one
notification per model request, `last` equal to that request, `total` cumulative across turns and
resumes, and an identical replay of the last notification after `thread/resume`. So:

- **Record unit: one record per model request.** Each `thread/tokenUsage/updated` becomes one
  `usage` event with the counts of `last`, provenance `observed`.
- **Message id:** `"<threadId>:<turnId>:<total.totalTokens>"`. The cumulative total strictly
  grows with each request and is identical in the replay, so the replay dedups on
  `(provider, messageId)` and nothing is summed.
- Decisions 1 and 3–6 stand. `inputTokens` includes `cachedInputTokens` (confirmed), so the
  subtraction in decision 3 is correct.

## Alternatives considered

- **Sum `last` over the turn.** Equivalent only if each notification is one distinct request;
  unknown, and a repeated notification would double count.
- **Read Codex session files.** That is observation (deferred by the owner) and would read
  `~/.codex`.
- **Store only the cumulative thread total.** Loses per-turn attribution and breaks the
  per-agent budget.

## Consequences

- The Tokens page shows Codex rows with `derived` provenance; the UI must show that badge.
- Usage-accounting §7 gains named Codex scenarios: delta per turn, resume, missing notification,
  replay, and a cross-provider id collision in the ledger.
