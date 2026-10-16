# P4-D — Server wiring

> Progress file for P4-D. Only the agent working on P4-D edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value            |
| ------- | ---------------- |
| Status  | review           |
| Owner   | backend agent    |
| Branch  | `wp/p4-d-server` |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Tasks

- [x] Routes in README §6.3 with DTO parsing and CSRF
- [x] Ticket ↔ run wiring: start, plan decisions, stage-driven ticket status, re-run
- [x] Project creation (git init) and setup persistence
- [x] Context injection; allowlist in the approval bridge (bridge built; **inactive until the
      blocked contract change below lands**)
- [x] Checks on entering review and on demand; merge-anyway with reason
- [x] SSE notices for tickets/board; Phase 3 routes keep working
- [x] Supertest per route with the fake adapter and temp repos; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                      | Commit        | Checks                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed P4-D; branch `wp/p4-d-server` created from `main` (0d82cef)                                                                                                                                                                                                                                                                                                                                                | 5a6380e       | —                                                                                                             |
| 2026-10-16 | Control service: ticket runs (`createTicketRun`, `decidePlan`), plans and `ticketId` persisted with the run, board hooks (in-commit, after-commit), project context and model per run, depth-2 parent helpers (child tools, prompt note, notice when a child ends), allowlist path resolution, merge gated on checks + merge-anyway                                                                                | a70de98       | format ✓ lint ✓ typecheck ✓ test 1564/1564 ✓ (server 267) build ✓                                             |
| 2026-10-16 | Board layer: §6.3 routes (`routes/board.ts`), board service (projects/new creating a repository, setup with lazy default rows, harness status cache, context candidates, board, tickets, start/plan decisions, ticket ↔ run status), shared check runner (checks on review + on demand, main-branch checks, orphan cleanup at start), project removal 409, SSE `tickets-changed`; bootstrap wiring; 29 route tests | edc5dda       | format ✓ lint ✓ typecheck ✓ test 1593/1593 ✓ (server 296) build ✓                                             |
| 2026-10-16 | Fix: runs in PLANNING / PLAN_REVIEW were not recovered after a restart (NEEDS_REVIEW) and PLANNING was not under the run timeout; `startServer` board test with a restart; inputs to the engine are named fields only; server README section                                                                                                                                                                       | b759893       | format ✓ lint ✓ typecheck ✓ test 1594/1594 ✓ (server 297) build ✓                                             |
| 2026-10-16 | SSE assertion for plan submissions; rebased on `main` (31c5f7d, P4-G merged; no conflicts)                                                                                                                                                                                                                                                                                                                         | c78f858       | format ✓ lint ✓ typecheck ✓ test 1637/1637 ✓ (server 297, web 320) build ✓; web e2e 14/14 ✓ (ports 7651/7661) |
| 2026-10-16 | Status `review`; completion report and handoff notes                                                                                                                                                                                                                                                                                                                                                               | (this commit) | docs only (same checks as c78f858)                                                                            |

## Handoff notes

**Routes and their answers** (all parsed with `@acp/core/api` DTOs; every mutation needs
`X-ACP-CSRF`; the full table is in `packages/server/README.md`, "Agent Workspace"):
`POST /api/projects/new` → `ProjectDto` 201 · `DELETE /api/projects/:id` → 204 ·
`GET|PUT /api/projects/:id/setup` → `ProjectAgentSetupDto` · `GET /api/projects/:id/harness` →
`HarnessStatusDto` · `POST /api/projects/:id/harness/checks` → `CheckRunDto[]` ·
`POST /api/projects/:id/harness/ticket` → `TicketDto` 201 ·
`GET /api/projects/:id/context-candidates` → `ContextCandidateDto[]` · `GET /api/board?projectId=`
→ `BoardDto` · `GET /api/projects/:id/tickets` → `TicketCardDto[]` · `POST` same → `TicketDto` 201 ·
`GET|PATCH /api/tickets/:id` → `TicketDetailDto` · `POST /api/tickets/:id/move` → `TicketDto` ·
`POST /api/tickets/:id/start` → `TicketDetailDto` · `POST /api/tickets/:id/comments` →
`TicketCommentDto` 201 · `POST /api/tickets/:id/plans/:planId/decision` → `TicketDetailDto` ·
`GET /api/runs/:id/checks` → `CheckRunDto[]` · `POST /api/runs/:id/agents/:agentId/checks` (`{}`)
→ `CheckRunDto[]` · `POST /api/runs/:id/review` gains `merge-anyway`.

