# Review-loop real run — 2026-10-17 (failed: two bugs found)

With the owner's consent in chat, one real run of the review loop (ADR-0021) used the guarded
driver `packages/server/tests/verification/review-loop/real-run/drive.ts` (`ACP_REAL_RUN=1`):

- a throwaway repo (README plus a `node check.mjs` harness);
- a separate in-process server, a temp data dir and an empty temp `ACP_CLAUDE_DIR`;
- Auto edits, two helpers, a review agent with at most 2 rework rounds, and the final code review
  on.

Aggregates only.

## Result

The run **did not complete**: it hit the driver's 30-minute limit and was stopped (run
`CANCELLED`).

- **Ticket branch:** `acp/RLV-1` was created at plan approval. It stayed `open`, at its base
  commit.
- **Lead:** read-only base set `Read, Grep, Glob` plus its control tools. It used `submit_plan` 1,
  `start_agent` 3, `agent_status` 3, `view_change` 1, `request_rework` 1, `discard_change` 1 and
  `ask_owner` 1. It never called `request_review`.
- **Helpers:**
  - three helper sessions ("Slugify module", "CLI script" ×2) with base set
    `Read, Grep, Glob, Edit, Write, Bash`;
  - all finished `SUCCEEDED` with **no changes** within the first minute;
  - their gate counts were `Write:deny` 2, 1 and 1, and `Bash:deny` 1.
- **Approvals:** 5 `tool-use` approvals, all asked, then denied by the driver (it refuses whatever
  still asks): Write `bin/slug.mjs` (×2), Write `src/slug.mjs`, Write `test/slug.test.mjs`, and
  Bash `node`. None was decided by the allowlist.
- **Database:** no `change_reviews` rows. The three workspaces were released as `no-changes`.

## Findings

1. **Bug A: a new file in a new folder always asks.**
   - `resolveEditTarget` (server/control/allowlist.ts) resolves a missing file only when its parent
     folder exists.
   - Every Write here created a file under a folder that did not exist yet (`src/`, `bin/`,
     `test/`), so the Auto edits rule never applied.
   - This is very common in real use. **Fix (RL-F):** resolve the nearest existing ancestor and
     append the remaining segments, still requiring the result to be inside the agent's own
     worktree.
2. **Bug B: the lead never hands over.**
   - After every change was final (all `no-changes`) and no helper was live, the lead ended its
     turn and waited about 29 minutes; the engine never prompted it to call `request_review`.
   - **Fix (RL-F):** one engine message at that idle point, plus the duty stated in the lead's
     brief.
3. **Working as designed:** the refused `Bash node`. Auto edits auto-runs only the exact harness
   check (`node check.mjs`).
4. **Why the tests missed both:** the scripted fake agents write only into existing folders and
   always hand over.

A second consented run follows after RL-F.

## Second run after RL-F (2026-10-17, owner consent): passed

Same driver and setup, on `feature/ui-refresh` `57387c1`.

- **Run:** `COMPLETED`, ticket `DONE`. Stages: plan, orchestrate, helpers, review and code-review
  all `done` (unit tests were off). No nudge.
- **Plan:** 2 steps, both for helper roles ("Module builder", "CLI builder"); no step for the lead.
- **Changes:** each change was reviewed by a review agent; the verdict was `approve`, and the lead
  merged it into `acp/RLV-1`.
  - "Module builder": 2 files, checks passed, 0 rework rounds.
  - "CLI builder": 2 files, checks passed, 0 rework rounds.

  No rework was needed this time, so the rework path was verified by the e2e tests, not live.

- **Handover:** the lead called `request_review` itself. The final code review ran on the ticket
  branch.
- **Final merge:** the owner's merge through the API succeeded. `main` is at the merged commit, the
  ticket branch was deleted, there were 2 tip moves, and the tip held 3 files.
- **Approvals (Auto edits):**
  - 5 edits auto-approved by `edit-in-own-worktree`, including new files in new folders, which
    confirms Bug A is fixed;
  - 1 harness check auto-approved by `run-harness-check`;
  - 2 other Bash commands asked and were denied, as designed.
- **Tools (`system/init`):**

  | Agent            | Tools                                              |
  | ---------------- | -------------------------------------------------- |
  | lead             | `Glob, Grep, Read` plus its control tools          |
  | helpers          | `Bash, Edit, Glob, Grep, Read, Write`              |
  | change reviewers | `Glob, Grep, Read, Skill, mcp__acp__submit_review` |
  | final reviewer   | `Glob, Grep, Read, mcp__acp__post_review`          |

  The change reviewers' review skill loaded.

- **Budget tokens:**

  | Agent     | Budget tokens (of 80k) |
  | --------- | ---------------------- |
  | lead      | 18.8k                  |
  | helpers   | 5.0k and 5.7k          |
  | reviewers | 9.1k, 4.6k and 11.2k   |

  About 54k in total.

- **Content:** 71 log lines with no plan summary, comment text or diff line; no diff line in the
  database (21 diff lines checked).

## Third run: Full auto after RL-G and RL-H (2026-10-17, owner consent): passed

The same driver with `ACP_REAL_RUN_MODE=full-auto`, on `feature/ui-refresh` `4242ce4`.

- **Every Full auto assertion was true:** no owner approvals, the plan approved automatically,
  helpers started, helpers asked for auto mode and the sandbox, helpers reported auto mode, the
  other roles stayed default, no protection failures, the final merge reached.
- **Counts:** the owner was asked 0 times, the plan never waited for the owner, 0 requests were
  denied without asking, and 0 were denied by the classifier.
- **Permission modes** (`system/init`):
  - helpers: `permissionMode: auto`, with the sandbox requested;
  - lead, change reviewers and final reviewer: `default`, with no sandbox.
- **Run:** `COMPLETED`, ticket `DONE`. Plan, orchestrate, helpers, review and code-review were all
  `done`; there was no nudge. Two changes were approved by review agents and merged by the lead
  into `acp/RLV-1` (2 files each, checks passed, 0 rework rounds). The owner's final merge put
  `main` at the merged commit, and the branch was deleted.
- **Budget tokens:**

  | Agent     | Budget tokens (of 80k) |
  | --------- | ---------------------- |
  | lead      | 18.2k                  |
  | helpers   | 13.7k and 8.4k         |
  | reviewers | 9.3k, 4.3k and 11.3k   |

  About 65k in total; auto-mode classifier calls are not included.

- **Content:**
  - No plan summary, comment or diff line appeared in the 60 log lines.
  - The driver's "diff line in the database" flag was true. The matching lines were in
    `ticket_plans.steps` and `agent_runs.task`: the planner put short code snippets in the plan,
    and the lead passed them on in the helpers' tasks.
  - Plans and tasks are stored by design (ADR-0015, ADR-0016); no diff or tool output was stored.
  - Follow-up: the driver should exclude plan and task text from that check.
