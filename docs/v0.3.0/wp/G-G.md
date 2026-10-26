# G-G (with T-A)

> Progress file for G-G and T-A (one agent). Only its agent edits it. Plan:
> [../README.md](../README.md), Part 2; decision:
> [ADR-0025](../../decisions/0025-code-hosting-and-branching.md) §9 (merge and delete), ADR-0014
> (cost is never summed). Owner, 2026-10-23: "we need branch delete option like merge and delete";
> "a badge in ticket like how much time it took to complete and how much total tokens used ...
> keep in the image right corner"; "leave cost for now".

| Field  | Value                                                                       |
| ------ | --------------------------------------------------------------------------- |
| Status | review                                                                      |
| Branch | wp/g-g-2 (continues wp/g-g-merge-totals, paused by the owner on 2026-10-24) |

## Tasks

- [x] T1 Db: `TokenQueries.ticketTokens(projectId, ticketId)`, the Tokens page's `byTicket` cells
      for one ticket, all time (additive, no migration).
- [x] G1 Server: `POST /api/tickets/:id/branch/pull-request/merge` (CSRF,
      `MergePullRequestRequest`): `CodeHostService.mergePullRequest`, `board/ticket-branch-actions.ts`.
- [x] G2 Server: `POST /api/tickets/:id/branch/delete` (CSRF, `{}`):
      `code-host/ticket-branch.ts` (`createTicketBranchGit`), the board service.
- [x] G3 Server: `localExists` and `pullRequest.headOnOrigin` on the merge, delete, push and
      refresh answers and on `GET /api/runs/:id/ticket-branch` (`withPresence`).
- [x] T2 Server: `GET /api/tickets/:id/totals` → `TicketTotalsDto` (`board/ticket-totals.ts`,
      `createTicketTokens`).
- [x] G4 Server tests: `tests/code-host/merge-delete.test.ts` (20), `tests/board/merge-delete.test.ts`
      (6), `tests/board/ticket-totals.test.ts` (7); the fake gh learns `pr merge`.
- [x] G5 Web: `features/branching/MergeAndDelete.tsx` and `merge-branch.ts`,
      `review-loop/BranchFinalStep.tsx`, the header shortcut (`TicketHeader.tsx`), `lib/api.ts` and
      `lib/copy.ts` (additions only).
- [x] T3 Web: `features/ticket/TicketTotalsBadge.tsx` and `ticket-totals.ts`, on the header's
      state line.
- [x] G6 Web tests: `tests/features/merge-delete.test.tsx` (14), `tests/features/ticket-totals.test.tsx`
      (11), one assertion of `review-loop-ticket.test.tsx` updated; `e2e/github.spec.ts` (three
      new specs), `e2e/github-fixtures.ts` and `e2e/totals-fixtures.ts` (synthetic).
- [x] G7 Progress file, report.

## What the server runs

Every git call goes through the workspace runner (`execFile`, argument arrays, no shell,
`GIT_TERMINAL_PROMPT=0`, a time limit) with `SAFE_GIT_CONFIG` first (hooks off), in the project
root; gh goes through the CLI runner (`execFile`, `GH_PROMPT_DISABLED=1`, `GIT_TERMINAL_PROMPT=0`,
a time limit). Their output is only parsed (ref names, JSON); gh's and git's own words are never
answered or logged (codes and exit codes only).

**Merge pull request** (owner's click only):

1. `MergePullRequestRequestSchema` → else 400 `invalid_request`.
2. The current run's ticket branch must have an open pull request → else 409
   `no_open_pull_request`; the run must wait for the owner's merge (the engine's refusal
   otherwise); the pull request must have the branch's tip → else 409 `unpushed_commits`.
3. In the OS temp folder (never the checkout): `gh --version`, `gh auth status` → else 409
   `code_host_not_ready`.
4. `gh pr merge <n> --repo=<owner>/<name> --merge|--squash|--rebase [--delete-branch]`, 60 s.
   A failure is explained from `gh pr view <n> --json=state,isDraft,mergeable,mergeStateStatus`
   and `gh repo view --json=mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed`:
   `merge_method_not_allowed` (409), `pull_request_not_mergeable` (409: conflicts, required
   reviews or checks, behind, draft, closed; each its own sentence), `merge_failed` (502); a time
   out is 504 `timeout` ("… may or may not be merged now. Press Refresh to see."). Already merged
   (gh failed only at deleting the branch) is not a refusal.
5. The pull request is read again as Refresh does (the ticket becomes Done when merged).
6. With Delete branch and merged: `git branch -D <b>` unless the checkout (or another worktree)
   is on it; then `git ls-remote --heads origin refs/heads/<b>` for `headOnOrigin` (a stale
   `refs/remotes/origin/<b>` is removed when origin no longer has it).

