# RL-V — Verification and integration polish for the review loop

> Progress file for RL-V. Only the agent working on RL-V edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: `docs/review-loop/README.md` §9 (RL-V) and the coordinator's brief (2026-10-17).

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Status  | review                                                 |
| Owner   | agent (RL-V)                                           |
| Branch  | `wp/rl-v-verify` (from `feature/ui-refresh` `cd75936`) |
| Started | 2026-10-17                                             |
| Updated | 2026-10-17                                             |

## Tasks

- [x] 1. Browser e2e of the loop against the real server (scripted fake agents)
- [x] 2. Integration polish: live graph reads the run's limit; Checks tab "Run again" for loop
      runs; additive contract (`RunDetailDto.reviewer`/`maxReworkRounds`, optional `allowlist`,
      ticket-branch POST response); refusal reasons promoted to codes
- [x] 3. Docs: orchestration lifecycle, architecture, README, CHANGELOG
- [x] 4. Real-run driver and plan (not executed; needs the owner's consent)

## Work log (append-only; newest last)

| Date       | What was done                                                          | Commit    | Checks                                                              |
| ---------- | ---------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| 2026-10-17 | Claimed RL-V                                                           | `c7c38d1` | docs                                                                |
| 2026-10-17 | Refusal reasons promoted to `RefusalCode`s                             | `d97f03c` | format ✓ lint ✓ typecheck ✓ test 2513/2513 ✓ build ✓                |
| 2026-10-17 | Contract: run reviewer/limit, optional allowlist, ticket-branch answer | `b348c53` | format ✓ lint ✓ typecheck ✓ test 2513/2513 ✓ build ✓                |
| 2026-10-17 | Fix (found by the e2e): findings and the lead's note on one round      | `3d682a6` | format ✓ lint ✓ typecheck ✓ test 2516/2516 ✓ build ✓                |
| 2026-10-17 | Browser e2e of the loop on the real server (`review-loop-live`)        | `ce7e821` | test 2516/2516 ✓; e2e `review-loop-live` 1/1 ✓                      |
| 2026-10-17 | Docs, CHANGELOG, real-run driver and plan                              | (this)    | format ✓ lint ✓ typecheck ✓ test 2516/2516 ✓ build ✓; e2e 60/60 × 2 |

## Decisions and findings

1. **Refusal codes (task 2):** the promotion was mechanical (25 call sites, one regex, reviewed),
   so it is done: the twelve review-loop reasons are `RefusalCode`s, `Refusal.reason`,
   `REFUSAL_REASONS` and `RefusalReason` are gone, and `REFUSAL_STATUS` keeps each one's old
   status (404 `change-not-found`, 409 for the rest). The HTTP error codes are the same strings the
   server already sent.
2. **Optional `allowlist`:** the web no longer sends it with `approvals`. Runs from before ADR-0021
   still read the legacy allowlist live, so the server keeps it in step with the mode when only
   `approvals` arrive (Manual → both off; Auto edits/Auto → both on, which maps back to Auto
   edits), and keeps the stored one when neither arrives. Settings still sends the stored
   allowlist (it never sends approvals).
3. **"Run checks again" on loop runs:** the server already runs a loop change's checks on its
   sealed commit while the change is undecided (its worktree exists). The web now offers the
   button by the change itself (sealed, not merged/discarded/empty) rather than by the legacy
   review state, so it never shows for a merged change whose worktree is gone.
4. **Bug found by the e2e (fixed, `3d682a6`):** one `change_reviews` row links one comment. The
   lead's rework note replaced the review agent's findings on the round, so the change card lost
   the findings. A decider's note on a round that already links findings now gets its own row
   with the decision it explains; the card shows each text once. No migration.
5. **Observations from the e2e screenshots, not changed** (for the coordinator):
   - change reviewers are drawn as separate "Reviewer agent" cards under the lead, one per round
     (four cards in the flow); on a long run that list grows;
   - the lead's "Latest" line keeps its last action ("Asked the owner about …") after the run is
     Done.
6. **An owner's change merge while the tip moved** answers `checks_running` (the integrated commit
   is new, its checks start) and the owner clicks Merge again once they pass. The e2e avoids it by
   starting the third helper after both merges; the behaviour is RL-B's documented gate.

