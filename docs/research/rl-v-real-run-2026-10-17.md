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
