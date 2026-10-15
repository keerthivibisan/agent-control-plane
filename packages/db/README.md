# @acp/db

**Owner:** work package P1-B (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Implemented (P1-B).** Connection setup (`openDatabase`), the migration runner, the
Phase 1 schema (`0001_observability.sql`), the repositories (`createRepositories`), the transaction
helper (`withTransaction`), and the Phase 1 queries (`createQueries`) exist and are tested against
temp-file databases. Nothing calls them yet: the ingestion pipeline and API are P1-D.

## Responsibility

SQLite connection (WAL, foreign keys), versioned SQL migrations with checksums, repositories, the transaction helper, and the Phase 1 queries (session list, tree, usage sums). Spec: docs/domain-model.md, docs/implementation-plan.md (P1-B).

## Allowed dependencies

`@acp/core`, `better-sqlite3`. These rules are enforced by `eslint.config.js`.

## Connection

`openDatabase(path, options?)`:

- creates a missing parent directory with mode `0700` (an existing directory is never chmod-ed);
- creates the file with mode `0600`, or tightens an existing file to `0600`, before SQLite opens it;
  SQLite gives the `-wal` and `-shm` files the same mode;
- sets `journal_mode=WAL` (verified), `foreign_keys=ON` (verified), and `busy_timeout=5000`;
- applies pending migrations unless `{ migrate: false }`.

`:memory:` is accepted for quick experiments, but tests use temp-file databases.

## Migrations

- Plain SQL files in `src/migrations/NNNN_name.sql` (four-digit version, lowercase name).
- Applied in version order, each in its own `BEGIN IMMEDIATE` transaction, and recorded in
  `schema_migrations(version, name, applied_at, checksum)`. The checksum is the sha256 of the file
  with line endings normalized to `\n`.
- Before applying anything, the runner verifies every applied migration. An edited applied migration
  (checksum mismatch) or an applied version this build does not know throws `MigrationError`.
- **Never edit a migration that has shipped.** Add a new file.

**How migrations reach `dist`:** the `.sql` files are the single source of truth and are **copied**
into `dist/migrations/` by the build script (`scripts/copy-migrations.mjs`, run after `tsc`). The
runner finds them with `new URL('./migrations/', import.meta.url)`, which points at `src/migrations/`
when running from source (the `development` export condition: Vitest, `tsx`) and at
`dist/migrations/` when running the build. They are not embedded as TypeScript strings, so there is
no generated copy that can drift from the reviewed SQL.

## Schema (`0001_observability.sql`)

All tables are `STRICT`. Internal ids are TEXT UUIDs, except `events.id`, an
`INTEGER PRIMARY KEY AUTOINCREMENT` that is monotonic, never reused, and doubles as the SSE id.
Timestamps are UTC ISO-8601 text ending in `Z`. Token counts are nullable (`NULL` = unavailable).
Enum-like columns are validated with Zod in TypeScript, not with `CHECK`, because SQLite cannot alter a
`CHECK` without rebuilding the table. JSON columns have `json_valid` checks.

| Table                   | Key / uniques                                                          | Notes                                                                                     |
| ----------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `projects`              | `id`; `root_path` unique                                               | deleting a project sets `sessions.project_id` / `events.project_id` to NULL               |
| `sessions`              | `id`; `(provider, provider_session_id, provider_agent_id)` unique      | `provider_agent_id = ''` for top-level sessions; evidence columns; JSON `metadata` object |
| `session_edges`         | `id`; `(kind, child_session_id)` unique                                | JSON `evidence` array; no self-loops                                                      |
| `edge_conflicts`        | `id`; `(kind, child_session_id, conflicting_parent_session_id)` unique | evidence naming a different parent; the edge is unchanged                                 |
| `events`                | `id` (autoincrement); `dedup_key` unique                               | append-only; JSON `payload`; indexes `(session_id, occurred_at)`, `(observed_at)`         |
| `usage_observations`    | `event_id`                                                             | one per `usage.reported`; index `(provider, message_id)`                                  |
| `usage_records`         | `id`; `(provider, message_id)` unique                                  | projection; indexes `(session_id)`, `(model)`                                             |
| `usage_snapshots`       | `event_id`                                                             | one per `usage.snapshot`; never summed                                                    |
| `ingestion_checkpoints` | `source_path`                                                          | written in the same transaction as its events                                             |

`0001` creates no Phase 3 tables (domain-model §3); they arrive in `0002`.

## Orchestration schema (`0002_orchestration.sql`, Phase 3 M1, P3-C)

**Status: implemented (P3-C).** Tables, repositories and temp-file DB tests exist. Nothing calls them
yet: the run service is P3-D.

Same conventions as `0001` (STRICT, UUID text ids, UTC `...Z` timestamps, enum columns validated in
TypeScript). Same-run references use composite foreign keys `(run_id, agent_run_id) →
agent_runs (run_id, id)`, so an approval, artifact or workspace can never point at another run's agent.

| Table                   | Key / uniques                                                  | Notes                                                                                                                         |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `orchestration_runs`    | `id`                                                           | `project_id` → projects **ON DELETE RESTRICT** (a project with runs cannot be unregistered); budget columns (ADR-0014)        |
| `agent_runs`            | `id`; `(run_id, id)`; one lead per run (partial unique index)  | parent in the same run; `task` ≤ 4000 (ADR-0015); `budget_tokens_used`, `budget_tokens_limit`                                 |
| `agent_run_sessions`    | `(agent_run_id, provider, provider_session_id)`; one `primary` | stores the provider session id; the observed `sessions` row is joined at read time, so linking never waits for ingestion      |
| `approvals`             | `id`                                                           | `summary` 1..200 characters, `redact()`ed again on write; decisions are immutable; the owner's decision message is not stored |
| `artifacts`             | `id`; `storage_path` unique                                    | `patch` / `manifest`; path relative to the data dir (no `..`, not absolute); `sha256` lowercase hex; immutable                |
| `managed_workspaces`    | `id`; `agent_run_id`, `worktree_path`, `branch` unique         | workers only; `state` `active`/`removed`; `review_state` (core `ReviewState`) and `changed_files`                             |
| `orchestrator_messages` | `id`; `(run_id, seq)`                                          | owner ↔ lead chat only (ADR-0015); `seq` assigned on insert                                                                   |

Every table cascades from `orchestration_runs`: deleting a run deletes its agents, session links,
approvals, artifact rows, workspace rows and chat (ADR-0015). Files on disk are the caller's job:
`runs.remove(id)` returns the artifact paths and the still-active worktree paths to delete.

**Never stored:** worker conversation content, thinking, tool inputs or outputs, activity sentences,
and owner decision messages. A test asserts the free-text columns are exactly `orchestration_runs.title`,
`agent_runs.role`, `agent_runs.task`, `approvals.summary` and `orchestrator_messages.text` (+ `role`).

`createOrchestrationRepositories(db, options?)` returns:

- **runs**: `insert` (default `QUEUED`; optional `ticketId`, P4-B), `getById`,
  `list({ projectId?, ticketId?, limit?, before? })` (newest
  first, with `agentCount` and `pendingApprovals`), `listByStatus`, `setStatus(id, status, { from?,
endedAt? })` (`from` guard → `conflict`), `setBudget`, `remove` → `{ artifactPaths,
activeWorktreePaths }`.
- **agentRuns**: `insert` (lead: no parent/task; worker: a parent in the same run at most
  `HARD_MAX_DEPTH` = 2 levels below the lead (P4-B; was depth 1), and a task; limit
  defaults to the run cap), `getById`, `listForRun`, `listByStatus`, `setStatus` (with `from`),
  `setBudgetTokensUsed`, `setBudgetTokensLimit`. Rows carry `sessionId` (joined) and
  `budgetTokensLimit`.
- **agentRunSessions**: `link` (idempotent), `listForAgentRun`, `findByProviderSession`.
- **approvals**: `insert` (pending), `getById`, `listForRun`, `listPending({ runId? })`,
  `decide(id, 'approved' | 'denied' | 'expired', at?)`, `expirePending(cutoff, at?)`.
- **artifacts**: `insert`, `getById`, `listForRun`, `listForAgentRun` (no update).
- **workspaces**: `insert`, `getById`, `getByAgentRun`, `listForRun`, `listActive`, `setReview`,
  `markRemoved`.
- **messages**: `insert` (appends with the next `seq`), `list(runId, { limit?, beforeSeq? })`
  (latest page, oldest first), `count`.

Errors: unknown referenced rows → `DbError('not_found')`; duplicates and failed `from` guards →
`conflict`; invalid input → `invalid_input`. The engine decides state transitions; the repositories
only persist them.

## Workspace schema (`0003_workspace.sql`, Phase 4, P4-B)

**Status: implemented (P4-B).** Tables, repositories and temp-file DB tests exist, including an
upgrade test from a 0002 database. The server wiring is P4-D. `0001` and `0002` are unchanged.

| Table                | Key / uniques                                             | Notes                                                                                                                                    |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `project_setup`      | `project_id` (1:1, cascades); `project_key` unique        | `setup` JSON validated with core's `ProjectAgentSetupSchema`; `next_ticket_seq` is the ticket counter (only incremented)                 |
| `tickets`            | `id`; `(project_id, seq)`                                 | `key` fixed at creation; `labels` JSON array; `project_id` **RESTRICT** (tickets are never deleted, ADR-0016); `current_run_id` SET NULL |
| `ticket_plans`       | `id`; `(run_id, version)`; one `proposed`, one `approved` | `steps` JSON (core `PlanStepSchema`); `(ticket_id, run_id)` → a run of the same ticket, cascades with the run                            |
| `ticket_comments`    | `id`                                                      | `author` `owner`/`lead`; optional run or plan of the same ticket (composite FKs), cascades with them                                     |
| `check_runs`         | `id`                                                      | `run_id` NULL = main branch; `(run_id, agent_run_id)` → agent of that run; `output_tail` ≤ 16384 characters                              |
| `orchestration_runs` | + `ticket_id` (nullable, → tickets RESTRICT)              | added with `ALTER TABLE`; unique index `(ticket_id, id)` is the parent key for the same-ticket FKs                                       |

Rules SQLite cannot express as foreign keys are triggers: a run's ticket belongs to the run's
project, and a ticket's current run is a run of that ticket. They fire only when the referenced row
exists, so a missing row still reports `not_found`. Harness status is not stored (read from the repo).

**Stored text (ADR-0016/0017):** ticket titles and descriptions, owner and lead comments, plan
summaries and steps, and the redacted output tail of a check. A test pins this list.

`createWorkspaceRepositories(db, options?)` returns:

- **projectSetup**: `get(projectId)`, `getByProjectKey(key)`, `upsert(setup)` (keeps the ticket
  counter; a key used by another project → `conflict`).
- **tickets**: `insert` (atomic per-project number from `project_setup.next_ticket_seq` in one
  `BEGIN IMMEDIATE`; `not_found` without a setup), `getById`, `listForProject(projectId,
{ statuses? })` (by number), `update` (owner fields), `setStatus(id, status, { from?,
currentRunId? })`, `countForProject`.
- **plans**: `insert` (next version per run; a still-proposed plan becomes `superseded`;
  `plannedHelpers` = distinct non-"Lead" step roles), `getById`, `listForTicket`, `listForRun`,
  `latestForRun`, `approvedForRun`, `decide(id, 'approved' | 'changes-requested', at?)` (only from
  `proposed`, else `conflict`), `supersedeProposed(runId, at?)`.
- **comments**: `insert` (the plan's run is filled in), `getById`, `listForTicket`, `listForPlan`.
- **checkRuns**: `insert` (output `redact()`ed again and cut to its tail; run project must match),
  `getById`, `listForRun`, `listForAgentRun`, `latestForAgentRun` (latest per check id),
  `listForProjectMain(projectId, { limit? })`.

`projects.remove` throws a foreign-key error for a project with tickets or runs; the server checks
`tickets.countForProject` / runs first and answers 409.

## Usage

```ts
import { createQueries, createRepositories, openDatabase, withTransaction } from '@acp/db';

const db = openDatabase(`${dataDir}/acp.sqlite`); // migrates on open
const repos = createRepositories(db); // { projects, sessions, edges, events, usage, snapshots, checkpoints }
const queries = createQueries(db);

withTransaction(db, () => {
  for (const event of batch.events) {
    const { inserted, id } = repos.events.insertIfNew({ event, sessionId, projectId });
    if (!inserted) continue; // projections only for newly inserted events
    // ... project sessions, edges, usage observations/records, snapshots
  }
  repos.checkpoints.set(batch.nextCheckpoint); // same transaction as the events
});
```

### Repositories

- **projects**: `insert`, `getById`, `getByRootPath`, `list`, `rename`, `remove`. A duplicate root
  throws `DbError` with code `conflict`.
- **sessions**: `upsert` by `SessionKey` returns `{ id, created }`. Merge rules:
  - `firstSeenAt` takes the MIN; `lastObservedAt` takes the MAX;
  - `lastEventAt`, `endedAt`, and `lastAttentionAt` take the MAX and ignore nulls;
  - for `launchCwd`, `entrypoint`, `agentType`, `description`, and `projectId`, the first non-null
    value wins (use `setProject` to reassign);
  - for `title`, `gitBranch`, and `providerVersion`, the latest non-null value wins;
  - `endReason` follows the latest `endedAt`;
  - `metadata` is merged as a JSON merge-patch;
  - `null` never clears a stored value.

  Also `getById`, `getByKey`, `getByIds`, `listByProviderSession`, `listUnassigned`, `setProject`.

- **edges**: `upsert` by `(kind, child)` validates against core's `SessionEdgeSchema` rules. It
  unions evidence (`observed` beats `derived`) and returns `inserted | evidence-added | unchanged |
conflict`. A different parent is recorded in `edge_conflicts`, and the edge is left unchanged.
  Also `getByChild`, `listChildren`, `listForSessions`, `listConflicts`.
- **events**: `insertIfNew` returns `{ inserted, id }` (`ON CONFLICT(dedup_key) DO NOTHING`).
  Also `getById`, `getByDedupKey`, `listRecent` (newest first, `beforeId` cursor), `listAfter`
  (SSE replay), `maxId`, `listToolCalls(sessionIds, toolUseIds?)` (`tool.called` evidence for
  subagent edges; added for P1-D). Events are validated with `NormalizedEventSchema` on write and read.
  Unknown payload keys are stripped.
- **usage**: `insertObservation`, `listObservationsByMessage` (each row carries its session's
  `SessionKey` for attribution), `upsertRecord` (stable id), `getRecord`, `deleteRecord`,
  `listRecordsForSession`, `listSharedSightings(sessionIds)` (observations of messages seen in two or
  more sessions, for continuation-edge derivation; added for P1-D).
- **snapshots**: `insert`, `latestForSession`, `listForSession`. The cost is returned as
  `Sourced<number>`: `estimated`, or `unavailable` when not reported.
- **checkpoints**: implements core's `CheckpointStore` (`get`), plus `set`, `list`, `remove`.

All timestamps are normalized to UTC `...Z` (millisecond precision) on write. Inputs that fail
validation throw `DbError('invalid_input')`. Stored values that fail validation on read throw
`StoredValueError`.

### Queries

- `listSessions(filter, { limit, cursor })` uses keyset pagination ordered by
  `(COALESCE(last_event_at, '') DESC, id DESC)`. Sessions without a last event come last.
  - Filters: `projectId` (or `null` for no project), `provider`, `model` (sessions with a usage
    record of that model), `search` (an id substring; LIKE wildcards are literal), and
    `topLevelOnly`.
  - Status inputs: `lastEventAfter`, `lastEventBefore`, and `ended`.
  - Status is derived in TypeScript from the evidence columns on each row.
- `modelsBySession(ids)`: the distinct models in each session's records.
- `sessionTree(rootId)`: a recursive CTE over `subagent` edges. It returns the root first, with
  `depth` and `parentSessionId`, and is safe against cycles.
- `directUsage(id)` and `directUsageBySession(ids)`: per-category `SUM`. A category stays `null`
  when every value is null, or when there are no records. `recordsWithUnavailable` is
  `COUNT(*) - COUNT(col)`.
- `aggregateUsage(rootId)`: the direct usage of the session and its `subagent` descendants.
  Continuation children are excluded.
- `usageSummary(groupBy, filter)`: grouped by `project`, `session`, `model`, or UTC `day`. Every
  group sums records directly, so children are never double-counted. The `null` key groups records
  with no project, model, or time.
- Recent events: `repos.events.listRecent` / `listAfter`.
