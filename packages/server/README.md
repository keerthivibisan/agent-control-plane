# @acp/server

**Owner:** work package P1-D (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Implemented (P1-D).** Demo mode verified end to end; live mode wired to the Claude Code
adapter and tested against sanitized fixtures (not yet against real data, P1-F).

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
pnpm dev                 # live mode: reads <ACP_CLAUDE_DIR>/projects for registered projects only
pnpm --filter @acp/server hooks:snippet   # prints Claude Code hook settings to paste yourself
```

Hooks are optional. The snippet references `$ACP_HOOK_TOKEN`; set it to the contents of
`<ACP_DATA_DIR>/hook-token`. The app never writes Claude settings. The snippet shape is unverified
until real hook payloads are captured (P1-C6).

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
- **Diagnostics** (`GET /api/diagnostics/ingestion`): checkpoints per source, unrecognized record types
  and conflict counts from the database; each adapter's `diagnostics()` (ADR-0011: file issues from its
  latest scan, known record types it skipped on purpose sorted by count, parse errors); and the
  server's own counters (pipeline `eventsInvalid`/`batchesFailed`, scheduler `polls`/`pollErrors`/
  `lastPollAt`). Adapter and server counters are in memory and reset on restart. Every path is shown
  relative to the provider data root (`displayPath`), never as an absolute home path; the DTO rejects
  absolute file-issue paths.
- **Cost on the overview** (`OverviewDto.latestSnapshots`): the latest provider snapshot of each of the
  10 most recently active top-level sessions that have one, newest first. Each entry's
  `reportedCostUsd` is `estimated` or `unavailable` (null, never 0). Snapshots are never summed, so
  there is no total cost field anywhere. Built from existing reads (`sessions.scan()` order, then
  `snapshots.latestForSession` per top-level session until 10 are found).
- **Not implemented**: `GET /api/sessions/:id/usage` (no DTO; `SessionDetailDto` already carries direct
  and aggregate usage).
