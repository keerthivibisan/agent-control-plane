# G-A

> Progress file for G-A. Only its agent edits it. Plan: [../README.md](../README.md) (Part 2),
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md).

| Field  | Value                                               |
| ------ | --------------------------------------------------- |
| Status | review                                              |
| Branch | `wp/g-a-server` (from `release/0.3.0` at `de0a9fa`) |

## Tasks

- [x] Migration 0008: `tickets.branch_prefs`; `ticket_branches` rebuilt without the `acp/*`
      check; the pull request columns (and `pr_pushed_commit`, the coordinator's addition).
      Migration and repository tests.
- [x] Repositories: `ticketBranchPrefs` (create, read, patch, clear); the ticket branch's pull
      request; the strategy round-trips in the setup JSON.
- [x] Branch naming and creation from the target at plan approval; refusal before the run starts.
- [x] The guard replacing `LEGACY_TICKET_BRANCH`.
- [x] The final merge into the target.
- [x] The `CodeHost` service (`gh`): status, push, create or link, view; the seven error codes.
- [x] Endpoints: code host status, open pull request (and push again), refresh.
- [x] Coordinator additions: push again to an open pull request (fast-forward only;
      `push-rejected` when `origin` diverged) and `PullRequestDto.pushedCommit`; the error codes
      exactly as the seven hyphenated names.
- [x] Docs: `security.md`, `architecture.md`.
- [x] Full web e2e.

## Decisions

- **Target must exist locally.** A ticket branch starts at its target's local tip
  (`refs/heads/<target>`). A remote-tracking `origin/<target>` alone is not accepted (the app
  never fetches, and the local merge needs the local branch): the start is refused with 409
  `target_branch_missing` before any run exists ("create it locally first"). Checked only when the
  plan has a target (ticket or strategy) or the ticket's own name, so projects without a strategy
  behave as before.
- **Naming.** The ticket's `branch.name`, else the strategy template, else `acp/<KEY>`; `-r<n>` is
  added when the name exists or an open ticket branch has it, for every kind of name. A name that
  is a long-lived branch is refused, not suffixed.
- **The guard** (`assertBranchName` + `guardTicketBranch`): the recorded branch is refused when it
  is the run's target (`base_branch`), `main`, `master`, the strategy's base and default target
  (`develop` in Git flow), `origin`'s default as the repository knows it
  (`refs/remotes/origin/HEAD`, local only), or, for operations that change it (advance, update,
  merge, discard), the checked-out branch (`ticket-branch-checked-out`). Reads (review, verify
  before a push) skip the checked-out check.
- **The engine** (`ticketBranchCreated`, `packages/orchestrator`) accepted only `acp/<KEY>`; it
  now accepts any safe name except `main`, `master` and an `acp/…` name that is not this ticket's
  own legacy name.
- **Local merge into the target.** Target checked out in the project: clean tree required and
  `merge --ff-only`, as before. Checked out nowhere: `update-ref refs/heads/<target> <tip>
<old>` (compare-and-swap), no working tree touched; the ticket branch is then deleted with
  `-D` after re-checking its tip. Checked out in another worktree: refused
  (`target-checked-out`). A previous refusal "switch back to the base branch" no longer happens.
- **Pull requests.** Allowed when the owner could merge (REVIEW, every change decided, no agent
  working); no local checks gate. The branch must be at its recorded tip (`verifyTicketBranch`).
  An open pull request for the same head and base is linked (and the branch pushed again); one for
  another base is refused before pushing (`pr-exists-elsewhere`). `gh` gets `--repo=owner/name`
  and `--flag=value` arguments.
- **Merged on GitHub.** On Refresh (the web also calls it when the ticket opens), a merged pull request marks the
  ticket branch merged at GitHub's merge commit (else the pushed tip), writes `Merged via pull
request #N into <target> at <sha7>; <tip checks>.`, and completes the run (ticket Done), when
  the run waits for the owner's merge. Otherwise only the state is recorded. The local branch is
  not deleted and the local target is not moved.
- **Error codes.** `ErrorDto.code` is exactly one of `gh-not-installed`, `gh-not-logged-in`,
  `no-github-remote`, `push-rejected`, `pr-exists-elsewhere`, `timeout`, `gh-failed` (the
  coordinator's instruction; other refusals stay snake_case). Statuses: 409, `timeout` 504,
  `gh-failed` 502. Not GitHub-related refusals on these routes keep their usual codes
  (`run_not_active`, `no_ticket_branch`, `no_pull_request`, `code_host_unavailable`,
  `managed_disabled`, `csrf_missing`).
- **No stderr anywhere.** The CLI runner drops stderr unread; push failures log the exit code only.

## Work log

| Date       | What                                                       | Commit    | Checks                                               |
| ---------- | ---------------------------------------------------------- | --------- | ---------------------------------------------------- |
| 2026-10-22 | db: migration 0008, branch settings and pull request repos | `44c4c23` | format ✓ lint ✓ typecheck ✓ test 4733/4733 ✓ build ✓ |
| 2026-10-22 | core, db: `pushedCommit` (coordinator addition)            | `9fe4b2f` | format ✓ lint ✓ typecheck ✓ test 4760/4760 ✓ build ✓ |
| 2026-10-22 | orchestrator: any safe ticket branch name                  | `6a40d14` | as above                                             |
| 2026-10-22 | server: naming, target, guard, merge, code host, endpoints | `4c22a13` | as above; web e2e 76/76                              |
| 2026-10-22 | docs: security, architecture, this file                    | this one  | as above                                             |

The machine was heavily loaded (load average 40 to 90, other agents at work). In one full check,
unrelated server tests hit their 5 s timeout; they pass alone and with `--testTimeout=30000`, and
the final `pnpm check` (above) passed without any change to them. No e2e spec needed a change.
