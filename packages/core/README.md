# @acp/core

**Owner:** work package P0 (contracts v1), P1-A (logic), P1-D0 (`src/api/**`) (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Partially implemented.**

- v1 contracts: provenance, provider ids, project, normalized events (17 types), usage (per-turn, cumulative snapshot), session key/status/edges, and the adapter contract.
- P1-A pure logic (implemented and unit-tested; not yet wired into the server pipeline, which is P1-D):
  - usage selection, attribution, and aggregation ([usage-accounting §5–§6](/docs/usage-accounting.md));
  - session status derivation and session edges ([provider-adapters §5, §7](/docs/provider-adapters.md));
  - path containment and redaction ([security §2](/docs/security.md)).
- `src/api/**` (HTTP DTOs) is P1-D0.

## Responsibility

Provider-agnostic domain contracts (Zod schemas plus inferred types) and pure, side-effect-free logic. Imported by every other package, including the browser bundle.

## Pure logic (P1-A)

| Module                        | Exports                                                                                                                                                                        | Rule                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/usage/selection.ts`      | `UsageObservation`, `selectUsage`, `groupObservationsByMessage`, `usageMessageKey`, `assertSingleMessage`, `TOKEN_CATEGORIES`, `SYNTHETIC_MODEL`, `UsageObservationGroupError` | one record per `(provider, messageId)`: max output (null lowest), then earliest `occurredAt`, then lowest event id; `conflict`; `<synthetic>` excluded     |
| `src/usage/attribution.ts`    | `attributeUsage`, `buildUsageRecord`, `UsageAttribution`                                                                                                                       | earliest `occurredAt` (null last), lexical session-key tie-break; a cross-session tie on the earliest time is flagged `ambiguous` / `attributionAmbiguous` |
| `src/usage/aggregation.ts`    | `sumTokenCounts`, `addUsageTotals`, `emptyUsageTotals`, `directUsageBySession`, `aggregateUsage`                                                                               | null-preserving per-category sums with `recordsWithUnavailable`; aggregate = direct + subagent descendants only; cycles ignored and reported               |
| `src/sessions/status.ts`      | `deriveSessionStatus`, `DEFAULT_SESSION_STATUS_THRESHOLDS`                                                                                                                     | active ≤ 120 s, idle ≤ 30 min, else stale; `ended` only with an observed end and no later activity; no evidence gives `unknown`                            |
| `src/sessions/edges.ts`       | `deriveSubagentEdge`, `deriveContinuationEdges`, `SUBAGENT_SPAWN_TOOL_NAMES`                                                                                                   | edges only from evidence; unmatched depth > 1 gives no edge (parent unknown); continuation only when the parent saw the shared messages strictly earlier   |
| `src/sessions/session-key.ts` | `sessionKeyToString`, `sessionKeysEqual`                                                                                                                                       | canonical, injective key string                                                                                                                            |
| `src/paths/containment.ts`    | `normalizePosixPath`, `isPathInside`, `findOwningRoot`                                                                                                                         | segment-wise POSIX containment (`/repo-evil` is not in `/repo`); longest root wins; caller does `realpath`                                                 |
| `src/redaction/redact.ts`     | `redact`, `REDACTED`, `REDACTION_RULE_NAMES`                                                                                                                                   | secret patterns from security §2.4; idempotent                                                                                                             |

Every function is order-independent where the spec requires it; `tests/order-independence.test.ts` checks this with seeded shuffles.

## Allowed dependencies

`zod` only. No Node or DOM APIs (`types: []`). These rules are enforced by `eslint.config.js`.
