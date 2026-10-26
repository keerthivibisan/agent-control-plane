# @acp/core

The shared contracts and pure logic of Agent Control Plane. It defines, as Zod schemas with
inferred TypeScript types, everything the other packages exchange: normalized events, usage,
sessions, the adapter contracts, managed runs, tickets, workflows and workflow graphs, and the HTTP
DTOs. It also holds the pure functions built on them: usage selection and attribution, session
status and edges, redaction, workflow-graph validation and compilation, and the git command guard.
Every package imports it, including the browser bundle, so it does no I/O.

## What it contains

| Path (under `src/`)            | Contents                                                                       | Key exports                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `domain/`                      | Provider ids, provenance, projects, timestamps                                 | `ProviderIdSchema`, `Sourced`, `sourcedSchema`, `unavailable`, `ProjectSchema`, `IsoTimestampSchema`       |
| `events/`                      | The normalized event envelope (17 event types), source references              | `NormalizedEventSchema`, `EVENT_TYPES`, `SourceRefSchema`                                                  |
| `usage/`                       | Per-turn usage, cumulative snapshots, usage accounting                         | `PerTurnUsageSchema`, `CumulativeUsageSnapshotSchema`, `selectUsage`, `aggregateUsage`, `tokenHeadline`    |
| `sessions/`                    | Session keys, statuses and edges, with their derivation                        | `SessionKeySchema`, `SessionEdgeSchema`, `deriveSessionStatus`, `deriveSubagentEdge`                       |
| `adapters/`                    | Type-only provider contracts: observation and managed execution                | `ObservationAdapter`, `CheckpointStore`, `ManagedExecutionAdapter`, `ManagedAgentSpec`                     |
| `paths/`                       | POSIX path containment                                                         | `isPathInside`, `findOwningRoot`, `normalizePosixPath`                                                     |
| `redaction/`                   | Secret redaction for logs and stored text                                      | `redact`, `REDACTED`, `REDACTION_RULE_NAMES`                                                               |
| `orchestration/`               | Managed runs, agent runs, approvals, change states, lead tools, limits         | `OrchestrationRunSchema`, `AgentRunSchema`, `ChangeStateSchema`, `LEAD_TOOL_NAMES`, `MAX_DELEGATION_DEPTH` |
| `workspace/workspace.ts`       | Tickets, plans, comments, approvals, run options, harness manifest, check runs | `TicketSchema`, `TicketPlanSchema`, `ProjectApprovalsSchema`, `resolveRunOptions`, `HarnessManifestSchema` |
| `workspace/workflow.ts`        | Workflow stages, skills and agent files                                        | `ProjectWorkflowSchema`, `defaultProjectWorkflow`, `SkillNameSchema`                                       |
| `workspace/branching.ts`       | Branch strategies and ticket branch names                                      | `BranchStrategySchema`, `renderTicketBranchName`, `isSafeBranchName`                                       |
| `workspace/ticket-activity.ts` | Comment kinds, activity items, attachments                                     | `TicketCommentKindSchema`, `AttachmentSchema`, `ActivityTypeSchema`                                        |
| `workspace/harness-select.ts`  | Which harness checks a Checks block runs                                       | `checksForBlock`, `checkSelectionIssues`                                                                   |
| `workspace/git-guard.ts`       | Whether a command could change a git ref, `HEAD` or history                    | `checkGitCommand`, `checkGitArgv`                                                                          |
| `workspace/workflow-graph.ts`  | The workflow graph contract: nodes, edges, issues, the compiled program        | `WorkflowGraphSchema`, `WorkflowNodeSchema`, `GraphIssueSchema`, `WorkflowProgram`                         |
| `workspace/graph/`             | Graph logic: connect, validate, compile, migrate, templates                    | `canConnect`, `validateWorkflowGraph`, `compileWorkflow`, `migrateWorkflowV1`, `WORKFLOW_TEMPLATES`        |
| `api/`                         | HTTP request and response DTOs (only from `@acp/core/api`)                     | `SessionSummaryDtoSchema`, `UsageGroupBySchema`, `TicketDtoSchema`, `WorkflowGraphDtoSchema`               |

`workspace/graph/testing/` (exported as `createGraphRng`, `generateValidGraph`, `GRAPH_MUTATIONS`,
`enumerateSmallGraphs`) is seeded test support that the orchestrator and server tests also use. It
is never used to build a project's workflow.

