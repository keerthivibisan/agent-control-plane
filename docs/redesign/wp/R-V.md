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

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Commit        | Checks                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed R-V (automatic part); branch `wp/r-v-verify` from `main` (e06608f)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | (this commit) | —                                                                                                                                 |
| 2026-10-16 | Server verification (`packages/server/tests/verification/redesign/`): HTTP harness with the real adapter's SDK options captured per agent; the full stage flow (separate planner + skill + agent file, lead file, helper, merge, reviewer with a `Read, Bash` file kept read-only, tester with stage model + missing file, Done); lead-mode file choice, provider-default model, symlinked/missing file, in-use agent file delete; follow-up turn (resume id, answers-only SDK options, gate, status unchanged, one at a time, SSE notice on reply and on turn end, restart mid-turn)                                                                             | (this commit) | format ✓ lint ✓ typecheck ✓ test 2075/2075 ✓ build ✓                                                                              |
| 2026-10-16 | Browser e2e: `workspace.spec.ts` (P4-H's deferred flow on the real routes: New project wizard → skill + agent file saved and committed → Workflow (separate planner, code review with skill + file) → New ticket → Start → plan v1 → request changes → v2 → approve → helper → merge → reviewer comment → Done → follow-up answered with no reload) on a new live-mode workspace server with a driver (`tests/verification/redesign/e2e-server.ts`); `pages.spec.ts` (every sidebar page, every old address, project Sessions, a session, Data health, not found); a refused follow-up in `ticket.spec.ts`; a race fix in `skills.spec.ts`; screenshots looked at | (this commit) | format ✓ lint ✓ typecheck ✓ test 2075/2075 ✓ build ✓; e2e 48/49, the 1 a pre-existing race in skills.spec.ts, fixed and rerun 4/4 |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