**For P4-G (ticket page):**

- `TicketDetailDto.checks` is the current run's checks (all of them, oldest first; the merge gate
  uses the latest result per check id). `POST .../agents/:agentId/checks` answers when the checks
  have finished (it can take as long as the checks do).
- Merge refusals: `409 checks_failed` (a required check did not pass, including `skipped` after a
  stop), `409 checks_running`, `409 merge_anyway_unavailable` (nothing failed), `400
invalid_request` (merge-anyway without a reason). The reason is kept as an owner comment on the
  ticket ("Merged <role>'s changes although required checks did not pass (<names>). Reason: …").
- On-demand check refusals: `agent_working` (live agent), `not_a_helper` (the lead),
  `no_workspace`, `checks_running`, `404 not_found`.
- Start: allowed from Ready, Done, Cancelled, or an Active ticket whose run failed or was stopped;
  Backlog → `409 ticket_not_ready`; a run in progress → `409 run_in_progress`. Moves: a Done ticket
  → `409 ticket_done`; Backlog/Ready while a run is open → `409 run_in_progress`; Cancelled stops an
  open run.
- After a restart, a run that was planning or waiting for plan review is `NEEDS_REVIEW` (stage
  In review) and its last plan stays `proposed`; deciding it answers `409 plan_not_pending`. Such a
  run has no helpers, so nothing can be reviewed: the owner cancels the ticket and re-runs it.
- `TicketCardDto.latestEstimatedCost` is the **lead agent's own** provider-reported cost while this
  server process holds the run, else `unavailable` (never a sum of agents or runs).

**For P4-H (verification):**

- The allowlisted-edit step of the full flow needs the blocked contract change below first.
- `startServer({ checkRunner })` accepts a check runner (default: the real one) if the e2e wants
  one; the real runner with tiny `node` scripts works and is what `tests/board` uses.
- `tests/board/helpers.ts` `setupBoard()` is a ready harness for server-level flows (fake adapter,
  temp repo, real runner); `PASSING_WHEN_FIXED` is a manifest whose required check passes once
  `fixed.txt` exists in the checkout.
- Depth 2: a parent helper's prompt ends with `PARENT_HELPER_NOTE`; when its child ends it is sent
  `Your helper "<role>" (<id>) finished.` (or "was stopped" / "ended without finishing"). A parent
  whose own query already ended (`awaitingHelpers`) cannot receive it: counted as the
  `parent-not-notified` diagnostic.
- Demo mode rebuilds its database on every start, so a restart test needs live mode with an empty
  temp Claude dir (`tests/board/server.test.ts` does that).

**For P4-C's owner / coordinator (small inconsistency, not changed):** "Run checks now" reads the
manifest at the repository root of its temporary checkout, while the status, the context and the
agent checks read it from the project folder. They agree unless a project is a subfolder of its
repository.

## Blockers / proposed contract changes

**Blocked (one part): the allowlist cannot see a tool call's input.** Everything else is done.

- **What:** `PermissionRequest` (core v1 contract, `packages/core/src/adapters/managed.ts`) carries
  `agentRunId`, `toolName`, `toolUseId` and a redacted `summary`, but not the tool's input. The
  allowlist needs the input (`file_path` / `notebook_path` for edits, `command` for Bash:
  `allowlistTarget(toolName, input)`). The summary is redacted and cut to 200 characters, so it
  must not be used for a security decision.
