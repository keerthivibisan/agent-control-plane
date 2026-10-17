# Review loop (RL series) — status

Coordinator-owned. Plan: [README.md](README.md). Branches `wp/rl-<id>-<slug>` come off
`feature/ui-refresh` (the 0.1.0 line) and are merged back with `--ff-only` after review.

| WP   | Title                                                    | After      | Status                                           | Branch           | Merged    |
| ---- | -------------------------------------------------------- | ---------- | ------------------------------------------------ | ---------------- | --------- |
| RL-0 | ADR-0021, core contract (additive), migration 0006       | —          | **done**                                         | wp/rl-0-contract | `3a46106` |
| RL-A | Engine: review loop, rework, handover, plan-role fix     | RL-0       | **done**                                         | wp/rl-a-engine   | `0a50962` |
| RL-B | Server, db, git and adapter: ticket branch, gate modes   | RL-0, RL-A | **done**                                         | wp/rl-b-server   | `a33fac5` |
| RL-D | Web: approvals editor, Start dialog, change cards, merge | RL-0, U-V  | **done**                                         | wp/rl-d-web      | `b31d1ec` |
| RL-V | Verification and one consented real run                  | all        | automatic part **done**; real run awaits consent | wp/rl-v-verify   | `e689a79` |

## Owner decisions (2026-10-17)

- **Modes:** Manual, Auto edits (the default for new projects only), Auto. The lead never
  approves tool requests.
- **Review:** a review agent reviews each change by default (the lead can be chosen instead).
  The lead merges into the ticket branch or asks for rework (2 rounds by default). The owner
  merges the ticket branch into `main` once.
- **Stored text:** reviewer findings and the lead's rework and discard notes are kept as ticket
  comments.
- **Release:** built on `feature/ui-refresh`, in 0.1.0.
- **Coordinator defaults:**
  - Manual also asks before harness checks;
  - in the command allowlist, `git` is limited to read-only subcommands, while an `npm` or `mvn`
    prefix allows any arguments.

## Log

- 2026-10-17 planner fix (`64b54fd`): plan steps go to helpers; a step for the lead or the planner
  is refused.
- 2026-10-17 RL-0 merged (`3a46106`): the additive core contract, migration 0006 and ADR-0021.
  - Coordinator change: the legacy approvals mapping never widens a setup. Edits only maps to
    `manual`; only edits and checks together map to `auto-edits`.
  - ADR-0021 accepted on the owner's decisions.
  - Coordinator check: 2,292 tests.
- 2026-10-17 RL-A and RL-B started in parallel. RL-B codes against the RL-0 signatures and rebases
  after RL-A.
- Note: the owner's running dev server has not restarted, so migration 0006 has not been applied
  to the live database yet. It applies on the next start from this branch.
- 2026-10-17 U-V merged (the UI refresh is complete). RL-D (web) started against the contract with
  fixtures. RL-B also gets U-V's server finding: serialize git operations per worktree in
  `WorkspaceManager`.
- 2026-10-17 **RL-A merged** (`0a50962`).
  - The pure engine implements README §5.
  - A legacy snapshot recorded before the change still passes unchanged.
  - The coordinator ran pnpm check (2,377 tests) and read `matchCommandAllowlist` and
    `ruleAllowedByMode`: the whole command is safe tokens only, the first word is bare and not
    forbidden, `git` is read-only with no forbidden options, and a pattern must match word for
    word; anything else asks.
  - Proposed contract follow-up: promote `Refusal.reason` to `RefusalCode`s once RL-B maps them in
    `REFUSAL_STATUS`.
  - Gaps: no engine command for a failed ticket-branch creation (the server should `cancelRun`);
    `docs/orchestration-lifecycle.md` needs an update.
- 2026-10-17 **RL-D merged** (`b31d1ec`).
  - Built against fixtures. The coordinator ran pnpm check (2,451 tests) and the e2e (59/59).
  - The approvals editor refuses `make lint; rm -rf .` inline.
  - Start stays one click; "Start with options…" is opt-in.
  - Contract proposals for later: fix the `POST /runs/:id/ticket-branch` response body; add the
    snapshotted reviewer and max rounds to `RunDetailDto`; make `allowlist` optional in
    `UpdateProjectSetupRequest`.
- 2026-10-17 **RL-B review:** pnpm check passes (2,430 tests), and the git and route safety were
  read and confirmed: argv only, CSRF on POST, the final merge needs a clean tree, the base
  branch, the reviewed tip, an unmoved base and `--ff-only`, and the ref advance is a CAS
  `update-ref`.
  - **The e2e found a real race:** `create-ticket-branch` runs in the background while the plan
    approval reaches the lead at once, so the lead's first `start_agent` gets
    `ticket-branch-pending`.
  - Sent back to RL-B: the lead learns of the approval only after the branch exists. Then rebase
    on RL-D and run the full e2e against the real server.
- 2026-10-17 **RL-B merged** (`a33fac5`).
  - The race is fixed: effects after `create-ticket-branch` in the same batch wait for
    `ticketBranchCreated`. A regression test on the real server composition fails without the
    fix.
  - Per-worktree and per-repository git locks.
  - The coordinator ran pnpm check (2,506 tests) and the e2e (59/59).
  - **Gap for RL-V:** the workspace e2e server runs legacy runs by default (`ACP_E2E_REVIEW_LOOP=1`
    switches to the loop), so no browser e2e drives the loop against the real server yet.
- 2026-10-17 **RL-V automatic part merged** (`e689a79`).
  - A live browser e2e drives the whole loop on the real server: plan, two helpers, review,
    rework, the lead's merges, an owner override, the final code review, the ticket-branch card,
    Merge into main and Done.
  - It found a real bug (the lead's note overwrote the reviewer's findings), now fixed.
  - Refusal reasons are now `RefusalCode`s.
  - `RunDetailDto.reviewer` and `maxReworkRounds`; the legacy `allowlist` is optional.
  - Docs and CHANGELOG updated.
  - The coordinator ran pnpm check (2,516 tests) and the e2e (60/60).
  - The guarded real-run driver is in `packages/server/tests/verification/review-loop/real-run/drive.ts`.
- 2026-10-17 the owner's app was restarted on the new code: backed up first, then migration 0006
  was applied to the live database (the backup is in `~/.agent-control-plane/backups/`). The
  owner's review-stage skill mapping works now.
- 2026-10-17 **real run 1 (owner consent) failed after 30 minutes and found two bugs**
  (`docs/research/rl-v-real-run-2026-10-17.md`):
  - A: a new file in a new folder always asked under Auto edits;
  - B: the lead never handed over.
- **RL-F merged** (`3f529a4`).
  - `resolveEditTarget` resolves the nearest existing ancestor and appends plain segments only.
    The coordinator read it.
  - One engine message tells the lead to hand over when every change is decided and nothing is
    working, and the lead's brief states the duty.
  - The coordinator ran pnpm check (2,529 tests) and the e2e (60/60).
  - The second consented real run is next.
