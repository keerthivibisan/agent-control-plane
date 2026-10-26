# @acp/server

The composition root of Agent Control Plane. It reads Claude Code session files through the
adapters, ingests them into SQLite, and serves the REST API, the SSE stream, the hook receiver and
the built web UI on `127.0.0.1`. It also runs managed runs: it drives the pure engine in
`@acp/orchestrator`, starts agents through the Claude Code adapter, and does the git work, harness
checks, skills, attachments and the owner's GitHub actions the engine asks for or the owner clicks.

## Running

| Script (in `packages/server`) | Runs                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `dev`                         | `src/main.ts` with tsx and the `development` export condition |
| `start`                       | `dist/main.js` (after `build`)                                |
| `hooks:snippet`               | `src/hook-snippet.ts`: prints hook settings for you to paste  |

The root `pnpm dev` runs this server and the web dev server together. `src/main.ts` loads the
config, calls `startServer` (`src/bootstrap.ts`), serves `packages/web/dist` when it has been built,
and closes cleanly on SIGINT/SIGTERM. The environment is parsed by `src/config.ts` and fails fast on
bad values: `ACP_PORT` (7420), `ACP_DATA_DIR` (`~/.agent-control-plane`), `ACP_CLAUDE_DIR` (else
`CLAUDE_CONFIG_DIR`, else `~/.claude`), `ACP_MODE` (`live` or `demo`), `ACP_POLL_INTERVAL_MS`,
`ACP_ACTIVE_WINDOW_MS`, `ACP_STALE_AFTER_MS`, `ACP_MANAGED` (`on`/`off`; unset means on in live
mode, off in demo) and `ACP_RUN_TIMEOUT_MS` (2 hours). The owner-facing table is in
[START.md](../../START.md). Demo mode uses its own `demo.sqlite` and the demo adapter; the Agent SDK
never runs in demo mode.

## What it contains

- `bootstrap.ts`, `app.ts`, `config.ts`, `main.ts`: wiring. `createApp` builds the Express app
  without listening, so tests drive it with supertest.
- `pipeline/ingest.ts`, `scheduler.ts`: ingestion (validate, dedupe, persist, project, checkpoint
  in one transaction, then publish) and single-flight polling; `notifier.ts` fans notices to SSE.
- `services/`: the observation reads (projects, sessions, usage, overview, diagnostics).
- `hooks/`: `POST /api/hooks/claude-code`, authenticated by the `x-acp-hook-token` header against
  `<ACP_DATA_DIR>/hook-token`; answered 204. Hooks only add lifecycle facts and trigger a poll.
- `control/`: managed runs. `service.ts` applies engine commands, persists through `store.ts`, then
  carries out the effects; plus the CSRF token, the allowlist's path resolution, review checkouts,
  the review loop's git effects, Full auto's sandbox paths, session names and run summaries.
- `workspace/`: git worktrees for helpers (`<ACP_DATA_DIR>/worktrees/<run>/<agent>`), diffs,
  merges and the ticket branch. The server starts only `git`, the SDK's `claude`, the harness's
  check commands and `gh`, always as argument arrays and never through a shell (ADR-0013).
- `board/`: projects, setup, tickets, comments, attachments, activity, checks on changes, ticket
  totals, and the owner's ticket-branch actions.
- `code-host/`: `origin` and GitHub through the owner's `gh` login (ADR-0025). Only on the owner's
  click, never on a timer or for an agent; no token is read or stored.
- `harness/`: `.acp/harness.json`, the check runner, main-branch checks and check blocks.
- `workflow/`, `skills/`, `tokens/`, `attachments/`: project workflows and graphs, the run's skills
  plugin, project skills and agent files (ADR-0018), the Tokens page, and attachment storage.
- `http/`: `localOnlyGuard`, request ids and the error handler.

## HTTP API

