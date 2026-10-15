# Phase 4 status (coordinator-maintained)

> Only the coordinator edits this file, when a WP is merged or a wave starts. Agents record their
> progress in `docs/phase-4/wp/<WP>.md` (README §9).

| WP   | Title                                                        | Depends           | Status                               | Branch                  | Merged                 |
| ---- | ------------------------------------------------------------ | ----------------- | ------------------------------------ | ----------------------- | ---------------------- |
| P4-0 | [Contracts, ADRs and core logic](wp/P4-0.md)                 | owner approval    | **done**                             | `wp/p4-0-contracts`     | 2026-10-13 (`8c05f68`) |
| P4-A | [Engine: plan phase, limits, depth 2, allowlist](wp/P4-A.md) | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-a-engine`        | —                      |
| P4-B | [Database: migration 0003 and repositories](wp/P4-B.md)      | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-b-db`            | —                      |
| P4-C | [Harness: manifest, context files, check runner](wp/P4-C.md) | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-c-harness`       | —                      |
| P4-I | [Adapter: context, nested helpers, submit_plan](wp/P4-I.md)  | P4-0              | **done**                             | `wp/p4-i-adapter`       | 2026-10-15             |
| P4-E | [Board UI](wp/P4-E.md)                                       | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-e-board`         | —                      |
| P4-F | [Project wizard and settings UI](wp/P4-F.md)                 | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-f-project-setup` | —                      |
| P4-D | [Server wiring](wp/P4-D.md)                                  | P4-A, B, C, I     | todo                                 | `wp/p4-d-server`        | —                      |
| P4-G | [Ticket page UI](wp/P4-G.md)                                 | P4-0 (DTOs); P4-D | todo                                 | `wp/p4-g-ticket`        | —                      |
| P4-H | [Verification](wp/P4-H.md)                                   | P4-D, E, F, G     | todo                                 | `wp/p4-h-verify`        | —                      |

## Live state (2026-10-15; git is the source of truth)

All wave-1 work is **committed on its branch**. On 2026-10-15 the coordinator saved the interrupted
worktrees as `wip(...)` commits, so nothing lives only in a worktree. No wave-1 WP is merged yet.

| WP   | Branch                  | Head      | State                                                                                                                                      | What is left                                                                                                                             |
| ---- | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P4-I | `wp/p4-i-adapter`       | `e8d13dc` | **merged** 2026-10-15 (Claude Code system prompt always on)                                                                                | —                                                                                                                                        |
| P4-B | `wp/p4-b-db`            | `584682d` | migration 0003, repositories, runs `ticketId`, depth-2 agent runs written; workspace tests drafted (WIP)                                   | Finish the workspace tests and the 0002 → 0003 upgrade test, README section, `pnpm check`, progress file → review                        |
| P4-C | `wp/p4-c-harness`       | `df11548` | harness source written (manifest, context, output tail, runner, main checks); tests drafted (WIP)                                          | Finish the tests (temp git repos, no-shell assertion, timeouts, caps), `pnpm check`, progress file → review                              |
| P4-A | `wp/p4-a-engine`        | `130bab8` | plan phase, limits, tree, allowlist and tests drafted (WIP, not green); also edits `packages/server/src/control/errors.ts` (outside scope) | Make it green; justify or move the server edit (refusal codes mapping); finish every transition and refusal test; progress file → review |
| P4-E | `wp/p4-e-board`         | `816914a` | board pieces plus page, columns, stats, card and tests drafted (WIP)                                                                       | Wire and verify the page, tests, e2e (`ACP_E2E_PORT=7501`), screenshots, progress file → review                                          |
| P4-F | `wp/p4-f-project-setup` | `bd70d3c` | client, copy, routes, form logic, sections, wizard, settings, harness panel and tests drafted (WIP)                                        | Verify the wizard and settings, tests, e2e (`ACP_E2E_PORT=7511`), screenshots, progress file → review                                    |
| P4-D | `wp/p4-d-server`        | —         | not started                                                                                                                                | Starts after A, B, C and I are merged                                                                                                    |
| P4-G | `wp/p4-g-ticket`        | —         | not started                                                                                                                                | Can start now (needs only the P4-0 DTOs)                                                                                                 |
| P4-H | `wp/p4-h-verify`        | —         | not started                                                                                                                                | After D, E, F and G. The real smoke run needs the owner's consent                                                                        |

**Agent worktrees** (on this machine): P4-A `.claude/worktrees/agent-aadedb2e54083ed00`, P4-B
`…agent-a93d92cfb93ab024e`, P4-C `…agent-af2170bc2d71f7983`, P4-I `…agent-ad8e1d92d1180bee1`, P4-E
`…agent-ab7af18ed08042ce4`, P4-F `…agent-a9d7d236a63ab508e`. If one is gone, create a new worktree from
its branch.

**Decisions taken during review:**

- Managed agents always get Claude Code's own system prompt. Leaving it unset made SDK 0.3.296 send
  an empty one.
- **Open for P4-A/P4-D:** a parent helper that ends its turn finishes, and a later message to it
  fails. Either the engine keeps parents busy while they have children, or the adapter keeps their
  input open like the lead's.

**Known flaky test (pre-existing, not Phase 4):** `packages/server/tests/smoke.test.ts` "ingests a
registered project…" sometimes sees a subagent's parent as unknown under heavy load. It reads the
detail before the subagent's meta file batch is ingested; it failed 1 of 3 runs on `main`. Fix
(backlog): make the test wait for the edge, not just the session count.

**Environment note:** heavy machine load (Microsoft Defender, other projects' test runs) makes vitest
workers time out and the server suite flaky on timing. Rerun before treating a failure as real.

## If a session was interrupted: how to resume (any chat, any agent)

1. **Find what exists:**

   ```bash
   git branch --list 'wp/p4-*'                                   # claimed WPs
   git worktree list | grep wp/p4                                # where they are checked out
   for b in $(git branch --list 'wp/p4-*' --format='%(refname:short)'); do
     echo "$b: $(git log --oneline main..$b | wc -l) commits"; done
   ```

2. **Read a WP's real progress** on its branch, not on `main`:

   ```bash
   git show wp/p4-<id>-<slug>:docs/phase-4/wp/<WP>.md
   ```

3. **Rescue uncommitted work.** If the WP's worktree still exists, run `git -C <worktree> status`.
   Uncommitted changes there are the last agent's unfinished work. Have the new agent continue
   **in that worktree**: run `pnpm check`, then commit. Don't delete the worktree.
4. **Restart the agent with the WP prompt** (README §10.1), adding: "Your branch `wp/p4-…` already
   exists. Continue from it (worktree `<path>` if present). Read your progress file's work log
   first."
5. **When a WP's file says `review`:** the coordinator runs the review loop (README §10.2), merges,
   and updates this file.
6. **Never** create a second branch for a WP, and never restart a WP whose branch has commits.

**Current wave (2026-10-13):** wave 1 — P4-A, P4-B, P4-C, P4-I, P4-E, P4-F.

**Waves:** P4-0 → (P4-A, P4-B, P4-C, P4-I, P4-E, P4-F in parallel) → P4-D (+ P4-G from P4-0) → P4-H.
