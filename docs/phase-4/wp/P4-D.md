# P4-D — Server wiring

> Progress file for P4-D. Only the agent working on P4-D edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value            |
| ------- | ---------------- |
| Status  | in-progress      |
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
- [ ] Supertest per route with the fake adapter and temp repos; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                      | Commit        | Checks                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------- |
| 2026-10-16 | Claimed P4-D; branch `wp/p4-d-server` created from `main` (0d82cef)                                                                                                                                                                                                                                                                                                                                                | af3af8c       | —                                                                 |
| 2026-10-16 | Control service: ticket runs (`createTicketRun`, `decidePlan`), plans and `ticketId` persisted with the run, board hooks (in-commit, after-commit), project context and model per run, depth-2 parent helpers (child tools, prompt note, notice when a child ends), allowlist path resolution, merge gated on checks + merge-anyway                                                                                | 4a3b5d1       | format ✓ lint ✓ typecheck ✓ test 1564/1564 ✓ (server 267) build ✓ |
| 2026-10-16 | Board layer: §6.3 routes (`routes/board.ts`), board service (projects/new creating a repository, setup with lazy default rows, harness status cache, context candidates, board, tickets, start/plan decisions, ticket ↔ run status), shared check runner (checks on review + on demand, main-branch checks, orphan cleanup at start), project removal 409, SSE `tickets-changed`; bootstrap wiring; 29 route tests | 2f3311d       | format ✓ lint ✓ typecheck ✓ test 1593/1593 ✓ (server 296) build ✓ |
| 2026-10-16 | Fix: runs in PLANNING / PLAN_REVIEW were not recovered after a restart (NEEDS_REVIEW) and PLANNING was not under the run timeout; `startServer` board test with a restart; inputs to the engine are named fields only; server README section                                                                                                                                                                       | (this commit) | format ✓ lint ✓ typecheck ✓ test 1594/1594 ✓ (server 297) build ✓ |

## Handoff notes

_None yet._

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

_Written when the WP moves to `review`._