## Real run plan (for the owner's consent; NOT executed)

**Driver:** `packages/server/tests/verification/review-loop/real-run/drive.ts`. Same guards as the
R-V driver: refuses without `ACP_REAL_RUN=1` and whenever `CI` is set (both checked: exit 2 without
starting anything); not a `*.test.ts`, so `pnpm test` never runs it. Run from `packages/server`:

```bash
ACP_REAL_RUN=1 node --conditions=development --import tsx \
  tests/verification/review-loop/real-run/drive.ts
```

**What runs:**

- A throwaway repository in a temp folder, with a synthetic harness committed on `main`: one
  required check, `node check.mjs`, which runs the repo's `test/*.test.mjs` with `node --test`
  (and passes when there are none).
- A separate in-process server on an ephemeral `127.0.0.1` port (never 7420/5173), live mode,
  managed agents on, a temp data dir and an **empty** temp `ACP_CLAUDE_DIR` (the real `~/.claude`
  is never read). The owner's running app is not touched.
- Project setup through the routes: Auto edits (sent without the legacy allowlist), 2 helpers,
  80,000 budget tokens per agent. Review stage: a review agent, at most 2 rework rounds, and a
  committed review skill that approves a change only if each new module has a `node:test` file.
  Final code review on; unit tests off; the lead plans.
- One ticket written for two helpers (`src/slug.mjs` and `bin/slug.mjs`), started with
  `{ approvalMode: 'auto-edits', reviewer: 'agent', maxReworkRounds: 2 }`. The ticket does not
  mention tests, so a first-round rework is likely (not forced).
- The driver approves the plan, **denies** every request that still asks (no human clicks;
  counted), decides a change the lead hands to the owner (merge when its checks passed, else
  discard), and once the run is in REVIEW performs the owner's final merge of the ticket branch
  through `POST /api/runs/:id/ticket-branch` (retrying while the tip's checks run; a failed check
  or a moved base is recorded and left for the owner).
- Nudge-free: it never messages the lead unless `ACP_REAL_RUN_NUDGE=1` (then at most once, after 4
  idle minutes); a stall shows in the summary.

**What it records (aggregates only; never prompt, reply, thinking, finding, diff or tool input
text):** per agent start the role kind, review scope (`change`/`final`), rework flag, SDK tool
lists, skills, whether `resume` is set and the model; each `system/init`'s tool and skill names
(so the change reviewer's tool list is checked); results' subtype, error flag and reported cost
(estimated, never summed); the real gate's (role, tool, outcome) counts; approvals as (role,
decided by, rule, status) counts — auto vs asked with the rule; each change's state, rework rounds
and rounds as (reviewer, verdict, decision, decided by); the owner's decisions and denied requests;
the ticket branch's states seen, tip moves, final merge result, `main` at the merged commit and the
branch deleted; the run's snapshotted mode, reviewer and limit; budgets per agent; and booleans:
plan summary, comment text or a diff line in the server log, a diff line in the database. Output:
stdout and `<data dir>/real-run-summary.json`.

**Expected cost and time** (from the R-V runs: planner/lead ~27–29k, worker ~26k, reviewer ~6k
budget tokens each):

| Agent                                         | Budget tokens (estimate)      |
| --------------------------------------------- | ----------------------------- |
| lead (plans, starts 2 helpers, 3–4 decisions) | 40–60k                        |
| 2 helpers (+1 rework turn)                    | 50–70k                        |
| change reviewers (3–4 rounds)                 | 20–30k                        |
| final code reviewer                           | 6–10k                         |
| **total**                                     | **~120–170k** (cap: 80k each) |

Reported cost about $1–3 (estimated). Wall time 10–20 minutes; hard limit 30 minutes
(`ACP_REAL_RUN_LIMIT_MS`).

