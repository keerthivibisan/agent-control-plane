# RL-B — Server, db repositories, git flows and adapter for the review loop

> Progress file for RL-B. Only the agent working on RL-B edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope and owned paths: `docs/review-loop/README.md` §6, §9.

| Field   | Value                                                                     |
| ------- | ------------------------------------------------------------------------- |
| Status  | review                                                                    |
| Owner   | agent (RL-B)                                                              |
| Branch  | `wp/rl-b-server` (rebased on `feature/ui-refresh` `9082d81`, RL-A merged) |
| Started | 2026-10-17                                                                |
| Updated | 2026-10-17                                                                |

## Tasks

- [x] db repositories: ticket branches, change reviews, 0006 columns, snapshot approvals and
      integration
- [x] WorkspaceManager git flows (ticket branch, seal, integrate, advance, final merge, update
      from base, discard) and per-worktree / per-repository serialization (coordinator request
      from U-V)
- [x] Checks per commit (helper commits, ticket tip) and the per-commit merge gate
- [x] Control service and routes: engine effects, `merge_change`, `view_change`, change-reviewer
      brief, ticket-branch routes, owner `rework`, DTO fields, Start options, setup approvals,
      gate modes
- [x] Adapter: change tools, change reviewer tools, rework resume, "Latest" labels
- [x] Rebase on `feature/ui-refresh` after RL-A, wire the real engine calls

## Work log (append-only; newest last)

| Date       | What was done                                                             | Commit    | Checks                                               |
| ---------- | ------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| 2026-10-17 | Claimed RL-B                                                              | `00a99b4` | —                                                    |
| 2026-10-17 | db: review-loop repositories (0006 tables and columns, snapshot parser)   | `4bd1e1a` | format ✓ lint ✓ typecheck ✓ test 2302/2302 ✓ build ✓ |
| 2026-10-17 | server: ticket-branch git flows, per-worktree/per-repo git serialization  | `3cdb894` | format ✓ lint ✓ typecheck ✓ test 2327/2327 ✓ build ✓ |
| 2026-10-17 | adapter: change tools, change reviewer, rework resume, labels             | `90e9bfa` | format ✓ lint ✓ typecheck ✓ test 2327/2327 ✓ build ✓ |
| 2026-10-17 | server: checks per commit, project approvals                              | `8a0b937` | format ✓ lint ✓ typecheck ✓ test 2332/2332 ✓ build ✓ |
| 2026-10-17 | Rebased on `feature/ui-refresh` with RL-A; db: ticket key/branch snapshot | `8efe3f8` | format ✓ lint ✓ typecheck ✓ test 2430/2430 ✓ build ✓ |
| 2026-10-17 | server: review loop wiring, ticket-branch routes, gate modes, DTOs        | `514b321` | format ✓ lint ✓ typecheck ✓ test 2430/2430 ✓ build ✓ |

| 2026-10-17 | Review fix: lead hears of approval only after the ticket branch exists | `1181575` | format ✓ lint ✓ typecheck ✓ test 2432/2432 ✓ build ✓ |
| 2026-10-17 | Rebased on `b6f5511` (RL-D); workspace e2e server serves legacy runs | (this) | format ✓ lint ✓ typecheck ✓ test 2506/2506 ✓ build ✓ |

(Commit ids were rewritten by each rebase; ids before the last rebase are the ones at the time.)

**Web e2e** (`pnpm --filter @acp/web test:e2e`, `ACP_E2E_PORT=9151 ACP_E2E_CONTROL_PORT=9161`, on
`feature/ui-refresh` `b6f5511` with RL-D): 59/59 passed, twice in a row. `workspace.spec.ts`
drives the legacy owner flow (merge each change into main), so its e2e server now starts legacy
ticket runs (`ACP_E2E_REVIEW_LOOP=1` serves loop runs); with loop runs it got past the
`start_agent` race and then stopped at `request_review` ("Decide every change first"), as the
loop requires. A browser flow on the real loop routes is a follow-up for RL-D/RL-V.

