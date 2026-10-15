# P4-B — Database: migration 0003 and repositories

> Progress file for P4-B. Only the agent working on P4-B edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value             |
| ------- | ----------------- |
| Status  | in-progress       |
| Owner   | persistence agent |
| Branch  | `wp/p4-b-db`      |
| Started | 2026-10-13        |
| Updated | 2026-10-13        |

## Tasks

- [ ] 0003_workspace.sql: project_setup, tickets (per-project seq), ticket_comments, ticket_plans, check_runs, orchestration_runs.ticket_id
- [ ] Repositories with zod validation at the boundary
- [ ] Atomic ticket key sequence per project
- [ ] Upgrade test from a 0002 database; 0001/0002 untouched
- [ ] README section; pnpm check green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                 | Commit        | Checks                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| 2026-10-13 | Claimed; branch `wp/p4-b-db` created from `main`                                                                                                              | (this commit) | —                                                                         |
| 2026-10-13 | WIP checkpoint after a usage-limit interruption: migration 0003, workspace repositories, runs `ticketId`, depth-2 agent runs; workspace tests not written yet | (this commit) | db tests 117/117 ✓; server tests have timeouts under load (being checked) |
| 2026-10-15 | Workspace tests (tickets, plans, comments, setup, check runs), 0002 → 0003 upgrade test, README section; resumed from 584682d                                 | (this commit) | format ✓ lint ✓ typecheck ✓ test 1392/1392 ✓ build ✓                      |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
