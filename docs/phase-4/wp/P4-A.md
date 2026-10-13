# P4-A — Engine: plan phase, limits, depth 2, allowlist

> Progress file for P4-A. Only the agent working on P4-A edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                                                   |
| ------- | ------------------------------------------------------- |
| Status  | in-progress                                             |
| Owner   | engine agent                                            |
| Branch  | `wp/p4-a-engine`                                        |
| Started | 2026-10-13                                              |
| Updated | 2026-10-13                                              |

## Tasks

- [ ] Plan phase transitions (PLANNING → PLAN_REVIEW → RUNNING / back to PLANNING with comment effect)
- [ ] plan_not_approved refusal for start_agent
- [ ] Per-run limits from project setup (validated against HARD_MAX_*)
- [ ] Depth 2: parent helpers start children; status/budget roll-up; Stop all stops descendants first
- [ ] Allowlist evaluation (pure): editInOwnWorktree, runHarnessChecks exact match; auto-approved approval records
- [ ] Ticket-aware createRun
- [ ] Tests for every transition and refusal; pnpm check green

## Work log (append-only; newest last)

| Date | What was done | Commit | Checks |
| ---- | ------------- | ------ | ------ |
| 2026-10-13 | Claimed P4-A; branch `wp/p4-a-engine` created from `main` (8c05f68) | (this commit) | — |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
