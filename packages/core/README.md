# @acp/core

**Owner:** work package P0 (contracts v1), P1-A (logic), P1-D0 (`src/api/**`) (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Partially implemented.** v1 contracts: provenance, provider ids, project, normalized events (14 types), usage (per-turn, cumulative snapshot), session key/status/edges, and the adapter contract. Pure logic (dedup selection, attribution, aggregation, status, edges, paths, redaction) is P1-A.

## Responsibility

Provider-agnostic domain contracts (Zod schemas plus inferred types) and pure, side-effect-free logic. Imported by every other package, including the browser bundle.

## Allowed dependencies

`zod` only. No Node or DOM APIs (`types: []`). These rules are enforced by `eslint.config.js`.
