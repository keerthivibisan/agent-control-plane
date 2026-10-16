# P4-H — Verification

> Progress file for P4-H. Only the agent working on P4-H edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                                  |
| ------- | -------------------------------------- |
| Status  | in-progress                            |
| Owner   | verification agent                     |
| Branch  | `wp/p4-h-verify` (from `main` 9898499) |
| Started | 2026-10-16                             |
| Updated | 2026-10-16                             |

## Tasks

Scope (owner decision, 2026-10-16): API-level verification only, in
`packages/server/tests/verification/workspace/**`. The browser e2e
(`packages/web/e2e/workspace.spec.ts`) is **deferred** (the web UI is about to be redesigned). The
real smoke run is **deferred** (it needs the owner's consent at that time).

- [x] Fake-Claude API e2e of the full flow through `startServer` (README §4.2, §8 P4-H row)
- [x] Depth 2 and limit refusals (`maxDepth`, `maxConcurrentHelpers`, `plan_not_approved`)
- [x] Merge anyway: reason required and stored as a ticket comment
- [x] Restart mid-run: planning run → NEEDS_REVIEW, nothing relaunched, board and ticket load
- [x] Security spot checks: CSRF on every mutation, `projects/new` refusals, no raw tool input in
      any response or log line
- [ ] Phase 4 acceptance checklist with evidence
- [ ] Browser e2e `packages/web/e2e/workspace.spec.ts`: **deferred** (UI redesign)
- [ ] Real smoke run ONLY with the owner's consent at that time; aggregates only: **deferred**

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Commit        | Checks                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed P4-H; branch `wp/p4-h-verify` from `main` (9898499)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 262b828       | —                                                                                       |
| 2026-10-16 | Verification harness (`startServer`, fake adapter, capturing logger, SSE reader) and the full-flow test: new repo → setup → harness ticket → plan v1 → changes → v2 → approve → allowlisted edit / owner-asked write / denied outside edit → merge; feature ticket → allowlisted check command → failing check blocks merge → fix → merge → Done; no tool input in responses, logs, SSE or DB                                                                                                                                                                       | b7ebeae       | format ✓ lint ✓ typecheck ✓ test 1642/1642 ✓ (server 300) build ✓                       |
| 2026-10-16 | Limits (plan_not_approved twice, depth 2 parent → child → parent told, too-many-agents for lead and parent, depth-exceeded from a child, depth 1 default), merge anyway (reason required, stored as comment, not logged; unavailable when nothing failed), restart (planning and plan-review runs → NEEDS_REVIEW, nothing relaunched, board/ticket/setup/harness load, plan_not_pending, cancel + re-run), security (CSRF on 19 mutations, projects/new refusals, tool input nowhere incl. after a restart); finding: `POST /api/projects` has no CSRF (`it.fails`) | (this commit) | format ✓ lint ✓ typecheck ✓ test 1650/1650 ✓ + 1 expected fail (server 308 + 1) build ✓ |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