## Handoff notes

### For RL-D (web)

- `GET /api/runs/:id` adds `approvalMode`, `ticketBranch` (null until plan approval) and
  `changes` (one card per helper or tester change: state, rounds, head commit, changed files,
  conflict files, checks on the head commit only, review rounds with comment ids) for loop runs;
  all three are absent for legacy runs. `ApprovalDto.allowRule` is set on approvals the policy
  allowed.
- `GET /api/runs/:id/workflow` adds `review` counts for loop runs.
- `GET /api/runs/:id/ticket-branch` → `TicketBranchReviewDto` (404 `no_ticket_branch` before
  plan approval or for legacy runs). `POST` (CSRF) with `TicketBranchActionRequest`; refusals:
  `checks_running` (also when the tip's checks had not run: they start), `checks_failed`,
  `merge_anyway_unavailable`, `base_moved`, `base_dirty`, `base_branch_changed`,
  `ticket_branch_moved`, `merge_conflict` (update from base), engine codes (`run_not_active`,
  `workers_still_running`/`changes_undecided`, `agent_not_live`, …). Each answers the
  ticket branch afterwards.
- `POST /api/runs/:id/review` on loop runs: `merge` / `merge-anyway` (reason) / `discard`
  (reason optional) / `rework` (comment) go to the engine as the owner's decision; a blocked
  merge answers `merge_conflict`, `checks_running`, `checks_failed` or `merge_failed` with the
  engine's text. `GET /api/runs/:id/review` lists sealed changes with their diff against the
  ticket tip.
- `POST /api/tickets/:id/start` takes `StartTicketRequest` (all optional).
- Refusal error codes now use the review-loop reason when there is one (`rework_limit`,
  `checks_failed`, `change_not_decidable`, `change_busy`, `legacy_review`, `handed_over`, …);
  statuses follow the engine code as before.

### For RL-V

- A new project setup starts on `auto-edits`; a setup saved before ADR-0021 has no `approvals`
  and maps from its legacy allowlist (`approvalsOf`).
- Every ticket run started now uses the loop. Runs started before keep the legacy flow.

## Completion report (AGENTS.md §9)

## Completion report — RL-B

1. **Summary:** the server, db and adapter half of ADR-0021 on top of RL-A's engine: ticket
   branch git flows (argv only, CAS, per-worktree and per-repository serialization), checks per
   commit with a per-commit merge gate, the engine's loop effects, the lead's and owner's change
   actions, the owner's single ticket-branch merge, approval modes in the gate, the new DTO
   fields, and the adapter's change tools, change reviewer, rework resume and labels.
2. **Files changed:**
   - created: `packages/db/src/repositories/review-loop/{index,ticket-branches,change-reviews,columns}.ts`,
     `packages/db/tests/review-loop/repositories.test.ts`,
     `packages/server/src/control/{review-loop,review-loop-dto}.ts`,
     `packages/server/tests/workspace/ticket-branch.test.ts`,
     `packages/server/tests/board/{commit-checks,approvals-setup,review-loop,review-loop-more,loop-helpers}.test.ts`
     (`loop-helpers.ts` is a helper),
     `packages/server/tests/verification/review-loop/flow.test.ts`,
     `packages/adapters/claude-code/tests/managed/review-loop.test.ts`, this file;
   - modified (db): `src/index.ts` (one export line), `src/repositories/redesign/{run-audit,index}.ts`;
   - modified (server): `src/workspace/{manager,errors,index}.ts`,
     `src/control/{service,store,allowlist,errors,mappers,review-checkouts}.ts`,
     `src/board/{service,checks,harness,setup}.ts`, `src/routes/{control,board}.ts`,
     `src/bootstrap.ts`; tests: `board/helpers.ts`, `board/flow.test.ts`,
     `workflow/{stages,audit}.test.ts`, `verification/{workspace,redesign}/harness.ts`;
   - modified (adapter): `src/managed/{permissions,adapter,lead-tools,messages,summary,index}.ts`,
     `tests/managed/{adapter,permissions}.test.ts`.
3. **Commands run and actual results** (`pnpm check` from the root, Node 22.21.1, pnpm 10.26.1,
   on `514b321`): format:check ✓; lint ✓ (0 warnings); typecheck ✓; test ✓ 2430 passed (core 285,
   adapter-demo 12, adapter-claude-code 330, orchestrator 552, db 185, web 611, server 455);
   build ✓. Two git-heavy server tests timed out at 5 s once under load from other agents and
   passed alone; the ticket-branch test file now uses a 30 s timeout per test.
4. **Acceptance criteria (README §6 and the brief):**
   - db repositories for ticket branches, change reviews, 0006 columns, approvals read/write,
     snapshot approvals + integration → met (`repositories.test.ts`, `approvals-setup.test.ts`);
   - WorkspaceManager git: createTicketBranch (`acp/<KEY>`, `-r<n>`, schema-checked), worktrees
     from the tip, seal, integrate (conflict → file names, abort), advance (ancestor + not checked
     out + `update-ref` CAS), final ff-only merge (clean tree, base branch, `base-moved`),
     update from base (temporary worktree + checks again), discard (`branch -D`, worktrees
     cleaned), unknown `acp/*` refs never deleted, open branches kept for NEEDS_REVIEW/CANCELLED
     → met (real temp repos, `ticket-branch.test.ts`, `review-loop-more.test.ts`);
   - per-worktree git serialization (coordinator/U-V) → met (concurrent `changes()`/`seal()`/
     `merge()` test);
   - checks per commit (sealed/integrated helper commits in the helper worktree; the tip at
     REVIEW in a temporary checkout; manifest from the owner's checkout; gate counts the current
     commit only) → met (`commit-checks.test.ts`, loop tests);
   - control service + routes (all new effects, `merge_change` sequence, `view_change` ≤ 32 KiB,
     reviewer brief ≤ 64 KiB, ticket-branch GET/POST with CSRF, owner `rework`, DTO fields,
     StartTicketRequest, setup approvals, gate modes with `allowRule`, legacy runs unchanged) →
     met;
   - adapter (lead change tools, change reviewer `submit_review` only, final reviewer
     `post_review` only, rework resume with the same tools and input closing, labels) → met;
   - logs carry ids, codes and counts only → met (the verification test checks a diff marker is
     in no log line or database row).
5. **Assumptions:**
   - every ticket run started now uses the loop; tests that verify the legacy flow start legacy
     runs through a tests-only option (`legacyTicketRuns`, never set in production);
   - a new project setup gets `approvals: auto-edits` (the default applies when the setup row is
     created, including the first board call of a project registered earlier without a row);
   - the sealed commit's checks start right after sealing; a change is merged only after the
     required checks passed on the integrated commit (which is the sealed commit when the tip has
     not moved);
   - a late check result for an older commit of the same change is not reported to the engine;
   - an owner decision on a round the lead already passed to the owner (`ask-owner`) is stored as
     its own `change_reviews` row (reviewer `owner`), so the history keeps both;
   - the owner's "merge" of the ticket branch needs the tip's required checks; if they had not run
     they are started and the merge answers `checks_running`;
   - refusal reasons are used as the HTTP error code (statuses still follow the engine code).
6. **Contract or shared-file changes needed:** none made. Proposed (from RL-A, agreed): promote
   `Refusal.reason` values to `RefusalCode`s; an engine command for a failed ticket-branch
   creation (today the run is stopped with `cancelRun`).
7. **Known gaps / follow-ups:**
   - `docs/orchestration-lifecycle.md`, `docs/architecture.md` and the README "Status" do not
     describe the loop yet (outside RL-B's owned paths);
   - the web (RL-D) still shows the legacy "Pre-approved actions" switches; the server keeps the
     legacy `allowlist` field in requests and setups;
   - a change reviewer that submitted but has not ended still holds a slot (RL-A note).
8. **Next recommended task:** RL-D (web) against the endpoints above, then RL-V (one consented
   real run).
