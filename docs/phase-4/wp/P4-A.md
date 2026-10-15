# P4-A — Engine: plan phase, limits, depth 2, allowlist

> Progress file for P4-A. Only the agent working on P4-A edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value            |
| ------- | ---------------- |
| Status  | review           |
| Owner   | engine agent     |
| Branch  | `wp/p4-a-engine` |
| Started | 2026-10-13       |
| Updated | 2026-10-15       |

## Tasks

- [x] Plan phase transitions (PLANNING → PLAN_REVIEW → RUNNING / back to PLANNING with comment effect)
- [x] plan_not_approved refusal for start_agent
- [x] Per-run limits from project setup (validated against HARD_MAX_*)
- [x] Depth 2: parent helpers start children; status/budget roll-up; Stop all stops descendants first
- [x] Allowlist evaluation (pure): editInOwnWorktree, runHarnessChecks exact match; auto-approved approval records
- [x] Ticket-aware createRun
- [x] Tests for every transition and refusal; pnpm check green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                          | Commit  | Checks                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| 2026-10-13 | Claimed P4-A; branch `wp/p4-a-engine` created from `main` (8c05f68)                                                                                                                                                                    | edba6fe | —                                                                       |
| 2026-10-13 | WIP checkpoint after a usage-limit interruption: refusal codes, PLAN_REVIEW→FAILED edge, RunLimits/plans/decidedBy state, limits.ts, tree.ts, start_agent policy, Draft plan/limit/tree support. Not green yet (index exports pending) | f528314 | typecheck ✗ (WIP)                                                       |
| 2026-10-15 | Coordinator preserved the uncommitted work after a second interruption (plan.ts, allowlist.ts, commands, lead tools, tests, README, server refusal map)                                                                                | 130bab8 | not run (WIP)                                                           |
| 2026-10-15 | Parent helper held RUNNING while its helpers work (P4-I review point); more refusal tests; README                                                                                                                                      | 82443d5 | format ✓ lint ✓ typecheck ✓ test 1425/1425 ✓ (orchestrator 366) build ✓ |
| 2026-10-15 | Set to review with the completion report                                                                                                                                                                                               | (this)  | same as 82443d5 (docs only)                                             |

## Handoff notes

For P4-D (server). Rules: `packages/orchestrator/README.md` ("Phase 4 rules", "Notes for P4-D").

- **Start a ticket:** `createRun({ ..., ...runSettingsFromSetup(setup), ticket: { ticketId,
leadPrompt: ticketLeadPrompt(ticket, limits) } })`. It returns a PLANNING run and a `start-agent`
  effect for the lead; no owner chat message is needed.
- **Plans** live in `RunState.plans`; persist them to `ticket_plans`. The engine emits
  `plan-submitted` and `plan-decided`, which the server's effect switch ignores today; use them for
  SSE. Call `decidePlan(state, planId, 'approve' | 'request-changes', ctx, comment?)`. The engine
  only sends the owner's comment to the lead; store it as a ticket comment yourself.
- **Keep with the live run:** `RunState.limits`, `RunState.plans`, `EngineAgent.awaitingHelpers`
  and `EngineApproval.decidedBy`. `store.load` drops them today. Limits then fall back to 3 helpers
  and depth 1, which is harmless after a restart because nothing relaunches.
- **Depth 2:** `start-agent` with `canStartHelpers: true` means: give that helper `leadTools`
  restricted to child management (`ManagedAgentSpec.canStartHelpers`). Route its tool calls through
  `leadToolCall` with the helper as the caller. A worker's own worktree base for a child (main or the
  parent's branch) is a server decision.
- **Allowlist:**
  1. `allowlistTarget(toolName, input)`.
  2. Realpath the path. For a new file, use the real parent plus the name.
  3. `evaluateAllowlist({...})`.
  4. `requestPermission(state, req, ctx, { allowlist: verdict })`.

  When allowed, the result is an `approved` approval with `decidedBy: 'allowlist'` and a
  `resolve-permission` (allow) effect.

