# R-V — Verification

> Progress file for R-V. Only the agent working on R-V edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value                                 |
| ------- | ------------------------------------- |
| Status  | in-progress                           |
| Owner   | verification agent                    |
| Branch  | `wp/r-v-verify` (from `main` e06608f) |
| Started | 2026-10-16                            |
| Updated | 2026-10-16                            |

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Commit        | Checks                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| 2026-10-16 | Claimed R-V (automatic part); branch `wp/r-v-verify` from `main` (e06608f)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | (this commit) | —                                                    |
| 2026-10-16 | Server verification (`packages/server/tests/verification/redesign/`): HTTP harness with the real adapter's SDK options captured per agent; the full stage flow (separate planner + skill + agent file, lead file, helper, merge, reviewer with a `Read, Bash` file kept read-only, tester with stage model + missing file, Done); lead-mode file choice, provider-default model, symlinked/missing file, in-use agent file delete; follow-up turn (resume id, answers-only SDK options, gate, status unchanged, one at a time, SSE notice on reply and on turn end, restart mid-turn) | (this commit) | format ✓ lint ✓ typecheck ✓ test 2075/2075 ✓ build ✓ |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
