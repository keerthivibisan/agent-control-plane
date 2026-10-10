# @acp/server

**Owner:** work package P1-D (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Implemented (P1-D), demo mode verified.** Live mode refuses to start until the Claude
Code adapter (P1-C) is integrated.

## Responsibility

Composition root: config, ingestion pipeline (validate → dedupe → persist → project → publish),
scheduler, REST API, SSE, hook receiver, and static UI serving. Layering: `routes → services →
repositories`.

## Allowed dependencies

`@acp/core`, `@acp/db`, both adapters, `express`, `zod`. Never `@acp/web`. These rules are enforced by
`eslint.config.js`.

## Running

```bash
ACP_MODE=demo pnpm dev   # server on 127.0.0.1:7420, UI on http://127.0.0.1:5173
```

Configuration is in [docs/development.md §5](/docs/development.md). Demo mode rebuilds
`<ACP_DATA_DIR>/demo.sqlite` on every start and replays fixtures starting 20 minutes in the past.

## Behavior notes

- **Pipeline** (`src/pipeline/ingest.ts`): one transaction per batch. Invalid events are counted and
  skipped; duplicates are detected before the session row is touched. Subagent edges come from spawn
  evidence stored in the child's session `metadata`, so they derive in any event order. Continuation
  edges use `usage.listSharedSightings`; ties give no edge.
- **Hooks** carry no provider time, so the delivery time is the activity evidence for status.
- **Scheduler**: polls are single-flight (not per file); requests during a poll coalesce into one rerun.
- **Guard**: non-loopback `Host`, foreign `Origin`, and CORS preflights get 403 on all `/api` routes.
- **Not implemented**: `GET /api/sessions/:id/usage` (no DTO; `SessionDetailDto` already carries direct
  and aggregate usage), the Claude settings snippet (P1-C6), and the cost field in `OverviewDto`.
