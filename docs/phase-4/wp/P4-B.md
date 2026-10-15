# P4-B — Database: migration 0003 and repositories

> Progress file for P4-B. Only the agent working on P4-B edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value             |
| ------- | ----------------- |
| Status  | review            |
| Owner   | persistence agent |
| Branch  | `wp/p4-b-db`      |
| Started | 2026-10-13        |
| Updated | 2026-10-15        |

## Tasks

- [x] 0003_workspace.sql: project_setup, tickets (per-project seq), ticket_comments, ticket_plans, check_runs, orchestration_runs.ticket_id
- [x] Repositories with zod validation at the boundary
- [x] Atomic ticket key sequence per project
- [x] Upgrade test from a 0002 database; 0001/0002 untouched
- [x] README section; pnpm check green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                 | Commit        | Checks                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| 2026-10-13 | Claimed; branch `wp/p4-b-db` created from `main`                                                                                                              | (this commit) | —                                                                         |
| 2026-10-13 | WIP checkpoint after a usage-limit interruption: migration 0003, workspace repositories, runs `ticketId`, depth-2 agent runs; workspace tests not written yet | (this commit) | db tests 117/117 ✓; server tests have timeouts under load (being checked) |
| 2026-10-15 | Workspace tests (tickets, plans, comments, setup, check runs), 0002 → 0003 upgrade test, README section; resumed from 584682d                                 | (this commit) | format ✓ lint ✓ typecheck ✓ test 1392/1392 ✓ build ✓                      |
| 2026-10-15 | Status `review`; completion report written                                                                                                                    | (this commit) | format ✓ lint ✓ typecheck ✓ test 1392/1392 ✓ build ✓                      |

## Handoff notes

- Entry point: `createWorkspaceRepositories(db, options?)` from `@acp/db` →
  `{ projectSetup, tickets, plans, comments, checkRuns }`. Full API in `packages/db/README.md`
  ("Workspace schema").
- `orchestration.runs.insert` takes `ticketId?`; `runs.list({ ticketId })` gives a ticket's run
  history (newest first). Phase 3 runs read back `ticketId: null`.
- `agentRuns.insert` now allows helpers up to `HARD_MAX_DEPTH` (2) below the lead. The engine
  applies the project's own limit.
- A ticket needs a `project_setup` row first (the key prefix): projects registered before Phase 4
  get one from P4-D (defaults), else `tickets.insert` throws `not_found`.
- `projects.remove` throws a raw SQLite FOREIGN KEY error when tickets or runs exist; P4-D should
  check `tickets.countForProject` / runs first and answer 409.
- Server smoke test `tests/smoke.test.ts` failed repeatedly on 2026-10-13 under heavy load, on the
  baseline commit too (8c05f68); it passed in the final `pnpm check`.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

1. **Summary:** migration `0003_workspace.sql` (project_setup, tickets, ticket_plans,
   ticket_comments, check_runs, `orchestration_runs.ticket_id`) and the workspace repositories,
   with temp-file DB tests and an upgrade test from a 0002 database.
2. **Files:**
   - created: `packages/db/src/migrations/0003_workspace.sql`;
     `packages/db/src/repositories/workspace/{index,project-setup,tickets,plans,comments,check-runs}.ts`;
     `packages/db/tests/workspace/{setup.ts,tickets.test.ts,plans-comments.test.ts,setup-checks.test.ts,migration-0003.test.ts}`;
   - modified: `packages/db/src/index.ts` (export), `packages/db/src/repositories/orchestration/runs.ts`
     (`ticketId`), `packages/db/src/repositories/orchestration/agent-runs.ts` (depth 2),
     `packages/db/tests/schema.test.ts` and its snapshot (additive), `packages/db/tests/orchestration/{agent-runs,migration-0002}.test.ts`
     (depth 2 now allowed; 0002 upgrade no longer stops at version 2), `packages/db/README.md`, this file.
3. **Checks (`pnpm check`, Node 22.21.1, pnpm 10.26.1):** format ✓ lint ✓ typecheck ✓ test 1392/1392 ✓
   (core 233, orchestrator 308, demo 12, claude-code 252, db 142, web 226, server 219) build ✓.
   Earlier runs under load had vitest worker-start timeouts and server test timeouts; the reruns passed.
4. **Acceptance:**
   - migration and the tables → met (schema snapshot, STRICT test);
   - atomic per-project ticket sequence → met (counter in `project_setup`, `BEGIN IMMEDIATE`;
     two-connection test; numbers never reused);
   - temp-file DB tests → met (25 new tests in `tests/workspace`);
   - upgrade from a 0002 database, 0001/0002 not edited → met (`migration-0003.test.ts`; checksums
     recorded before and after the upgrade are equal);
   - README section; `pnpm check` green → met.
5. **Assumptions:**
   - project keys are unique across projects, so `WEB-12` names one ticket;
   - ticket keys are fixed at creation, so renaming the project key affects only new tickets;
   - plan versions count per run; `plannedHelpers` is computed in the repository (distinct
     non-"Lead" roles, case-insensitive);
   - deleting a run deletes its plans, its run/plan comments and its check runs, as ADR-0015 does
     for the chat; ticket-level comments stay.
     All of these are in the README section.
6. **Contract changes:** none needed. Outside the listed paths, but still in `packages/db`:
   `agent-runs.ts` now allows depth 2 (ADR-0013 amendment). Please review this.
7. **Gaps:** `projects.remove` doesn't map the FK error to a typed error (P4-D checks first). There
   is no board-stats query (tokens over the last 7 days); P4-D can use the existing usage queries.
8. **Next:** P4-D wires these repositories into the routes.
