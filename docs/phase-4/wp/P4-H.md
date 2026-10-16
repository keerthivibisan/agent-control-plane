# P4-H — Verification

> Progress file for P4-H. Only the agent working on P4-H edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                                  |
| ------- | -------------------------------------- |
| Status  | review                                 |
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
- [x] Phase 4 acceptance checklist with evidence (below)
- [ ] Browser e2e `packages/web/e2e/workspace.spec.ts`: **deferred** (UI redesign)
- [ ] Real smoke run ONLY with the owner's consent at that time; aggregates only: **deferred**

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Commit        | Checks                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed P4-H; branch `wp/p4-h-verify` from `main` (9898499)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 262b828       | —                                                                                       |
| 2026-10-16 | Verification harness (`startServer`, fake adapter, capturing logger, SSE reader) and the full-flow test: new repo → setup → harness ticket → plan v1 → changes → v2 → approve → allowlisted edit / owner-asked write / denied outside edit → merge; feature ticket → allowlisted check command → failing check blocks merge → fix → merge → Done; no tool input in responses, logs, SSE or DB                                                                                                                                                                       | b7ebeae       | format ✓ lint ✓ typecheck ✓ test 1642/1642 ✓ (server 300) build ✓                       |
| 2026-10-16 | Limits (plan_not_approved twice, depth 2 parent → child → parent told, too-many-agents for lead and parent, depth-exceeded from a child, depth 1 default), merge anyway (reason required, stored as comment, not logged; unavailable when nothing failed), restart (planning and plan-review runs → NEEDS_REVIEW, nothing relaunched, board/ticket/setup/harness load, plan_not_pending, cancel + re-run), security (CSRF on 19 mutations, projects/new refusals, tool input nowhere incl. after a restart); finding: `POST /api/projects` has no CSRF (`it.fails`) | 556887d       | format ✓ lint ✓ typecheck ✓ test 1650/1650 ✓ + 1 expected fail (server 308 + 1) build ✓ |
| 2026-10-16 | Status `review`; acceptance checklist, findings, handoff notes and completion report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | (this commit) | docs only (same checks as 556887d)                                                      |

## Phase 4 acceptance checklist (API level, fake Claude)

All in `packages/server/tests/verification/workspace/`, through `startServer` on 127.0.0.1 (ephemeral
port), live mode over an empty temp Claude dir, the scripted fake managed adapter, the real check
runner (tiny `node` scripts) and temp repositories.

