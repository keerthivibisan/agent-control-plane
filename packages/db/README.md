# @acp/db

SQLite persistence for Agent Control Plane, built on `better-sqlite3`. It opens the database file
with safe settings, applies numbered SQL migrations with checksums, and provides repositories (one
per table group) and read-side queries. Inputs and stored JSON are validated with `@acp/core`
schemas. `@acp/server` is the only package that uses it.

## What it contains

| Path (under `src/`)           | What it does                                                                       | Key exports                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `database.ts`                 | Opens the database: WAL, `foreign_keys=ON`, `busy_timeout` 5000 ms, file mode 0600 | `openDatabase`, `AcpDatabase`, `OpenDatabaseOptions`                      |
| `migrations.ts`               | Loads, verifies and applies `migrations/NNNN_name.sql`                             | `runMigrations`, `loadMigrations`, `checksumOf`, `DEFAULT_MIGRATIONS_DIR` |
| `transaction.ts`              | One synchronous write transaction (`BEGIN IMMEDIATE`); nested calls are savepoints | `withTransaction`                                                         |
| `errors.ts`                   | Typed errors with a `code` (`not_found`, `conflict`, `invalid_input`, ...)         | `DbError`, `MigrationError`, `StoredValueError`                           |
| `repositories/`               | Observation: projects, sessions, edges, events, usage, snapshots, checkpoints      | `createRepositories`                                                      |
| `repositories/orchestration/` | Managed runs, agent runs, session links, approvals, artifacts, worktrees, chat     | `createOrchestrationRepositories`                                         |
| `repositories/workspace/`     | Project setup, tickets, plans, comments, check runs, attachments                   | `createWorkspaceRepositories`                                             |
| `repositories/redesign/`      | Project workflow (graph) and run audit columns                                     | `createRedesignRepositories`                                              |
| `repositories/review-loop/`   | Ticket branches, change reviews, and review, approval and run-option columns       | `createReviewLoopRepositories`                                            |
| `repositories/harness/`       | Harness setup runs                                                                 | `createHarnessRepositories`                                               |
| `queries/`                    | Session list, session tree, usage sums and summaries, stats, project tokens        | `createQueries`, `createTokenQueries`, `MAX_PAGE_SIZE`                    |

Each `create*` factory takes an `AcpDatabase` and, for repositories, optional `now` and `newId`
functions, so tests can inject a clock and ids. Repositories do not open their own transactions
(except where one call must be atomic); wrap multi-step writes in `withTransaction`.

```ts
import { createQueries, createRepositories, openDatabase, withTransaction } from '@acp/db';

const db = openDatabase(`${dataDir}/acp.sqlite`); // creates the file and migrates on open
const repos = createRepositories(db);
withTransaction(db, () => {
  const { inserted } = repos.events.insertIfNew({ event, sessionId, projectId });
  // only when `inserted`: update the session, edge and usage projections
  repos.checkpoints.set(nextCheckpoint); // same transaction as the events
});
const sessions = createQueries(db).listSessions({ topLevelOnly: true }, { limit: 50 });
```

## Schema conventions

Tables are `STRICT`. Ids are TEXT UUIDs, except `events.id`, a monotonic `AUTOINCREMENT` integer
that doubles as the SSE id. Timestamps are UTC ISO-8601 text ending in `Z`. Token counts are
nullable: `NULL` means unavailable, never 0. Enum-like columns are validated with Zod in
TypeScript, not with `CHECK`, because SQLite cannot change a `CHECK` without rebuilding the table.
No conversation content is stored (ADR-0009); the few free-text columns are pinned by tests.

## Migrations