- **State on this branch:** the server half is built and tested (`control/allowlist.ts`: realpath
  of the target, a new file's real parent, symlink escape, `.git`, exact check command line; the
  bridge records an allowed request as an auto-approved approval and answers allow at once). The
  bridge reads the input through `toolInputOf(request)`, which returns `undefined` today, so every
  request asks the owner (fail closed). P4-H's "allowlisted edit" step needs this unblocked.
- **Who is affected:** core (coordinator), the Claude Code adapter (P4-I's path), the fake adapter
  in server tests (mine), P4-H.
- **Proposed diff:**

  ```diff
  --- a/packages/core/src/adapters/managed.ts
  +++ b/packages/core/src/adapters/managed.ts
   export interface PermissionRequest {
     agentRunId: string;
     toolName: string;
     toolUseId: string | null;
     /** Short, redacted description for the panel, e.g. "Edit src/app.ts" (max 200 chars). */
     summary: string;
  +  /**
  +   * The tool's raw input, only for the project allowlist (ADR-0013 amendment). Held in memory
  +   * while the request is decided; never stored, logged or sent to the UI (ADR-0009).
  +   */
  +  input?: unknown;
   }
  --- a/packages/adapters/claude-code/src/managed/permissions.ts
  +++ b/packages/adapters/claude-code/src/managed/permissions.ts
         const decision = await callbacks.requestPermission({
           agentRunId: spec.agentRunId,
           toolName,
           toolUseId: toolUseID,
           summary: summarizeToolUse(toolName, input, spec.cwd),
  +        input,
         });
  --- a/packages/server/src/control/service.ts
  +++ b/packages/server/src/control/service.ts
   function toolInputOf(request: PermissionRequest): unknown {
  -  void request;
  -  return undefined;
  +  return request.input;
   }
  ```

  Plus an `input` parameter on the server tests' `FakeAgent.ask()` and a bridge test (edit inside
  the worktree auto-approved with `decidedBy: allowlist`; outside, asks). The engine already
  receives only named fields from the bridge, so the input never reaches the run state.

**Proposed, not blocking (P4-B / coordinator): store what a restart loses.** `RunState.limits`,
`EngineAgent.awaitingHelpers` and `EngineApproval.decidedBy` have no columns. They are kept for the
life of a run in this process (a live run is never reloaded), and after a restart nothing is
relaunched, so only the audit field `decidedBy` is really lost (the DTO field is optional, so it is
simply absent). A migration `0004` could add `approvals.decided_by TEXT` (owner | allowlist |
timeout) and `orchestration_runs.limits TEXT` (JSON, validated with the setup bounds); `RunStore`
would then write and load them.

## Completion report (AGENTS.md §9)

## Completion report — P4-D

1. **Summary:** the server serves every README §6.3 route over a new board layer
   (`src/board/**`, `src/routes/board.ts`) wired into `startServer`: repository creation, setup
   with lazy default rows, harness status, main-branch checks, the harness ticket, context
   candidates, the board, tickets, start / plan decisions with ticket ↔ run status, checks on review
   and on demand with the merge gate and merge-anyway, project removal (409 with history) and
   `tickets-changed` notices. The run service persists ticket runs and plans, passes context and
   model to every agent, wires depth-2 parent helpers (child tools, notice when a child ends), and
   recovers plan-first runs after a restart. The allowlist bridge is built but inactive (blocked).
2. **Files:**
   - created: `packages/server/src/board/{service,checks,harness,setup,create-repo,errors}.ts`,
     `packages/server/src/control/allowlist.ts`, `packages/server/src/routes/{board,respond}.ts`,
     `packages/server/tests/board/{helpers.ts,allowlist,projects,tickets,flow,server}.test.ts`;
   - modified: `packages/server/src/{app,bootstrap}.ts`,
     `packages/server/src/control/{service,store}.ts`, `packages/server/src/routes/control.ts`
     (helpers moved to `respond.ts`), `packages/server/README.md`, this file.
