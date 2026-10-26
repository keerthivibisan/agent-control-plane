# G-D

> Progress file for G-D. Only its agent edits it. Plan: [../README.md](../README.md) (part 2);
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md). The web follow-ups
> of G-A, G-B and G-C (see their entries in [../STATUS.md](../STATUS.md)).

| Field  | Value                                                     |
| ------ | --------------------------------------------------------- |
| Status | review                                                    |
| Branch | `wp/g-d-web-followups`, from `release/0.3.0` at `d84004f` |

## Tasks

- [x] **The pull request lines.** `parseMergeLine` (`features/ticket/run-summary.ts`) reads
      `Merged via pull request #N into <target> at <sha7>; <tip checks>.` and
      `Pushed <branch> and opened pull request #N into <target>.` /
      `Pushed <branch>; pull request #N into <target> was already open.` as a `kind`-tagged
      union (`merged`, `pr-merged`, `pr-pushed`); the old formats parse as before.
      `RunSummary.tsx` shows them as small system lines (`data-testid="merge-line"`,
      `data-kind`): branches and the commit as code, the number as plain text.
- [x] **Read on opening.** `features/branching/pull-request-check.tsx`: the ticket page calls
      `POST /api/tickets/:id/branch/pull-request/refresh` once when it opens on a ticket whose
      current branch has an open pull request. "Checked <time>" shows as before.
- [x] **Push new commits** (`BranchFinalStep.tsx`, `PullRequest.tsx`, `code-host.ts`
      `hasNewCommits`): offered while the pull request is open and `pushedCommit` differs from
      the branch's `headCommit`; asks first; the same `POST …/pull-request`; `push-rejected` in
      its own words.
- [x] **Narrow diffs.** `DiffViewer` follows its width (`useSplitFits`, `view-mode.ts`); below
      side by side's minimum it shows unified with Side by side off ("Not enough room here");
      the saved choice is kept.
- [x] **The last two old diff views.** `ReviewPanel` and `ChangesTab` use `DiffSection`; the
      old `DiffView`, `diffLines` and their copy are removed. `control.test.tsx` and
      `control.spec.ts` read the shared viewer's test ids.
- [x] **ADR note.** One dated line in ADR-0025 §1: pushes use `--no-verify`.
- [x] Tests, `pnpm check`, the full web e2e, `DESIGN.md`, screenshots.

## Decisions

- **One read per page visit, decided on the first render.** The page decides from the ticket
  detail it first has (`detail.currentRun.ticketBranch`), per ticket id (a ref): stream notices,
  refetches, the answer itself and StrictMode's second effect never ask again. A pull request
  opened _during_ the visit is not read on its own (the owner just pushed it; the existing
  e2e's Push → Refresh flow relies on that), and a new visit (another ticket, a reload) asks
  again. Only the current run's branch counts, as the endpoint reads the ticket's branch.
- **How the read shows.** Its state reaches the pull request through a small context
  (`PullRequestCheckProvider` in `TicketPage`) rather than props through four components:
  Refresh reads "Refreshing…" meanwhile, and a failure shows in plain words on the pull
  request until the owner presses Refresh (then the owner's result counts).
- **Unknown is never "new".** `pushedCommit` absent (a server before it) or null hides Push new
  commits; only a known, different commit shows it. It replaces the hidden merge as the primary
  action while the pull request is open; Request changes and Discard stay. No code-host check
  first: the pull request is open, so GitHub was ready, and every refusal is worded.
- **The push-again wording** is a variant of `pullRequestErrorText` (`{ pushAgain: true }`),
  so Push & open PR keeps its own sentence for `push-rejected`.
- **Narrow means narrower than 36rem plus the file card's 2px border**, measured on the viewer
  itself; a width of 0 (not laid out, a closed disclosure) counts as fitting. Without
  ResizeObserver (jsdom, old browsers) it always fits, so tests and old browsers behave as
  before. The off option is `aria-disabled` (still focusable) with a `title` tooltip and an
  `aria-describedby` sentence; clicking it does nothing. `Segmented` gained optional
  `disabled`/`reason` per option (additive).
- **Where it applies:** the side panel beside the agents (25rem at 1280 px and wider) is now
  unified with Side by side off; under 1280 px the side panel sits under the agents, wide
  enough for side by side. The G-C e2e was changed to match.

## Work log

| Date       | What                                                    | Commit    | Checks                                                              |
| ---------- | ------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| 2026-10-22 | Narrow diffs; ReviewPanel and ChangesTab on DiffSection | `3861ddb` | alone: web typecheck ✓ lint ✓ test 942/942 ✓                        |
| 2026-10-22 | Pull request lines, read on opening, Push new commits   | `4b62524` | format ✓ lint ✓ typecheck ✓ test 4917/4917 ✓ build ✓; web e2e 86/86 |
| 2026-10-22 | ADR-0025 §1: pushes use `--no-verify`                   | `6ae88d9` | docs only                                                           |
| 2026-10-22 | This file (status `review`)                             | this one  | as above                                                            |

## Screenshots

Under the worktree's `.acp-data/screenshots/g-d/` (git-ignored; light and dark):

- `gh-pr-lines-*` (1440, 1024, 390): the three pull request lines in the comments;
- `gh-push-new-*`, `gh-push-new-confirm-*`, `gh-push-new-rejected-*`: Push new commits, its
  confirmation and the refused push;
- `diff-change-narrow-1440-*`: the change card's diff in the side panel, unified with Side by
  side off; `diff-change-split-1024-*`: the same panel under the agents, side by side.

## Follow-ups

- None required. If the server later sends more context (`git diff -U<n>`), nothing here
  changes.
