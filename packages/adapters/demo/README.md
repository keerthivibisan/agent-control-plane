# @acp/adapter-demo

**Owner:** work package P1-C (task C0) (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Not implemented.** Dependencies are pinned.

## Responsibility

Deterministic adapter replaying sanitized fixtures, for tests and `ACP_MODE=demo` only. Emits `provider: "demo"`. Never used against the live database (ADR-0007).

## Allowed dependencies

`@acp/core`. These rules are enforced by `eslint.config.js`.
