# @acp/db

**Owner:** work package P1-B (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Not implemented.** Dependencies are pinned. P1-B adds `src/`, `tests/`, tsconfig files, and scripts.

## Responsibility

SQLite connection (WAL, foreign keys), versioned SQL migrations with checksums, repositories, the transaction helper, and the Phase 1 queries (session list, tree, usage sums). Spec: docs/domain-model.md, docs/implementation-plan.md (P1-B).

## Allowed dependencies

`@acp/core`, `better-sqlite3`. These rules are enforced by `eslint.config.js`.
