# @acp/db

**Owner:** work package P1-B (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Partially implemented.** Connection setup (`openDatabase`), the migration runner, and the
Phase 1 schema (`0001_observability.sql`) exist and are tested. Repositories, the transaction
helper, and queries are still in progress in P1-B.

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