| README §8 P4-H / owner list                                                             | Result     | Evidence                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a repo with `POST /api/projects/new` (init in a temp parent)                     | met        | `flow.test.ts`: `main` branch, README in the first commit, setup answers at once                                                                                    |
| Setup PUT (limits, allowlist, context files)                                            | met        | `flow.test.ts`: saved and used (lead `spec.context` has `README.md`); limits in `limits.test.ts`                                                                    |
| "Build the harness" ticket                                                              | met        | `flow.test.ts`: `SHOP-1`, type harness, Backlog; worked to Done; its manifest lands on main                                                                         |
| Start → plan → request changes (comment reaches the lead) → v2 → approve                | met        | `flow.test.ts`: v1 `changes-requested`, owner comment stored with `planId`, `lead.sent` has it, v2 `approved`, run RUNNING, stage WORKING                           |
| Helpers start                                                                           | met        | `flow.test.ts`, `limits.test.ts`: each in its own worktree outside the owner's checkout                                                                             |
| Allowlisted edit: inside own worktree auto-approved; outside asks the owner             | met        | `flow.test.ts`: Edit in the worktree → `{ allow: true }`, no pending approval; edit of the owner's checkout → pending → denied; ticket NEEDS_YOU while asked        |
| Allowlisted check command                                                               | met        | `flow.test.ts` ticket 2: Bash `node check.mjs` auto-approved; `node check.mjs; echo …` asks                                                                         |
| A check run                                                                             | met        | `flow.test.ts`: "Run checks now" on main (failed, `runId: null`); on entering review; on demand                                                                     |
| Review: failing required check blocks merge (`checks_failed`), passes after a fix       | met        | `flow.test.ts` ticket 2: `409 checks_failed`, nothing on main; `fixed.txt` in the worktree → on-demand `passed` → merge 200                                         |
| Merge → ticket Done                                                                     | met        | `flow.test.ts`: both tickets DONE, runs COMPLETED, Done column `SHOP-1, SHOP-2`, history kept                                                                       |
| Depth 2: parent starts a child, is told when it ends                                    | met        | `limits.test.ts`: `canStartHelpers`, `PARENT_HELPER_NOTE`, child `parentAgentRunId`, `Your helper "Child" (<id>) finished.`                                         |
| Refusal: deeper than the limit                                                          | met        | `limits.test.ts`: the child gets no tools; the engine refuses a start from it (`depth-exceeded`); depth-1 helpers get no tools                                      |
| Refusal: more helpers than `maxConcurrentHelpers`                                       | met        | `limits.test.ts`: lead and parent refused (`too-many-agents`, logged); a slot frees when the child ends                                                             |
| Refusal: helper before plan approval (`plan_not_approved`)                              | met        | `limits.test.ts`, `flow.test.ts`: refused in PLANNING and PLAN_REVIEW, logged `plan-not-approved`, no helper started                                                |
| Merge anyway: needs a reason; reason stored as a ticket comment                         | met        | `merge-anyway.test.ts`: missing, empty, blank reason → 400; merged; owner comment with check name and reason; reason never logged; 409 when nothing failed          |
| Restart mid-run: planning run → NEEDS_REVIEW, nothing relaunches, board and ticket load | met        | `restart.test.ts`: PLANNING and PLAN_REVIEW runs → NEEDS_REVIEW / In review; no agent started; plan kept (`plan_not_pending`); cancel + re-run                      |
| Security: every mutation without `X-ACP-CSRF` refused                                   | **partly** | `security.test.ts`: 19 board and control mutations → 403, nothing changes. **Finding:** Phase 1 `POST /api/projects` has no check (`it.fails`)                      |
| Security: `projects/new` refuses an existing folder (409) and a missing parent          | met        | `security.test.ts`: folder and file → 409, untouched; missing or file parent → `invalid_root`; traversal, relative → `invalid_request`                              |
| Security: raw tool input in no API response or log line                                 | met        | `flow.test.ts`, `security.test.ts`: markers absent from every response, every log line (production logger), SSE frames and every database row, also after a restart |
| Browser e2e `packages/web/e2e/workspace.spec.ts`                                        | deferred   | owner decision 2026-10-16: the web UI is about to be redesigned                                                                                                     |
| One real smoke run                                                                      | deferred   | needs the owner's consent at that time                                                                                                                              |

## Handoff notes

- **Harness for later verification:** `tests/verification/workspace/harness.ts`
  (`bootWorkspace()`: `startServer`, fake adapter, `logs` and `responses` captured,
  `listenToStream()` for SSE, `startTicket` / `submitPlan` / `approveLatestPlan` / `startHelper`).
  A restart shares `dataDir`, `claudeDir` and `logs` between two `bootWorkspace` calls.
- **For the browser e2e (deferred):** the flow works as written in `flow.test.ts`; the P3-F
  `e2e-server.ts` pattern (fake adapter behind a small test-only control endpoint) is the way to
  drive agents from Playwright.
- **Observations (by design, not bugs; each worth a line in the UI):**
  - The "Build the harness" ticket's own review runs **no checks**: checks always come from the
    project's checkout, never from the helper's worktree (ADR-0017). The ticket page could say
    "No checks yet: this ticket builds them" and offer "Run checks now" after the merge.
  - With `editInOwnWorktree`, a write into a folder that does **not exist yet** in the worktree
    (e.g. `.acp/harness.json` in a new repository) is not auto-approved: `resolveEditTarget`
    resolves only the immediate parent, so the owner is asked (fail closed). Every "Build the
    harness" run asks once. Possible improvement: resolve the nearest existing ancestor and require
    the missing part to be plain names (no `..`).
  - Right after a run enters review, "Run checks" on a helper can answer `409 checks_running`
    while the review checks are in flight (even with no manifest). Documented; the UI can retry.
  - From reading the code only (not tested): the harness status is cached for 10 s and a merge
    does not invalidate it, so the board can show "None" for a few seconds after the harness
    ticket merges.
  - Known from P4-D: limits, `decidedBy` and reported costs are not stored; `limits.test.ts` puts
    the project's limits back on the loaded state for its engine depth check.

