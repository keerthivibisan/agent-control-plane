# RL-H — Ticket-level run options

> Progress file for RL-H. Only the agent working on RL-H edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: the coordinator's brief (2026-10-17) from the owner decisions in STATUS.md: each ticket
> can keep its own approval mode, reviewer and rework rounds, each defaulting to "Project
> default". Precedence when a run starts: the one-run override > the ticket's options > the
> project's settings; each run snapshots the result.

| Field   | Value                                                          |
| ------- | -------------------------------------------------------------- |
| Status  | in-progress                                                    |
| Owner   | agent (RL-H)                                                   |
| Branch  | `wp/rl-h-ticket-options` (from `feature/ui-refresh` `d260ba8`) |
| Started | 2026-10-17                                                     |
| Updated | 2026-10-17                                                     |

## Tasks

- [ ] 1. Core contract (additive): `TicketRunOptionsSchema`, `TicketDto.runOptions?`, create and
      update requests, `resolveRunOptions`; contract tests
- [ ] 2. Migration `0007_ticket_run_options.sql`; migration test; schema snapshot
- [ ] 3. db + server: repository read/write, routes, `startTicket` precedence; tests
- [ ] 4. Web: New ticket dialog, ticket page control, board badge, Start dialog pre-fill; tests
      and e2e
- [ ] 5. Docs: review-loop README section, CHANGELOG

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks |
| ---------- | ------------- | ------ | ------ |
| 2026-10-17 | Claimed RL-H  | (this) | —      |

## Decisions and findings

## Follow-ups
