# Phase 4 status (coordinator-maintained)

> Only the coordinator edits this file, when a WP is merged or a wave starts. Agents record their
> progress in `docs/phase-4/wp/<WP>.md` (README §9).

| WP   | Title                                                        | Depends           | Status                               | Branch                  | Merged                 |
| ---- | ------------------------------------------------------------ | ----------------- | ------------------------------------ | ----------------------- | ---------------------- |
| P4-0 | [Contracts, ADRs and core logic](wp/P4-0.md)                 | owner approval    | **done**                             | `wp/p4-0-contracts`     | 2026-10-13 (`8c05f68`) |
| P4-A | [Engine: plan phase, limits, depth 2, allowlist](wp/P4-A.md) | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-a-engine`        | —                      |
| P4-B | [Database: migration 0003 and repositories](wp/P4-B.md)      | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-b-db`            | —                      |
| P4-C | [Harness: manifest, context files, check runner](wp/P4-C.md) | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-c-harness`       | —                      |
| P4-I | [Adapter: context, nested helpers, submit_plan](wp/P4-I.md)  | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-i-adapter`       | —                      |
| P4-E | [Board UI](wp/P4-E.md)                                       | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-e-board`         | —                      |
| P4-F | [Project wizard and settings UI](wp/P4-F.md)                 | P4-0              | **in-progress** (claimed 2026-10-13) | `wp/p4-f-project-setup` | —                      |
| P4-D | [Server wiring](wp/P4-D.md)                                  | P4-A, B, C, I     | todo                                 | `wp/p4-d-server`        | —                      |
| P4-G | [Ticket page UI](wp/P4-G.md)                                 | P4-0 (DTOs); P4-D | todo                                 | `wp/p4-g-ticket`        | —                      |
| P4-H | [Verification](wp/P4-H.md)                                   | P4-D, E, F, G     | todo                                 | `wp/p4-h-verify`        | —                      |

## Live state (updated by the coordinator; check git, it is the source of truth)

As of 2026-10-13, wave 1 is running. Each WP has a claimed branch with at least one commit. Its
progress file on that branch has the checklist and the work log:

| WP   | Branch                  | Agent worktree (on this machine)            |
| ---- | ----------------------- | ------------------------------------------- |
| P4-A | `wp/p4-a-engine`        | `.claude/worktrees/agent-aadedb2e54083ed00` |
| P4-B | `wp/p4-b-db`            | `.claude/worktrees/agent-a93d92cfb93ab024e` |
| P4-C | `wp/p4-c-harness`       | `.claude/worktrees/agent-af2170bc2d71f7983` |
| P4-I | `wp/p4-i-adapter`       | `.claude/worktrees/agent-ad8e1d92d1180bee1` |
| P4-E | `wp/p4-e-board`         | `.claude/worktrees/agent-ab7af18ed08042ce4` |
| P4-F | `wp/p4-f-project-setup` | `.claude/worktrees/agent-a9d7d236a63ab508e` |

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
