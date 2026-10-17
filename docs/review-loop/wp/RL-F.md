# RL-F — Two fixes found by the consented real run

> Progress file for RL-F. Only the agent working on RL-F edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: the coordinator's brief (2026-10-17), from the RL-V real run (Auto edits mode, throwaway
> repository with only `README.md` and `check.mjs`).

| Field   | Value                                                 |
| ------- | ----------------------------------------------------- |
| Status  | review                                                |
| Owner   | agent (RL-F)                                          |
| Branch  | `wp/rl-f-fixes` (from `feature/ui-refresh` `57ab978`) |
| Started | 2026-10-17                                            |
| Updated | 2026-10-17                                            |

## Tasks

- [x] A. A new file in a new folder inside the helper's worktree is auto-approved (nearest
      existing ancestor, `packages/server/src/control/allowlist.ts`)
- [x] B. The engine tells the lead once to hand over when every change is decided and nothing
      is live; the lead's brief and `request_review` say it must hand over

## Work log (append-only; newest last)

| Date       | What was done                                            | Commit    | Checks                                               |
| ---------- | -------------------------------------------------------- | --------- | ---------------------------------------------------- |
| 2026-10-17 | Bug A: resolve new paths through the nearest ancestor    | `28ccab2` | format ✓ lint ✓ typecheck ✓ test 2520/2520 ✓ build ✓ |
| 2026-10-17 | Bug B: one hand-over prompt to the lead at an idle point | `60c5d91` | format ✓ lint ✓ typecheck ✓ test 2529/2529 ✓ build ✓ |
| 2026-10-17 | Rebased on `57ab978`; full e2e; to review                | (this)    | check ✓ test 2529/2529 ✓; e2e 60/60 ✓                |

## Decisions and findings

1. **Bug A.** `resolveEditTarget` walks up to the nearest path that exists and appends the
   segments still to be created. Each must be a plain name (not empty, `.` or `..`): their meaning
   would depend on folders that do not exist. The input is not normalized lexically first, so
   `link/..` means what the OS makes of it. Something that exists but cannot be resolved (a
   dangling symlink, a loop, no permission) asks: writing through a dangling symlink creates its
   target wherever it points, which the old code allowed for a dangling link at the file itself.
   The engine's checks (inside the worktree, not under `.git`/`.claude`) are unchanged.
2. **Bug B.** `promptHandover` (`packages/orchestrator/src/loop.ts`) runs in `Draft.reconcile` for
   loop runs. At an idle point (not handed over, run RUNNING or BLOCKED, at least one change, every
   change final, no agent but the lead active) it sends the lead one `send-to-agent` message with
   the counts, saying plainly when nothing was merged. `RunState.handoverPrompted` (engine state,
   in memory only like `leadBrief` and `followUp`; not in the run snapshot, whose parser rejects
   unknown keys) remembers that the point was announced; it clears when any agent but the lead is
   active or a change is undecided. A BLOCKED lead is not told (a message would start a turn past
   its budget); it is told after the raise. The owner's "Request changes" marks it as told, since
   the owner's message already says what to do. No server or adapter wiring was needed: the
   existing `send-to-agent` effect delivers it (asserted in
   `packages/server/tests/board/review-loop.test.ts`). The lead's post-approval brief and the
   `request_review` tool description now say it must hand over once every change is decided; the
   legacy (no loop) brief is unchanged.

## Follow-ups (not in RL-F's paths)

1. `packages/server/README.md` still says the allowlist is "Not active yet" (the managed adapter's
   `PermissionRequest` carrying no tool input); the real run and the tests show it is active. A
   docs fix for the coordinator.
2. The second consented real run (owner's consent in chat) checks both fixes on real agents.
