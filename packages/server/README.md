# @acp/server

**Owner:** work package P1-D (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Implemented (P1-D).** Demo mode verified end to end; live mode wired to the Claude Code
adapter and tested against sanitized fixtures (not yet against real data, P1-F). The Phase 3
control-panel routes are **implemented (P3-D)** and tested with a scripted fake managed adapter and
temp git repositories; no run against the real Agent SDK has happened yet (that is P3-F).

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

## Control panel (Phase 3 M1, P3-D)

`src/control/` wires the pure engine (`@acp/orchestrator`), the managed adapter, the database
(`createOrchestrationRepositories`) and the workspace manager (`src/workspace`, P3-W) together;
`src/routes/control.ts` is the thin HTTP layer. Specs: orchestration-lifecycle §0, ADR-0012..0015.

### Configuration

| Variable             | Default         | Meaning                                                                                                                                              |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACP_MANAGED`        | unset (`auto`)  | `on` / `off`. `auto`: on in live mode; off in demo mode unless a managed adapter is injected (`startServer({ managedAdapter })`, tests and e2e only) |
| `ACP_RUN_TIMEOUT_MS` | `7200000` (2 h) | a working run (QUEUED/RUNNING/BLOCKED) is stopped after this long; its live agents end TIMED_OUT                                                     |

The real Agent SDK never runs in demo mode. In live mode the `claude` process gets `process.env`
without any `ACP_*` or `GIT_*` variable (`managedAgentEnv`, ADR-0012). With managed off every
control route answers `404 { error: { code: 'managed_disabled' } }`; Phase 1 routes are unchanged.

### Routes

Every mutation needs `X-ACP-CSRF` with the token from `GET /api/control/token` (64 hex characters,
new on every server start, constant-time compare). Missing → `403 csrf_missing`, wrong →
`403 csrf_invalid`. Every response is parsed by its core DTO schema before it is sent.

| Route                                        | Request                    | Response                 |
| -------------------------------------------- | -------------------------- | ------------------------ |
| `GET /api/control/token`                     |                            | `CsrfTokenDto`           |
| `GET /api/runs`                              |                            | `RunSummaryDto[]` (100)  |
| `POST /api/runs`                             | `StartRunRequest`          | `RunDetailDto` (201)     |
| `GET /api/runs/:id`                          |                            | `RunDetailDto`           |
| `POST /api/runs/:id/chat`                    | `ChatRequest`              | `ChatMessageDto` (owner) |
| `POST /api/approvals/:id`                    | `ApprovalDecisionRequest`  | `ApprovalDto`            |
| `POST /api/runs/:id/agents/:agentId/stop`    |                            | `AgentRunDto`            |
| `POST /api/runs/:id/agents/:agentId/message` | `ChatRequest` (`{ text }`) | `AgentRunDto`            |
| `POST /api/runs/:id/stop` (Stop all)         |                            | `RunSummaryDto`          |
| `GET /api/runs/:id/review`                   |                            | `ReviewDto`              |
| `POST /api/runs/:id/review`                  | `ReviewActionRequest`      | `ReviewDto`              |

Engine refusals become `ErrorDto`s with the engine's code in snake_case (`too_many_agents`,
`project_not_registered`, `over_budget`, `run_cancelling`, `review_not_allowed`, ...; 409, or 404 for
unknown agents/approvals, 400 for invalid input). Workspace refusals do the same (`base_dirty`,
`base_moved`, `base_branch_changed`, ...). The owner's message to a worker goes through the engine's
`message_agent` checks and is sent, never stored.

### Behavior

- **Persist, then act.** Every change is: engine command, then one transaction (state diff, chat
  lines, session links), then the SSE notice, then the effects (orchestration-lifecycle §1).
  Repositories normally make their own ids; `RunStore` hands them the engine's ids through a one-shot
  id slot.
- **Agents.** The first owner message starts the lead in the project root. The lead is read-only:
  any tool use it asks permission for is denied without asking (ADR-0013 §2). A worker gets a git
  worktree (`<ACP_DATA_DIR>/worktrees/<run>/<agent>`) and starts in it; messages for a worker whose
  worktree is still being made are held until it runs.
- **Approval bridge.** A worker's `requestPermission` → engine → approvals row → SSE
  `approval-requested` → the SDK promise stays parked until `POST /api/approvals/:id` (or Stop, or
  the expiry sweep after `APPROVAL_TIMEOUT_MS`) resolves it. An engine refusal (over budget, run
  stopping) is an immediate deny.
- **Lead tools** call `leadToolCall`; a refusal rejects, which the adapter returns to the model as a
  tool error with the refusal message.
- **Session linking.** The `started` event's session id is linked (`agent_run_sessions`, primary);
  `AgentRunDto.sessionId` is the observed session once ingested. Active worktrees are extra
  `RegisteredRoot`s of their run's project for the scheduler and the pipeline, and are never offered
  as new projects by discovery. Before a worktree is removed, the server polls once so the worker's
  transcript is read while its root still exists.
- **Review.** `GET` diffs each ended worker's worktree (stores the changed-file count). `merge` →
  `workspace.merge` (refusals as above) → record → release worktree and branch; `discard` →
  `workspace.discard`. A worker that never got a worktree is recorded as `no-changes` when the run
  enters REVIEW. The last decision completes the run and stops the lead.
- **Stop / Stop all / timeout.** Stop all = `cancelRun` (deny approvals, abort workers, then the
  lead); the run becomes CANCELLED once every agent stream ended, or after a 10 s grace period.
- **Cost warning (ADR-0014).** When one agent's provider-reported estimated cost passes
  `softCostUsdPerRun`, a warning is logged and counted; costs are never added up and nothing stops.
  There is no DTO field for it yet (proposed).
- **Restart.** On start, every non-terminal run goes through `recoverAfterRestart` (live work →
  NEEDS_REVIEW, open approvals expired, nothing relaunched), then `cleanupOrphans` keeps the
  worktrees the database references. Latest activity lines and the usage ledger are in memory only.
- **Logs** carry run/agent/approval ids, tool names, codes and counts; never chat, task, message,
  summary or diff text (tested in `tests/logging.test.ts`).
- **Content (ADR-0015).** Stored: owner chat, lead replies, worker tasks, approval summaries. Never:
  worker text, messages to workers, deny notes, activity lines (asserted by dumping every table).

### Testing with a fake adapter

`tests/control/fake-adapter.ts` is a scripted `ManagedExecutionAdapter` (no SDK, no process):
`start` returns a `FakeAgent` the test drives (`started()`, `usage()`, `emit()`, `ask()`,
`callLead()`, `finish()`). `tests/control/helpers.ts` `setupControl()` builds the app over a temp DB
and a temp git repository. A server for e2e can be started with
`startServer({ config, managedAdapter: createFakeManagedAdapter().adapter })` (demo mode is fine).
