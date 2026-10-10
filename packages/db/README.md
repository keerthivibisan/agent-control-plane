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

There are no Phase 3 tables (domain-model §3).

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
  (SSE replay), `maxId`. Events are validated with `NormalizedEventSchema` on write and read.
  Unknown payload keys are stripped.
- **usage**: `insertObservation`, `listObservationsByMessage` (each row carries its session's
  `SessionKey` for attribution), `upsertRecord` (stable id), `getRecord`, `deleteRecord`,
  `listRecordsForSession`.
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
