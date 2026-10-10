# Event and usage accounting

> Status: contracts are **[core v1]**. The selection, attribution, and aggregation logic is
> **[implemented, P1-A]** as pure functions in `@acp/core` (`selectUsage`, `attributeUsage`,
> `buildUsageRecord`, `sumTokenCounts`, `aggregateUsage`). It is not yet wired into the pipeline
> (P1-D). The §5.2 tie amendment is implemented (task A9). Tables are **[planned, P1-B]**, and dedup-key construction is **[planned, P1-C]**. The
> numbers quoted come from a read-only scan of local data on 2026-10-10
> ([research note](research/claude-code-observations-2026-10-10.md)).

The goal: **no usage number is ever inflated, invented, or silently zero.**

## 1. Normalized event envelope (`@acp/core` `NormalizedEventSchema`)

| Field                                   | Meaning                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `schemaVersion`                         | `1`. Bump only by ADR. Old rows keep their version                     |
| `provider`                              | `claude-code` \| `codex` \| `demo`                                     |
| `eventType`                             | one of 17 types (`EVENT_TYPES`); each has a typed `payload` schema     |
| `dedupKey`                              | stable identity of the _source record_ (§3)                            |
| `sourceEventId`                         | provider id of the record, e.g. the transcript `uuid`                  |
| `providerSessionId` / `providerAgentId` | provider identity. Internal ids are assigned by the pipeline           |
| `occurredAt` / `observedAt`             | provider timestamp (nullable) and ingestion time                       |
| `provenance`                            | `observed` or `derived`. Events are never `estimated` or `unavailable` |
| `source`                                | `channel`, `providerVersion`, `path`, `byteOffset`, `hookEvent`        |
| `payload`                               | typed per `eventType`. **Contains no conversation content** (ADR-0009) |

## 2. Usage contracts

- **`per-turn`** (`usage.reported`) carries one API response's usage: `messageId` (required),
  `requestId`, `model`, and `tokens { input, output, cacheCreation, cacheRead }`. Each category is a
  non-negative integer **or `null` = unavailable**.
- **`cumulative-snapshot`** (`usage.snapshot`) carries a provider running total: `scope`
  (`session` | `session-including-subagents` | `unknown`), `byModel`, and `reportedCostUsd`. It is
  **stored and displayed, never summed.**
- The four token categories are kept separate end to end. A "total tokens" figure may be displayed
  only as a clearly labeled sum of categories. It is never used for cost.

## 3. Deduplication keys (built by the adapter)

The record key identifies the line, or the meta file version, or the hook delivery. A record that
produces several events appends a suffix for each event.

| Source                                                   | Record key                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Transcript line with `uuid`                              | `cc:tx:{sessionId}:{agentId or "main"}:{uuid}`                                                                                       |
| Transcript line without `uuid` (`cost-state`, titles, …) | `cc:tx:{sessionId}:{agentId or "main"}:h:{sha256(line bytes)}`                                                                       |
| Subagent meta file                                       | `cc:meta:{sessionId}:{agentId}:h:{sha256(file bytes)}`. A new key appears when the file content changes (e.g. `stoppedByUser` added) |
| Hook delivery                                            | `cc:hook:{session_id}:{hook_event_name}:{tool_use_id or sha256(canonical JSON payload)}`                                             |

The suffixes are `#session`, `#assistant`, `#usage`, `#tool:{toolUseId}`, `#result:{toolUseId}`, and so
on. The key never contains a byte offset or the ingestion time, so re-reading a moved, rewritten, or
re-delivered record yields the same key.

## 4. Two-level dedup

1. **Record level:** `events.dedup_key UNIQUE`; inserts use `ON CONFLICT DO NOTHING`. Projections are
   updated **only** for rows that were actually inserted.
2. **Fact level (projections):**
   - usage by `(provider, messageId)`, globally across sessions and files;
   - sessions by `SessionKey`;
   - subagent edges by `(kind, child)`, where evidence accumulates;
   - tool calls by `toolUseId`.

## 5. Usage selection and attribution (P1-A, pure functions in `@acp/core`)

Each `usage.reported` event becomes a **UsageObservation**. Per `(provider, messageId)`:

1. **Selection.** Choose the observation with the greatest `output` (with null ranked lowest). On a
   tie, choose the earliest `occurredAt`, then the lowest event row id. The record takes all four
   categories **from that one observation**. If any non-output category differs among observations
   that report it, set `conflict = true` and keep the selected observation's values. Conflicts are
   counted in diagnostics. A null `occurredAt` sorts last in this tie-break. `conflict` compares
   reported (non-null) values only.