**Stop and cleanup:** Ctrl-C or the time limit posts Stop all for the run and closes the server.
Temp folders (repo, data dir, empty Claude dir) are kept for inspection, or removed with
`ACP_REAL_RUN_CLEANUP=1`. Nothing outside the temp folders is written.

**Pass criteria:** run `COMPLETED`, ticket `DONE`; two helper changes merged into `acp/RLV-1` by
the lead (any rework recorded in rounds ≤ 2); every helper edit in its own worktree and the exact
check auto-approved with its rule; the change reviewer's `init` tools read-only plus
`submit_review`; one final fast-forward merge with `main` at the merged commit and the branch
deleted; no nudge; all content booleans false.

## Completion report (AGENTS.md §9)

## Completion report — RL-V

1. **Summary:** a browser e2e of the whole review loop on the real server (and a real bug it
   found, fixed), the coordinator-approved additive contract with its server and web use, the
   refusal reasons promoted to codes, docs and CHANGELOG, and a guarded real-run driver with a plan
   for the owner's consent (not executed).
2. **Files changed:**
   - created: `packages/web/e2e/review-loop-live.spec.ts`,
     `packages/server/tests/verification/review-loop/real-run/drive.ts`, this file's content;
   - modified (core): `src/api/{orchestration,workspace}.ts`, `tests/review-loop-contracts.test.ts`;
   - modified (orchestrator): `src/{errors,change-commands,commands,lead-tools,loop,policy}.ts`,
     `tests/review-loop{,-lifecycle}.test.ts`;
   - modified (server): `src/board/{service,setup}.ts`, `src/control/{errors,service,store}.ts`,
     `tests/board/{approvals-setup,review-loop,review-loop-more}.test.ts`,
     `tests/control/units.test.ts`, `tests/verification/redesign/e2e-server.ts`;
   - modified (web): `src/lib/api.ts`, `src/features/review-loop/{logic.ts,ChangeCard.tsx}`,
     `src/features/ticket/{LiveWorkflow,SidePanel}.tsx`, `src/features/workflow/draft.ts`,
     `src/features/project-setup/NewProjectWizard.tsx`, `e2e/{playwright.config,review-loop.spec}.ts`,
     `tests/features/{review-loop-ticket,review-loop-workflow,workflow,project-setup}.test.tsx`;
   - docs: `docs/orchestration-lifecycle.md` (§0.1), `docs/architecture.md` (§8), `README.md`
     (Status), `CHANGELOG.md` (`[Unreleased]`).
3. **Commands run and actual results** (Node 22.21.1, pnpm 10.26.1): see the work log; final
   `pnpm check` and the full e2e (twice) are in the last row and the handback report.
4. **Acceptance criteria:**
   - browser e2e of the owner flow on the real server, with every step of the brief (plan,
     approve, two helpers, approve one / rework the other, lead merges both, handover, final review
     on, ticket-branch card with combined diff and checks, Merge into main, Done; file on main,
     branch deleted, change cards and live graph states, no chat/diff text in the log; an
     auto-approval with its rule; an owner override on a `needs-owner` change) → met
     (`review-loop-live.spec.ts`);
   - live graph reads the run's own limit and reviewer, falling back to the old guess → met;
   - "Run again" aligned with the server for loop runs → met;
   - contract: `reviewer`/`maxReworkRounds` on `RunDetailDto`, optional `allowlist` (web stops
     sending it with approvals, server keeps accepting), ticket-branch POST answer → met;
   - refusal reasons as real codes with `REFUSAL_STATUS` entries → met (mechanical);
   - docs and CHANGELOG (only what is implemented and verified) → met;
   - guarded real-run driver and plan, not executed → met (guards checked: exit 2).
5. **Assumptions:** decisions 2, 3 and 4 above.
6. **Contract or shared-file changes:** only the coordinator-approved additive ones (task 2). No
   dependency, migration or shared config change.
7. **Known gaps / follow-ups:** the real run itself (owner consent); observations in decision 5;
   the owner's change merge after the tip moved needs a second click (decision 6).
8. **Next recommended task:** the consented real run with the driver above, then merge
   `feature/ui-refresh` for 0.1.0.
