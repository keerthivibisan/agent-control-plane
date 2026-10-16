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

- [ ] Routes in README §6.3 with DTO parsing and CSRF
- [ ] Ticket ↔ run wiring: start, plan decisions, stage-driven ticket status, re-run
- [ ] Project creation (git init) and setup persistence
- [ ] Context injection; allowlist in the approval bridge
- [ ] Checks on entering review and on demand; merge-anyway with reason
- [ ] SSE notices for tickets/board; Phase 3 routes keep working
- [ ] Supertest per route with the fake adapter and temp repos; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                                                                                                       | Commit        | Checks                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| 2026-10-16 | Claimed P4-D; branch `wp/p4-d-server` created from `main` (0d82cef)                                                                                                                                                                                                                                                                 | (this commit) | —                                                                 |
| 2026-10-16 | Control service: ticket runs (`createTicketRun`, `decidePlan`), plans and `ticketId` persisted with the run, board hooks (in-commit, after-commit), project context and model per run, depth-2 parent helpers (child tools, prompt note, notice when a child ends), allowlist path resolution, merge gated on checks + merge-anyway | (this commit) | format ✓ lint ✓ typecheck ✓ test 1564/1564 ✓ (server 267) build ✓ |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
