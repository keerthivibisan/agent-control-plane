# RL-F — Two fixes found by the consented real run

> Progress file for RL-F. Only the agent working on RL-F edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: the coordinator's brief (2026-10-17), from the RL-V real run (Auto edits mode, throwaway
> repository with only `README.md` and `check.mjs`).

| Field   | Value                                                 |
| ------- | ----------------------------------------------------- |
| Status  | in-progress                                           |
| Owner   | agent (RL-F)                                          |
| Branch  | `wp/rl-f-fixes` (from `feature/ui-refresh` `fa58c87`) |
| Started | 2026-10-17                                            |
| Updated | 2026-10-17                                            |

## Tasks

- [x] A. A new file in a new folder inside the helper's worktree is auto-approved (nearest
      existing ancestor, `packages/server/src/control/allowlist.ts`)
- [ ] B. The engine tells the lead once to hand over when every change is decided and nothing
      is live; the lead's brief and `request_review` say it must hand over

## Work log (append-only; newest last)

| Date       | What was done                                         | Commit | Checks     |
| ---------- | ----------------------------------------------------- | ------ | ---------- |
| 2026-10-17 | Bug A: resolve new paths through the nearest ancestor | (this) | see commit |

## Decisions and findings

1. **Bug A.** `resolveEditTarget` walks up to the nearest path that exists and appends the
   segments still to be created. Each must be a plain name (not empty, `.` or `..`): their meaning
   would depend on folders that do not exist. The input is not normalized lexically first, so
   `link/..` means what the OS makes of it. Something that exists but cannot be resolved (a
   dangling symlink, a loop, no permission) asks: writing through a dangling symlink creates its
   target wherever it points, which the old code allowed for a dangling link at the file itself.
   The engine's checks (inside the worktree, not under `.git`/`.claude`) are unchanged.
