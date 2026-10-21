# WG-F3: Checks stopped by a shutdown count as not run

> Progress file for WG-F3. Only the agent working on WG-F3 edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: finding F3 in `docs/workflow-graph/wp/WG-V.md` (present since v0.1.0).

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | review                                           |
| Owner   | WG-F3 agent (Claude Code)                        |
| Branch  | `wp/wg-f3-stopped-checks` (from `release/0.2.0`) |
| Started | 2026-10-21                                       |
| Updated | 2026-10-21                                       |

## Tasks

- [x] 1. Store a check the app's shutdown stops as its own status, not `error`
- [x] 2. The commit merge gate (owner's ticket-branch merge, lead's `merge_change`) counts it as
      not run and starts the checks again; real failures still block
- [x] 3. Rows from before the fix (v0.1.0's shutdown notes) count as not run too
- [x] 4. A change whose checks were running at the shutdown is not stuck "running" after a restart
- [x] 5. The web shows "Stopped … run again", not "Couldn't run" or a failure
- [x] 6. Tests (core, runner, engine, board, web, real-composition restart), `pnpm check`, full web
      e2e, status `review`

## Work log (append-only; newest last)

| Date       | What was done                                                      | Commit | Checks                    |
| ---------- | ------------------------------------------------------------------ | ------ | ------------------------- |
| 2026-10-21 | `interrupted` status, gates, engine restart reset, web, tests, doc | (this) | see the completion report |

## Decisions and findings

- **The cause.** `ChecksService.close()` (server shutdown) and `abortRun` (the run was stopped)
  aborted the same `AbortController`, and the runner stored both as `error` ("Stopped before it
  finished: the checks were stopped.") and the checks after it as `skipped`. `gateForCommit` fails
  closed on any non-pass, so after a restart the owner's merge answered `checks_failed` and the
  lead's `merge_change` "Required checks failed".
- **A stored signal, no migration.** `CheckRunStatusSchema` gains `interrupted`. `check_runs.status`
  is plain `TEXT NOT NULL` (0003) with no SQL `CHECK`, and the repository validates it with the Zod
  enum, so no migration is needed (ADR-0023: 0.2.0 has none). `close()` aborts with a
  `ChecksShutdown` reason (`harness/runner.ts`); the runner stores the stopped check **and** the
  ones it then does not start as `interrupted`. Any other abort (a stopped run) keeps `error` and
  `skipped`, which still block, now with their own notes ("the run was stopped").
- **One rule, in core.** `checkRunWasInterrupted(run)` (`packages/core/src/workspace/workspace.ts`)
  is true for `interrupted`, or for a legacy row: status `error` or `skipped` whose output ends with
  the exact v0.1.0 note as the runner's last line (`LEGACY_STOPPED_CHECK_NOTES`). Before WG-F3 a
  stopped run wrote the same notes, so a legacy row of a stopped run counts as not run too. That is
  harmless: a stopped run's ticket branch can only be discarded, and a rerun is a real result. New
  rows of a stopped run carry the new notes, so the legacy match covers old rows only.
- **The gates.** `gateForCommit` (`board/checks.ts`) lists such a check under `missing`, not
  `failedRequired`. The existing paths then do the rest: the ticket-branch merge starts the tip's
  checks and answers 409 `checks_running`; `merge_change` starts them and replies "checks are
  running … you will get a message". A failure, an error, a time-out or a skip blocks as before.
- **The engine after a restart.** A change whose checks were running when the app stopped kept
  `change.checks = 'pending'`; the shutdown suppresses the result callback, so every later merge was
  refused "still running" with nothing running. `recoverAfterRestart` (orchestrator) now resets
  `pending` to `null` (not run yet); `failed` and `passed` stay.
- **The legacy gate is unchanged.** Runs from before ADR-0021 use `gate()` (per-agent checks), which
  has no "not run yet" path: an `interrupted` required check blocks there, as `error` did; the owner
  runs the checks again from the ticket page or merges anyway. The web's legacy `mergeGate` counts
  it as failing too, so the page and the server agree.
- **UI (minimum).** `CHECK_STATUS_COPY.interrupted` ("Stopped": "The app stopped before this check
  finished, so it has no result. The checks run again before a merge."); `CheckStatus` shows a
  legacy shutdown row the same way. `checksSummary` gains kind `stopped`: the change card reads
  "Checks stopped when the app stopped; they run again", and the ticket-branch card keeps "Merge
  into main" (no "Merge anyway") with a note that the checks run again on merge.

## Tests

- core `workspace-contracts`: the status exists; exact legacy notes match, nothing else does.
- server `harness/runner`: a shutdown abort stores `interrupted` (running and not started); a run
  abort still stores `error` and `skipped`.
- orchestrator `review-loop-lifecycle`: restart turns `pending` into `null`; `failed` stays.
- server `board/stopped-checks`: the commit gate (three stopped forms are missing; five real
  non-passes fail); the owner's merge with an `interrupted` or legacy tip row → 409
  `checks_running`, rerun, 200; a real tip failure → `checks_failed`; `merge_change` with a stopped
  change row → "running", rerun, merged; a time-out → "Required checks failed".
- server `verification/review-loop/stopped-checks` (real `startServer`): the tip's check hangs at
  REVIEW, the server is closed mid-check, restarted over the same data; the tip shows
  `interrupted`; the owner's merge gives 409 `checks_running`, then 200; the ticket is Done. With
  the gate change reverted, it fails with `checks_failed` (checked).
- web `review-loop-ticket`, `ticket-logic`: the stopped tip row reads "Stopped", Merge stays,
  no "Merge anyway"; `checksSummary` kinds; the legacy `mergeGate` blocks `interrupted`.