## Blockers / proposed contract changes

No contract change was needed.

**One edit outside P4-A's paths, kept on purpose:** `packages/server/src/control/errors.ts`
(+3 lines). `RefusalCode` gained `plan-not-approved`, `plan-not-found` and `plan-not-pending`.
The server's `REFUSAL_STATUS` is an exhaustive `Record<RefusalCode, number>`, so without these
entries `@acp/server` does not typecheck and `pnpm check` fails. The added mappings are
`plan-not-approved` 409, `plan-not-found` 404 and `plan-not-pending` 409. The edit sits in the WIP
commit 130bab8; the coordinator may move it into P4-D.

## Completion report (AGENTS.md §9)

1. **Summary:** the engine now runs plan-first ticket runs (`submit_plan`, `decidePlan`, and
   `plan-not-approved` refusals). It also applies per-run limits checked against the ceilings, depth 2
   (child management, roll-up, descendants-first stop, parent held while its helpers work), and the
   pure allowlist evaluation, which records auto-approved approvals. `createRun` is ticket-aware.
2. **Files:**
   - Created in `packages/orchestrator/src`: `plan.ts`, `allowlist.ts`, `limits.ts`, `tree.ts`.
   - Created in `packages/orchestrator/tests`: `plan.test.ts`, `depth-limits.test.ts`,
     `allowlist.test.ts`.
   - Modified in `packages/orchestrator`: `src/{commands,draft,errors,index,lead-tools,policy,state,
transitions}.ts`, `tests/{helpers,transitions}.test.ts`, `README.md`.
   - Modified outside P4-A's paths, needed for the build: `packages/server/src/control/errors.ts`.
     It is explained above.
3. **Checks** (`pnpm check` from the repo root, 2026-10-15):
   - format ✓, lint ✓, typecheck ✓, build ✓;
   - tests 1425 passed: core 233, demo 12, orchestrator 366, claude-code 252, db 117, web 226,
     server 219.
4. **Acceptance:**
   - **Plan phase:** met (`plan.test.ts`). PLANNING → PLAN_REVIEW → RUNNING. Request changes goes
     back to PLANNING and sends the comment to the lead.
   - **`plan_not_approved` refusals:** met, for `start_agent` and for non-read-only tools while
     planning.
   - **Limits:** met (`depth-limits.test.ts`). They are checked from 1 to 6 helpers and depth 1 to
     2, the helper count covers the whole tree, and Phase 3 defaults are kept.
   - **Depth 2:** met. Parent helpers manage their own children only; roll-up, descendants-first
     stop, deepest-first Stop all, and the parent hold are covered.
   - **Allowlist:** met (`allowlist.test.ts`). Realpath containment, protected `.git` and `.claude`,
     exact shell-inert command match, helpers only, and `decidedBy` owner, allowlist and timeout are
     covered.
   - **Ticket-aware `createRun`:** met.
   - **Typed refusals:** met; three new codes.
5. **Assumptions** (all in the package README):
   - Only ticket runs are plan-first.
   - A lead that ends before approval fails the run. `PLAN_REVIEW → FAILED` was added.
   - The owner can chat with the lead in PLANNING and PLAN_REVIEW.
   - `submit_plan` is refused while a plan waits.
   - A restart during planning gives NEEDS_REVIEW, as for other live runs.
   - The allowlist covers helpers only, and `.git` and `.claude` paths always ask.
   - A parent helper that ends with an error or a cancel ends at once; the lead keeps managing its
     helpers.
6. **Contract or shared-file changes:** none. The server refusal map is the knock-on described
   above.
7. **Gaps and follow-ups:**
   - P4-D wiring (handoff notes).
   - Persisting `decidedBy`, `limits` and `awaitingHelpers` (P4-B or P4-D).
   - A parent helper isn't told when its children end, because the adapter closes a helper's input
     after its turn. That is P4-I or P4-D's decision.
8. **Next:** P4-D (server wiring) once P4-B, P4-C and P4-I are merged.
