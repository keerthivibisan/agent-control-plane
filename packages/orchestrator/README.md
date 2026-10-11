# @acp/orchestrator

**Owner:** work package P3-A (see [docs/implementation-plan.md](/docs/implementation-plan.md), Phase 3).

**Status:** scaffold only (P3-0). Nothing is implemented yet.

## Responsibility

The pure orchestration engine: run and agent state machines, policy checks (registered project,
at most 3 concurrent children, depth 1, budgets), lead-tool call validation, budget accounting with
per-message dedup, cancellation ordering, and restart rules. The model plans; this package decides.
No I/O: persistence, processes and git live in `@acp/server` and the adapters.

## Allowed dependencies

`@acp/core`, `zod`. Never `@acp/db`, `@acp/server`, `@acp/web` or adapters (enforced by
`eslint.config.js`).