**Delete branch** (owner's click only):

1. Merged here, merged on GitHub, or discarded → else 409 `branch_not_finished`.
2. Never the ticket's target or the strategy's base or default target → 409 `branch_protected`;
   never the checked-out branch → 409 `branch_checked_out` (also when another worktree has it).
3. With origin: `git ls-remote` first (unreadable → 409 `branch_delete_failed`, a time out 504
   `timeout`; nothing deleted); when listed, `git push --no-verify origin --delete
refs/heads/<b>` (refused → 409 `branch_delete_failed`, the project keeps its copy).
4. `git branch -D <b>` when it exists locally (failure → 409 `branch_delete_failed`, saying
   whether origin's copy is already gone).
5. Answers the ticket branch with what is left (`localExists`, `headOnOrigin`).

HEAD, the index and the files never change (tested with staged, unstaged and untracked changes).

**Totals**: `startedAt` is the first run's `created_at`; `finishedAt` only for a Done or
Cancelled ticket: no "done at" time is recorded, so it is the latest run end (the merge, here or
on GitHub, ends the run as the ticket becomes Done), else the ticket's last update; `elapsedMs`
uses the injected clock while open; each run's duration is null while it is live; `usage` and
`headline` are the Tokens page's `byTicket` row (nulls stay null). No cost.

## What the UI shows where

- **Final step box** (end of the Comments tab), while the pull request is open: under the note,
  Merge method (Create a merge commit / Squash and merge / Rebase and merge; the last choice is
  remembered per project in this browser, `acp.merge-method.<projectId>`, read and written in
  try/catch), the primary button named as GitHub names it, and "Delete branch" (ticked; "On
  GitHub and in the project folder, once it is merged."). The button asks first: "Merges #42 into
  main on GitHub as one squashed commit and deletes <branch> there and in the project folder. The
  ticket is done once GitHub reports it merged." with Confirm … / Cancel (Cancel focused). Busy:
  "Merging…". Off, with "Push the new commits first: GitHub would merge only what it has.", while
  the branch has commits the pull request lacks (Push new commits is beside it). A refusal is the
  app's sentence in a red alert with Technical details. When the folder is on the ticket branch,
  "<branch> is still in the project folder: it's checked out there, …".
- **Ticket header**: the final-step shortcut reads "Merge pull request" while one is open and up
  to date (it scrolls to the box).
- **Final step box, once merged or discarded** (current run only): Delete branch while git says
  the branch still exists in the folder or on GitHub (read with the combined change, local refs
  only). It asks first: "Deletes <branch> on GitHub and in the project folder. Its commits stay in
  the ticket's history here." (or only one of the two places), Delete branch (danger) / Cancel.
  Then "✓ Branch deleted", also shown whenever git says it is gone. Nothing when unknown.
- **Ticket badge**, at the right end of the header's state line (after "· 6 agents"; on a phone
  it wraps under it): "🕒 Took 1h 12m · 1.2M tokens"; "● Running 14m" while a run is live
  (moves every 30 s; the dot pulses only without reduced motion); "Open for 2h" when no run is
  live and the ticket isn't finished; "— usage unavailable" when no record reported tokens.
  Hidden before the first run or when the server can't tell. A button named "Took 1h 12m,
  1,234,567 tokens used. Show details"; Enter or a click opens a popover: Started, Finished (or
  Not finished), Time taken (or So far), each run's time (or "running"), Input / Output / Cache
  write / Cache read / Total processed ("Not reported" for null, "partial" where some records
  didn't report), a note, and "Open in Tokens" (`#/p/<id>/tokens?by=ticket`). No cost anywhere.
  It refetches with the ticket's live updates (its path is under `/api/tickets`).

## Work log

| Date       | What                                                      | Commit    | Checks                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-24 | Db: one ticket's direct usage                             | `0033863` | typecheck(db) ✓ eslint ✓ prettier ✓ vitest tokens 11/11 ✓                                                                                                                                   |
| 2026-10-24 | Server: merge, delete, presence, totals (reviewed, as is) | `3db9f43` | typecheck(server) ✓ vitest merge-delete + board merge-delete + ticket-totals 33/33 ✓, db tokens 11/11 ✓ (re-run after the rebase)                                                           |
| 2026-10-24 | Web: merge, delete, badge, tests, e2e (WIP squashed)      | `299c979` | typecheck(-r) ✓ eslint ✓ prettier ✓ vitest merge-delete + ticket-totals + review-loop-ticket 73/73 ✓ (+ branching, ticket-page, ticket, review-page, copy, api) e2e github + ticket 29/29 ✓ |
| 2026-10-24 | Progress file, status review                              | this one  | docs only                                                                                                                                                                                   |

## Decisions and findings

- **Server reviewed, kept as committed:** it meets the brief; nothing was missing.
- **`branch_protected`** (409) for the target and the base, beside `branch_checked_out` (409) for
  the checked-out branch: the brief named one code for both; two say which it is.
- **Merge refusals** are read from GitHub's JSON after `gh pr merge` fails, never from gh's
  words; the merge also waits for the run to wait for the owner and for the branch's tip to be
  pushed (`unpushed_commits`), as Push & open PR does.
- **Presence** (`localExists`, `headOnOrigin`) is read from local refs on GETs and on the push and
  refresh answers (no network); only a merge with Delete branch and a delete ask origin
  (`ls-remote`). The run detail and the ticket detail leave them out (they are synchronous).
- **Where Delete branch reads presence:** the combined change (`GET /runs/:id/ticket-branch`),
  as the Files tab already reads it for a finished branch. So a finished ticket's Comments tab
  now reads it too (one test of `review-loop-ticket.test.tsx` asserted it didn't; updated). If
  the branch's commits were garbage-collected after a delete, that read answers 410 and nothing
  is shown (nothing to delete then).
- **Only the current run:** Merge pull request and Delete branch act on the ticket's current run
  (the server's rule), so they are offered only when the run on screen is that run.
- **Time:** the badge keeps an open ticket's time moving with this browser's clock, never below
  the server's `elapsedMs`. "Open for" (no live run) is a refinement of the brief's "Running".
- **No cost** in the badge, the popover, the DTO or the server (ADR-0014; owner: "leave cost for
  now").

## Proposed (not made)

- `PULL_REQUEST_COPY.openNote` / `TICKET_PAGE_COPY.finalStep.prNote` still say "Review and merge it
  on GitHub, then press Refresh"; with Merge pull request in the box, "Merge it here or on GitHub"
  would read better (copy owned elsewhere; additions only here).
- A `localExists` on the run detail (or a small `GET /api/tickets/:id/branch` presence route)
  would let Delete branch skip the combined change's diff; needs a contract change.
