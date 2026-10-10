# ADR-0003: SQLite via better-sqlite3 for the local-first MVP

- **Status:** accepted
- **Date:** 2026-10-10

## Context

Data must stay on the user's machine. The volume is moderate: one machine had about 90k transcript
lines and about 19k unique messages. Events and their checkpoint must commit atomically.

## Decision

- SQLite through `better-sqlite3` 13.0.3: synchronous, in-process, fast transactions.
- WAL mode, `foreign_keys=ON`, `busy_timeout=5000`.
- Versioned plain-SQL migrations with checksums (P1-B).
- JSON payload columns are validated with Zod on read and write.
- The session graph is built with recursive CTEs over `session_edges`. There is no graph database.
- The database file lives under `~/.agent-control-plane/` (mode 0700). Demo mode uses a separate file.

Verified on 2026-10-10: `better-sqlite3@13.0.3` built and loaded on Node 22.21.1 (macOS arm64). It
reported SQLite 3.53.4 and `json_extract` works.

## Alternatives considered

- `node:sqlite` (built in): not yet marked stable on Node 22. Revisit when it is.
- PostgreSQL: a later option for shared deployments, behind the repository layer.
- An ORM (Prisma or Drizzle): adds generated code and migration tooling. Plain SQL is easy to review
  and keeps the null-preserving `SUM` semantics explicit.

## Consequences

- The native module needs a C++ toolchain when no prebuilt binary matches.
- Synchronous calls block the event loop. Keep transactions short and batch work into chunks of at most
  about 1 MiB of input.
