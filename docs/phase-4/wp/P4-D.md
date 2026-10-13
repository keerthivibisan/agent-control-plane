# P4-D — Server wiring

> Progress file for P4-D. Only the agent working on P4-D edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                                                   |
| ------- | ------------------------------------------------------- |
| Status  | todo                                                    |
| Owner   | backend agent                                           |
| Branch  | `wp/p4-d-server` (create from `main` when you claim it) |
| Started | —                                                       |
| Updated | —                                                       |

## Tasks

- [ ] Routes in README §6.3 with DTO parsing and CSRF
- [ ] Ticket ↔ run wiring: start, plan decisions, stage-driven ticket status, re-run
- [ ] Project creation (git init) and setup persistence
- [ ] Context injection; allowlist in the approval bridge
- [ ] Checks on entering review and on demand; merge-anyway with reason
- [ ] SSE notices for tickets/board; Phase 3 routes keep working
- [ ] Supertest per route with the fake adapter and temp repos; pnpm check + e2e green

## Work log (append-only; newest last)

| Date | What was done | Commit | Checks |
| ---- | ------------- | ------ | ------ |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