2. **Attribution.** The record belongs to the session of the observation with the earliest
   `occurredAt` (null sorts last), with ties broken by lexical `SessionKey`. Attribution is recomputed
   when observations arrive, so the result does not depend on ingestion order.
   - **Tie amendment (2026-10-10).** Fork copies keep the original line's timestamp. In local data,
     1,715 of 1,715 cross-file message ids had an identical first timestamp in every file. So a tie
     on the earliest `occurredAt` across _different_ sessions means the origin is **unknown**. In
     that case:
     - the record is still counted exactly once, attributed by the lexical tie-break so the result is
       deterministic;
     - the record is flagged `attributionAmbiguous: true`;
     - the API reports `ambiguousAttributionCount` beside direct usage, and the UI shows the attribution
       as ambiguous.
   - A future tie-breaker, such as transcript file creation time reported by the adapter, needs its
     own ADR (open question Q8).
3. **Exclusions.** Observations whose `model` is `<synthetic>` (Claude Code placeholder messages; 28
   lines locally) are stored but excluded from usage records.

**Why:**

- In local data, 23,287 of 44,467 assistant lines repeat an earlier `message.id` in the same file.
  2,499 of those repeats carry a _larger_ `output_tokens` than the earlier line: streaming writes one
  line per content block with a growing count. "First wins" undercounts, and "sum" overcounts by
  about 2×.
- 1,715 message ids appear in two or more _different_ sessions' files. Forks copy history into a new
  file under a new session id. Summing per session would double-count those messages.

## 6. Aggregation

- **Direct usage(session)** is the per-category sum over UsageRecords attributed to the session.
- **Aggregate usage(session)** is direct usage plus aggregate usage of its children over `subagent`
  edges only.
- Per category, the sum is computed over non-null values. If every contributing value is null, the
  result is `null` (unavailable), not 0. The response also carries `recordsWithUnavailable` for each
  category, so the UI can say "partial".
- Project and model totals sum _direct_ usage of sessions. Summing aggregates would double-count
  children.

## 7. Required failure scenarios

| #   | Scenario                                                       | Handling                                                                                                                                                                                                                                                    | Test owner                                                |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Duplicate transcript lines (same `message.id`, growing output) | §5 selection: one record per message, max output                                                                                                                                                                                                            | P1-A unit, P1-C contract                                  |
| 2   | Same record via two channels (hook and transcript)             | Separate record keys; facts converge at projections. Phase 1 hooks never produce `usage.reported`, so usage has exactly one channel. `PostToolUse` `tool_response.usage` is ignored on purpose                                                              | P1-D integration                                          |
| 3   | Cumulative snapshots (`cost-state`)                            | `usage.snapshot` only; never added to records. The UI shows the latest snapshot as "provider-reported running total (estimated)"                                                                                                                            | P1-A, P1-E                                                |
| 4   | Missing usage fields                                           | Category `null`; aggregate stays `null` if every value is null; the UI shows "unavailable"                                                                                                                                                                  | P1-A, P1-E                                                |
| 5   | Out-of-order events                                            | Selection and attribution are order-independent (§5). Sessions use the min `firstSeenAt` and max `lastEventAt`                                                                                                                                              | P1-A property test (shuffled input gives the same result) |
| 6   | Partial JSONL line                                             | Read only up to the last `\n`; the remainder is re-read next pass. Never parse a partial line                                                                                                                                                               | P1-C                                                      |
| 7   | Truncation or replacement                                      | Checkpoint mismatch (`size < byteOffset`, changed `dev:ino`, or changed `headHash`) resets the offset to 0. Dedup keys make the re-read idempotent. Earlier events remain (append-only)                                                                     | P1-C, P1-D                                                |
| 8   | Application restart                                            | Checkpoints commit in the same transaction as their events. A crash mid-chunk re-reads the chunk, and dedup absorbs it                                                                                                                                      | P1-D integration                                          |
| 9   | Live vs transcript reconciliation                              | Hooks trigger an immediate transcript read. The transcript is the source of record for usage. A hook lost while the server was down is backfilled from the transcript (hook-only facts such as `SessionEnd` cannot be recovered; the session shows `stale`) | P1-D, P1-F                                                |
| 10  | Unparseable complete line                                      | Skip it, increment `parseErrors` on the checkpoint, and advance. Never block the file                                                                                                                                                                       | P1-C                                                      |
| 11  | Unknown record type or new runtime version                     | `record.unrecognized` with `recordType` only (no payload). Counts per `providerVersion` are shown in diagnostics                                                                                                                                            | P1-C                                                      |

## 8. Independent cross-check (P1-F)

For sessions that have a `cost-state` snapshot (20 of 100 local sessions), compare the deduped
per-model totals (direct plus subagent aggregate) against the snapshot's `byModel`.

The snapshot's scope is **unverified**. It may include auxiliary requests that never appear in the
transcript. A difference is therefore a finding to document, not automatically a bug. A separate
reference script (P1-F) recomputes totals straight from the JSONL files with the §5 rules, and must
match the database exactly.

## 9. Cost

- No cost formula exists in Phase 1. Only `reportedCostUsd` from snapshots is shown, always labeled
  _estimated (provider-reported)_.
- A Phase 2 pricing table must store provider, model id, pricing version, per-category rates
  (input, output, cache write, cache read), the source URL, and the effective date. Each computed cost
  stores the pricing version and calculation time.
- Missing pricing shows "cost unavailable", never `$0`.