Every route is under `/api`. `localOnlyGuard` answers 403 to a non-loopback `Host`, a foreign
`Origin` and CORS preflights. Every mutation of the control panel, board, workflow, skills and
agents routes, and `POST /api/projects`, needs the `X-ACP-CSRF` header with the token from
`GET /api/control/token` (new on each start). Errors have one shape,
`{ error: { code, message, requestId } }`, made only in `http/middleware.ts`; engine refusals keep
their code in snake_case. Responses are parsed by their `@acp/core/api` DTO before they are sent.

- `routes/api.ts`: health, overview, capabilities, discovery, ingestion diagnostics, events,
  projects, sessions and usage.
- `routes/stream.ts`: `GET /api/events/stream`, SSE invalidation notices (`events-ingested`,
  `projects-changed`, `runs-changed`, `approval-requested`, `chat-message`, `tickets-changed`).
- `routes/control.ts`: runs, chat, stop, agents, review, ticket branch, workflow state, approvals.
  With managed runs off these answer `404 managed_disabled`.
- `routes/board.ts`: projects (new, delete, setup), harness, code host, branches, board, tickets,
  comments, attachments, activity, pull requests, plan decisions, checks.
- `routes/workflow.ts`, `routes/skills.ts`, `routes/agents.ts`, `routes/tokens.ts`: project
  workflows and graphs, skills, agent files, and token usage.

Route handlers only parse input and call a service: `routes → services → repositories`. Business
logic lives in the services (`board/`, `control/`, `workflow/`, ...), never in a route.

## Managed runs in short

The engine decides and the server acts: persist the new state in one transaction, publish a
notice, then perform the effects in order. Restarts relaunch nothing (`recoverAfterRestart`), and
leftover worktrees and checkouts are cleaned up on start. A sweep in `control/service.ts` expires
approvals and applies the run timeout with `isRunOverdue`, so the time a loop run waits only for the
owner does not count (v0.3.1). When the engine reports the `rework-session-replaced` diagnostic,
the server counts it and posts an app line on the ticket saying the helper reworks in a new session.

## Testing

```bash
pnpm --filter @acp/server test
pnpm --filter @acp/server typecheck
pnpm --filter @acp/server build
```

Vitest collects `tests/**/*.test.ts`. Tests use temp-file databases and temp data folders, throwaway
`git init` repositories, injected clocks, a fake `gh` (`tests/code-host/fake-gh.ts`) and no real
agent: a scripted fake managed adapter (`tests/control/fake-adapter.ts`), or the real Claude Code
adapter over a scripted SDK `query` function. They never read the real `~/.claude`. Folders follow
`src/` (`board/`, `control/`, `workspace/`, ...), plus `adversarial/` and `verification/`
(end-to-end flows over the same fakes).

The real-run drivers, `tests/verification/**/real-run/drive.ts`, start real `claude` processes and
spend tokens. They are not `*.test.ts`, so `pnpm test` never collects them; they refuse to run
without `ACP_REAL_RUN=1` or in CI, and need the owner's consent. `drive.test.ts` only checks the
driver's `--dry-run` with the fake adapter.

## Dependencies

All workspace packages except `@acp/web` (`@acp/core`, `@acp/db`, `@acp/orchestrator`, both
adapters), plus `express` and `zod`. `eslint.config.js` forbids `@acp/web` and the demo adapter's
fixtures here. Adapters never touch the database; the pipeline and services do.

## Specs and decisions

- [architecture](../../docs/architecture.md), [security](../../docs/security.md),
  [orchestration lifecycle](../../docs/orchestration-lifecycle.md),
  [usage accounting](../../docs/usage-accounting.md), [adapters](../../docs/provider-adapters.md)
- [docs/decisions/](../../docs/decisions/README.md), especially
  [0005](../../docs/decisions/0005-transcript-and-hook-ingestion.md) (ingestion),
  [0009](../../docs/decisions/0009-content-minimization.md) (no conversation content),
  [0013](../../docs/decisions/0013-managed-execution-guardrails.md) (guardrails),
  [0021](../../docs/decisions/0021-approval-modes-review-loop-ticket-branch.md) (review loop),
  [0025](../../docs/decisions/0025-code-hosting-and-branching.md) (GitHub and branching) and
  [0027](../../docs/decisions/0027-harness-setup-and-check-blocks.md) (harness)
