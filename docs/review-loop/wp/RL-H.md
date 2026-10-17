# RL-H — Ticket-level run options

> Progress file for RL-H. Only the agent working on RL-H edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: the coordinator's brief (2026-10-17) from the owner decisions in STATUS.md: each ticket
> can keep its own approval mode, reviewer and rework rounds, each defaulting to "Project
> default". Precedence when a run starts: the one-run override > the ticket's options > the
> project's settings; each run snapshots the result.

| Field   | Value                                                          |
| ------- | -------------------------------------------------------------- |
| Status  | review                                                         |
| Owner   | agent (RL-H)                                                   |
| Branch  | `wp/rl-h-ticket-options` (from `feature/ui-refresh` `d260ba8`) |
| Started | 2026-10-17                                                     |
| Updated | 2026-10-17                                                     |

## Tasks

- [x] 1. Core contract (additive): `TicketRunOptionsSchema`, `TicketDto.runOptions?`, create and
      update requests, `resolveRunOptions`; contract tests
- [x] 2. Migration `0007_ticket_run_options.sql`; migration test; schema snapshot
- [x] 3. db + server: repository read/write, routes, `startTicket` precedence; tests
- [x] 4. Web: New ticket dialog, ticket page control, board badge, Start dialog pre-fill; tests
      and e2e
- [x] 5. Docs: review-loop README section, CHANGELOG

## Work log (append-only; newest last)

| Date       | What was done                                                 | Commit    | Checks                                                            |
| ---------- | ------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| 2026-10-17 | Claimed RL-H                                                  | `f588369` | —                                                                 |
| 2026-10-17 | Core: `TicketRunOptionsSchema`, requests, `resolveRunOptions` | `b461ced` | format ✓ lint ✓ typecheck ✓ test 2593/2593 ✓ build ✓              |
| 2026-10-17 | db: migration 0007, `ticketRunOptions` repository, snapshot   | `bdbb8f4` | format ✓ lint ✓ typecheck ✓ test 2602/2602 ✓ build ✓              |
| 2026-10-17 | Server: create, PATCH and start precedence                    | `a0c2ba5` | format ✓ lint ✓ typecheck ✓ test 2610/2610 ✓ build ✓              |
| 2026-10-17 | Web: New ticket, ticket page, badge, Start dialog; e2e        | `52b7cde` | test 2623/2623 ✓; e2e new 1/1 ✓                                   |
| 2026-10-17 | Docs: README §11, CHANGELOG; full check and full e2e; review  | (this)    | format ✓ lint ✓ typecheck ✓ test 2623/2623 ✓ build ✓; e2e 62/62 ✓ |

## Decisions and findings

1. **Separate repository for the new column.** The older upgrade tests (0004, 0005, 0006) use the
   Phase 4 tickets repository on databases before 0007, so selecting `run_options` there broke
   them. As with the 0006 columns (`review-loop/columns.ts`), `tickets.run_options` is read and
   written by `createReviewLoopRepositories().ticketRunOptions`; the tickets repository is
   unchanged. The board service joins them.
2. **NULL, never `{}`.** A ticket with no option set stores NULL and its DTO has no `runOptions`
   key, so tickets read exactly as before 0007.
3. **Patch semantics.** `UpdateTicketRequest.runOptions` is a per-field patch (value sets, `null`
   clears, absent keeps); `runOptions: null` clears all. The ticket page always sends all three
   (value or `null`) so the saved state is what the form shows.
4. **`TicketSchema.runOptions` is a getter** (zod 4) because `ApprovalModeSchema` is declared
   further down the same module; moving declarations was avoided to keep the contract diff
   additive.
5. **Start dialog defaults** are the ticket's effective options (ticket > project); the request
   carries only what differs from them, and the server applies run > ticket > project, so the
   result is the same as what the dialog shows.
6. **Board badge** compares with the project's current settings (an option equal to the
   project's value shows no badge but still holds if the project changes). The workflow query is
   made only when a card has options of its own, and nothing shows while it loads.
7. The `ticket started` log gains `approvalModeFrom`, `reviewerFrom`, `maxReworkRoundsFrom`
   (`run` | `ticket` | `project`); no free text.

## Follow-ups

1. `RunDetailDto` does not say where each snapshotted option came from (run, ticket or project);
   the log does. Add it if the owner wants it on the ticket page.
2. The Settings summary and the Workflow page do not count tickets with their own options.