| File                        | Adds                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `0001_observability`        | projects, sessions, session_edges, edge_conflicts, events, usage_observations, usage_records, usage_snapshots, ingestion_checkpoints |
| `0002_orchestration`        | orchestration_runs, agent_runs, agent_run_sessions, approvals, artifacts, managed_workspaces, orchestrator_messages                  |
| `0003_workspace`            | project_setup, tickets, ticket_plans, ticket_comments, check_runs; orchestration_runs.ticket_id                                      |
| `0004_redesign`             | project_workflow; agent_runs.stage, approvals.decided_by, orchestration_runs.limits                                                  |
| `0005_stage_agents`         | "one lead per run" keyed by `kind = 'lead'` instead of "no parent"                                                                   |
| `0006_review_loop`          | ticket_branches, change_reviews; change columns on managed_workspaces, check_runs.commit_sha, approvals.allow_rule                   |
| `0007_ticket_run_options`   | tickets.run_options                                                                                                                  |
| `0008_code_hosting`         | tickets.branch_prefs; ticket_branches rebuilt without the `acp/*` name check, plus pull request columns                              |
| `0009_ticket_activity`      | ticket_comments.kind and agent_run_id; ticket_attachments                                                                            |
| `0010_harness_setup`        | setup_runs; check_runs.place and block_node_id                                                                                       |
| `0011_ticket_branch_source` | ticket_branches.source_branch                                                                                                        |

- Each file is applied once, in version order, in its own transaction, and recorded in
  `schema_migrations` with a sha256 checksum (line endings normalized).
- Before applying anything, the runner checks every applied migration. An edited applied migration
  or an applied version this build does not know throws `MigrationError`.
- **Never edit a migration that has shipped. Add a new file**, with an upgrade test that opens a
  database at the previous version (see `tests/review-loop/migration-0011.test.ts`).
- The build copies the `.sql` files into `dist/migrations/` (`scripts/copy-migrations.mjs`). The
  runner finds them next to itself with `new URL('./migrations/', import.meta.url)`.

## Public API and entry points

`package.json` `exports` has one entry point, `@acp/db` (`src/index.ts`): the `development`
condition resolves it to the TypeScript source, otherwise to `dist/`. Never import a deep path.

## Testing

```bash
pnpm --filter @acp/db test
pnpm --filter @acp/db typecheck
pnpm --filter @acp/db build
```

Tests in `tests/` use temp-file SQLite databases (never the real one) and synthetic data only.

- `tests/helpers.ts`: `tempDir()` (removed after each test), `fixedClock()`, `thrown()`.
- `tests/fixtures.ts`: `setupStore()`, a migrated temp database with repositories, a fixed clock and
  sortable ids. `tests/orchestration/setup.ts` and `tests/workspace/setup.ts` do the same for their
  table groups.
- `tests/schema.test.ts` snapshots the whole schema; review its diff when you add a migration.
- `migration-NNNN.test.ts` files upgrade a database from the previous version.
- `vitest.config.ts` resolves `@acp/core` to its source; `tests/core-resolution.test.ts` checks it.

## Dependency rules

- Runtime dependencies: `@acp/core` and `better-sqlite3` only.
- `eslint.config.js` forbids `@acp/server`, `@acp/web`, `@acp/adapter-*` and `@acp/orchestrator`.
- The server layers its code `routes -> services -> repositories`. Repositories persist and enforce
  data integrity (validation, uniqueness, `from` guards on status changes); deciding what should
  happen belongs to the services and the engine.
- Errors are thrown as `DbError` with a code; the server maps them to HTTP responses.

## Specs and decisions

- Specs: [architecture](../../docs/architecture.md) (sections 5 and 8),
  [domain model](../../docs/domain-model.md), [usage accounting](../../docs/usage-accounting.md),
  [security](../../docs/security.md),
  [orchestration lifecycle](../../docs/orchestration-lifecycle.md).
- ADRs: [0003 SQLite](../../docs/decisions/0003-sqlite-local-first.md),
  [0006 dedup](../../docs/decisions/0006-usage-deduplication.md),
  [0009 no content](../../docs/decisions/0009-content-minimization.md),
  [0015 chat](../../docs/decisions/0015-orchestrator-chat-storage.md),
  [0016 tickets](../../docs/decisions/0016-workspace-board-and-tickets.md),
  [0021 review loop](../../docs/decisions/0021-approval-modes-review-loop-ticket-branch.md),
  [0025 branching](../../docs/decisions/0025-code-hosting-and-branching.md),
  [0026 attachments](../../docs/decisions/0026-comments-conversation-and-attachments.md),
  [0027 setup runs](../../docs/decisions/0027-harness-setup-and-check-blocks.md).