### Pure logic

| Module                    | Rule                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usage/selection.ts`      | One record per `(provider, messageId)`: max output wins (null lowest), then earliest `occurredAt`, then lowest event id; `<synthetic>` excluded         |
| `usage/attribution.ts`    | The record goes to the session of the earliest `occurredAt` (null last), lexical session-key tie-break; a cross-session tie sets `attributionAmbiguous` |
| `usage/aggregation.ts`    | Null-preserving per-category sums with `recordsWithUnavailable`; aggregate is direct plus `subagent` descendants only                                   |
| `sessions/status.ts`      | Active up to 120 s, idle up to 30 min, else stale; `ended` only with an observed end and no later activity; no evidence gives `unknown`                 |
| `sessions/edges.ts`       | Edges only from evidence, never from timing; no meta file, or a nested subagent without one matching spawn call, gives no edge (parent unknown)         |
| `sessions/session-key.ts` | `sessionKeyToString`: a canonical, injective key string                                                                                                 |
| `paths/containment.ts`    | Segment-wise containment (`/repo-evil` is not inside `/repo`); the longest root wins                                                                    |
| `redaction/redact.ts`     | Secret patterns from the security spec; idempotent                                                                                                      |

Missing usage stays `null` (unavailable), never 0. The full rules are in
[usage-accounting.md](../../docs/usage-accounting.md).

## Public API and entry points

`package.json` `exports` has two entry points. Each has a `development` condition that resolves to
the TypeScript source (for tests and `tsx` across the workspace) and built `dist/` files otherwise.

- `@acp/core` (`src/index.ts`): every contract and pure function above. The adapter contracts are
  exported as types only.
- `@acp/core/api` (`src/api/index.ts`): the HTTP DTOs, shared by the server and the web app.

Import from these two entry points, never from a deep path.

## Testing

```bash
pnpm --filter @acp/core test
pnpm --filter @acp/core typecheck
pnpm --filter @acp/core build
```

Tests live in `tests/` (Vitest) and use synthetic data only.

- `tests/helpers/builders.ts` builds session keys, token counts and usage observations;
  `tests/graph/helpers.ts` builds and edits workflow graphs.
- `tests/order-independence.test.ts` checks with seeded shuffles that selection, attribution,
  edges and aggregates do not depend on ingestion order.
- `tests/graph/properties.test.ts` generates seeded random graphs, mutates them and enumerates small
  graphs, to check that the validator, `canConnect` and `compileWorkflow` agree. A failure prints
  its seed.
- The `*-contracts.test.ts` files pin the schemas.

## Dependency rules

- The only runtime dependency is `zod`.
- No Node or DOM APIs: `tsconfig.json` sets `"types": []`, so Node globals do not type-check here.
- `eslint.config.js` forbids importing any other workspace package (`@acp/db`, `@acp/server`,
  `@acp/web`, `@acp/adapter-*`, `@acp/orchestrator`).
- Keep functions pure: take clocks and inputs as arguments instead of reading them.
- `src/{domain,events,usage/usage.ts,sessions/session.ts,adapters}/**` are the v1 contracts and
  `src/api/**` holds the HTTP DTOs. Every package builds against them, so a change there is a
  shared change: propose it first, as [AGENTS.md](../../AGENTS.md) section 5 describes.

## Specs and decisions

- Specs: [architecture](../../docs/architecture.md), [domain model](../../docs/domain-model.md),
  [usage accounting](../../docs/usage-accounting.md),
  [provider adapters](../../docs/provider-adapters.md), [security](../../docs/security.md),
  [orchestration lifecycle](../../docs/orchestration-lifecycle.md).
- ADRs: [0006 usage deduplication](../../docs/decisions/0006-usage-deduplication.md),
  [0007 provenance](../../docs/decisions/0007-event-provenance-and-demo-isolation.md),
  [0008 session vs agent run](../../docs/decisions/0008-session-vs-agent-run-identity.md),
  [0009 content minimization](../../docs/decisions/0009-content-minimization.md),
  [0019 workflow stages](../../docs/decisions/0019-workflow-stages-and-roles.md),
  [0023 workflow graphs](../../docs/decisions/0023-editable-workflow-graphs.md),
  [0025 branching](../../docs/decisions/0025-code-hosting-and-branching.md),
  [0027 check blocks](../../docs/decisions/0027-harness-setup-and-check-blocks.md).