3. **Commands and results** (Node 22.21.1, pnpm 10.26.1, after the rebase on `main` 31c5f7d):
   - `pnpm check`: format ✓, lint ✓, typecheck ✓, build ✓; tests 1637/1637 ✓ (core 233, demo 12,
     orchestrator 366, claude-code 267, db 142, web 320, server 297).
   - `ACP_E2E_PORT=7651 ACP_E2E_CONTROL_PORT=7661 pnpm --filter @acp/web test:e2e`: 14/14 ✓
     (demo, control, ticket projects).
   - One earlier `pnpm check` (load average about 21) had 3 server tests time out at 5 s
     (`reference-usage`, `control/routes` M1 flow, `verification/control/restart`); the server
     suite passed 267/267 alone and the rerun of `pnpm check` passed. Environmental.
4. **Acceptance (README §8 P4-D):**
   - Routes in §6.3 with DTO parsing and CSRF: **met** (`projects`, `tickets`, `flow` tests; a
     CSRF test over every workspace mutation).
   - Ticket ↔ run wiring (start, plan decisions, stage-driven status, re-run): **met** (`flow`:
     PLANNING → plan v1 → request changes with a stored comment → v2 → approve → helper → review →
     merge → COMPLETED → ticket DONE → re-run; failed run back to Ready; cancel stops the run).
   - `git init` project creation and setup persistence: **met** (`projects`: conflict,
     invalid_root, empty first commit, default setup right after creation, PUT and key conflict).
   - Context injection: **met** (`flow`: the lead's `spec.context` has the chosen file; model from
     the setup). Allowlist in the approval bridge: **partly met** — built and unit-tested
     (`allowlist.test.ts`), **inactive until the blocked contract change** (no tool input in
     `PermissionRequest`).
   - Checks on entering review and on demand; merge-anyway with a reason: **met** (`flow`: auto
     checks on review, `checks_failed`, on-demand rerun turning green, merge-anyway recorded).
   - SSE notices for tickets and the board: **met** (`tickets-changed` asserted on create and plan
     submission).
   - `#/control` runs keep working: **met** (all Phase 3 server tests unchanged and passing; the
     control e2e passes).
   - Supertest per route with the fake adapter and temp repos: **met** (36 tests in
     `tests/board`, plus a `startServer` restart test).
5. **Assumptions** (also in the server README):
   - Checks run automatically only for ticket runs; on demand for any run. The latest result per
     check gates merge; a required check that did not pass (failed, timed out, error or skipped)
     blocks it, and running checks block it too.
   - Agent checks run with the project folder inside the worktree as root (`ws.cwd`), the manifest
     read from the project's checkout.
   - Depth-2 children's worktrees start from the project's HEAD, like every helper's.
   - The default project key comes from the name's letters (next free variant on a clash); new
     tickets land in Backlog, the harness ticket too.
   - A merge-anyway reason is kept as an owner comment on ticket runs only (Phase 3 runs have no
     ticket; only the event, without text, is logged).
   - `latestEstimatedCost` is the lead's own reported cost while the run is in memory.
   - Board reads work with managed agents off; start and plan decisions then answer
     `managed_disabled`.
   - `DELETE /api/projects/:id` is new (README §5.4 "Remove from this app"); refused while
     tickets or runs exist.
6. **Contract or shared-file changes needed:** `PermissionRequest.input?: unknown` plus a one-line
   adapter change and a one-line server change (diff under "Blockers"). Proposed, not blocking: a
   migration `0004` for `approvals.decided_by` and `orchestration_runs.limits`.
7. **Known gaps / follow-ups:** the allowlist is inactive until the contract change; `decidedBy`,
   limits and reported costs are not kept across a restart; a run interrupted while planning stays
   NEEDS_REVIEW until cancelled; the main-checks subfolder inconsistency (handoff notes); no real
   Agent SDK run (P4-H, with the owner's consent).
8. **Next recommended task:** the coordinator applies the `PermissionRequest.input` change (core +
   adapter + `toolInputOf`), then P4-H.