## Blockers / proposed contract changes

No blocker for P4-H. **One finding in P4-D's code** (not fixed here: `src/` is not P4-H's):

- **`POST /api/projects` (add an existing folder) has no CSRF check.** Every Phase 3 and Phase 4
  mutation requires `X-ACP-CSRF`; this Phase 1 route (`packages/server/src/routes/api.ts`) does
  not, so a request without the token registers any existing local folder as a project, which
  agents may then work on. The local-only guard still refuses cross-origin browser requests, so
  this is defence in depth, but it contradicts "all mutations need `X-ACP-CSRF`" (README §6.3) and
  the owner's spot check.
  - **Test:** `security.test.ts` "POST /api/projects (add an existing folder) refuses a request
    without the token", marked `it.fails` (today it answers 201). Remove `.fails` when fixed.
  - **Proposed fix:** require `requireCsrf(control.csrfToken)` on `POST /api/projects` when the
    control service is mounted (for example, pass an optional CSRF middleware into
    `createApiRouter`), and have the web's `registerProject` (`packages/web/src/lib/api.ts`,
    `client.post(paths.projects(), …)`) send the token the way `controlPost` does. Affects the Setup
    page and the wizard's "Add an existing folder" path: P4-D (server) and the web owner.

## Completion report (AGENTS.md §9)

## Completion report — P4-H (API-level verification)

1. **Summary:** the Phase 4 owner flow is verified end to end over HTTP against the real server
   composition, with the fake managed adapter, temp repositories and the real check runner:
   project creation, setup, the harness ticket, plan review, helpers, the allowlist, checks, merge
   gating, merge anyway, depth 2 and limits, restart, and security spot checks. One finding (no
   CSRF on `POST /api/projects`). The browser e2e and the real smoke run are deferred by the owner.
2. **Files changed:**
   - created: `packages/server/tests/verification/workspace/harness.ts`, `flow.test.ts`,
     `limits.test.ts`, `merge-anyway.test.ts`, `restart.test.ts`, `security.test.ts`;
   - modified: `docs/phase-4/wp/P4-H.md`.
3. **Commands and results** (Node 22.21.1, pnpm 10.26.1): `pnpm check` → format ✓, lint ✓,
   typecheck ✓, build ✓; tests 1650 passed + 1 expected fail (core 233, demo 12, orchestrator 366,
   claude-code 268, db 142, web 321, server 308 + 1 expected fail). The new suite alone
   (`vitest run tests/verification/workspace` in `packages/server`): 6 files, 9 passed + 1 expected
   fail.
4. **Acceptance criteria:** see the checklist above. All met except "every mutation without
   `X-ACP-CSRF` is refused" (partly: one Phase 1 route, the finding) and the two deferred items.
5. **Assumptions** (recorded above):
   - two tickets for the full flow, because a helper's own manifest never chooses the checks (the
     harness ticket's review is unchecked; the feature ticket is the first checked one);
   - "the fix" is written into the helper's worktree by the test, as in P4-D's tests;
   - the depth-beyond-limit refusal is shown by the missing tools plus the engine on the run's
     state (a depth-2 child has no tool the fake could call).
6. **Contract or shared-file changes needed:** none. A proposed fix for P4-D's route is above.
7. **Known gaps / follow-ups:** browser e2e (deferred, UI redesign); real smoke run (deferred,
   owner consent); the observations above.
8. **Next recommended task:** fix the `POST /api/projects` CSRF finding (server and web), then the
   real smoke run with the owner's consent, then the browser e2e after the UI redesign.
