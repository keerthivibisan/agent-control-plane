# G-F

> Progress file for G-F. Only its agent edits it. Plan: [../README.md](../README.md), Part 2;
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md) §8.

| Field  | Value           |
| ------ | --------------- |
| Status | review          |
| Branch | wp/g-f-branches |

## Tasks

- [x] F1 Server: `GET /api/projects/:id/branches` → `ProjectBranchesDto` in the new
      `code-host/branches.ts` (`createProjectBranches().list`), `CodeHostService.branches`, the
      board service (`projectBranches`) and `routes/board.ts`.
- [x] F2 Server: `POST /api/projects/:id/branches` (CSRF, `CreateBranchRequest`):
      `createProjectBranches().create`, `CodeHostService.createBranch`, `createProjectBranch`.
      Answers the fresh `ProjectBranchesDto` (201).
- [x] F3 Server tests: `tests/code-host/branches.test.ts` (temp repositories, a local bare
      origin, the real runner with a recording `execFile`), `tests/board/branches.test.ts`
      (routes).
- [x] F4 Web: `features/branching/Branches.tsx` (the Local branches card, the one-click create,
      the missing-branch note, the Start refusal's fix), `branch-list.ts` (pure rules), the
      strategy form's warnings (`BranchingFields`), the ticket target combobox
      (`TicketBranchFields`), "Push <branch> now" (`ConnectRepository`), the fix on the board
      (`BoardPage`) and the ticket header (`TicketHeader`), `lib/api.ts` and `lib/copy.ts`
      (additions only).
- [x] F5 Web tests: `tests/features/branch-list.test.ts`, `tests/features/branches.test.tsx`,
      `e2e/github.spec.ts` (two new specs), screenshots with `ACP_SCREENSHOT_DIR`.
- [x] F6 Progress file, report.

## What the server runs

All git calls go through the workspace runner (`execFile`, argument arrays, no shell,
`GIT_TERMINAL_PROMPT=0`, 120 s) with `SAFE_GIT_CONFIG` first (`core.hooksPath=/dev/null`, no
fsmonitor, no submodule recursion), in the project root. git's output is only parsed (ref names,
commit ids); it is never answered or logged (the log has codes and exit codes only).

List:

1. `git remote`: fails → 409 `not_a_git_repository`; `origin` listed → `hasOrigin`.
2. `git for-each-ref --sort=refname --count=501 --format=%(refname:strip=2)%00%(objectname)
refs/heads`: the first 500, `truncated` when there were 501. A name outside
   `GitBranchNameSchema` (or an object that isn't a commit id) is left out.
3. With origin: `git for-each-ref --sort=refname --format=… refs/remotes/origin` → `onOrigin`
   per branch (as of the owner's last fetch; the app never fetches here). Without: `null`.
4. `git symbolic-ref --quiet --short HEAD`, then `git rev-parse --verify --quiet
refs/heads/<b>^{commit}`: `current` is null on a detached HEAD and on an unborn branch.

Create (everything that can refuse runs before the branch exists):

1. `CreateBranchRequestSchema` in the board service: outside it → 400 `invalid_request`.
2. `git remote` (→ 409 `not_a_git_repository`, and whether there is an origin).
3. `git check-ref-format --branch <name>` must exit 0 and print the name itself (so `@{-1}`
   can't expand) → else 422 `invalid_branch_name` (e.g. `x.lock/y`).
4. `push: true` without origin → 409 `no_origin`.
5. `git rev-parse --verify --quiet refs/heads/<name>^{commit}` → 409 `branch_exists` (never
   moved).
6. `git rev-parse --verify --quiet refs/heads/<from>^{commit}` → 404 `base_branch_missing` (a
   branch only on origin is not a base).
7. `git branch --no-track <name> refs/heads/<from>`: no `--force`, no checkout or switch, so HEAD,
   the index and the files stay as they were (tested with staged, unstaged and untracked
   changes). A failure re-checks: the branch appeared meanwhile → 409 `branch_exists`; else 409
   `branch_create_failed` ("A branch whose name is part of it … may already exist", e.g.
   `feature` vs `feature/x`).
8. With push: the pull request push, `git -c push.recurseSubmodules=no push --set-upstream
--no-verify origin refs/heads/<name>:refs/heads/<name>`. A failure keeps its code
   (`push-rejected` 409, `timeout` 504) and its message starts with "The app created <name> in
   the project, but pushing it to origin did not work." The branch stays.
9. The list, as `GET`.

Unknown project → 404 `not_found`; no code host service → 404 `code_host_unavailable` (as the
other code host routes).

## What the UI shows where

- **Board, Move → Start** and **the ticket header's Start**: on 409 `target_branch_missing`,
  under the existing "WEB-30 didn't start." alert, a box: "dev isn't a branch in the project
  folder yet. Create it, and the ticket starts again.", From (preselected: the strategy's base
  branch, else the current branch, else `main`, else the first local branch; never the target
  itself), "Also push to GitHub" (only with an origin; on by default when the code host says
  GitHub, "Also push to origin" and off for another host), and "Create dev from main". Once the
  branch exists, Start runs once more (at most once per refusal; a second refusal needs a new
  click). If the branch exists by now (made in a terminal), "Start again" instead.
- **Settings → Local branches** (after the GitHub card): the branches sorted by name with
  Current, On GitHub (as of the last fetch) and the short commit; Refresh; New branch (Name,
  checked as typed: empty, unsafe, already there; From, default the current branch; the push
  choice; Create branch). Success is a status line ("Created release/2.0 and pushed it to
  origin.") and focus goes back to the empty name; a refusal is an alert in plain words, focused.
- **Settings → Branches (strategy)**: under the base branch or the default target, when it is a
  valid name the folder doesn't have: "develop isn't a branch in the project folder yet." with
  Create it, which opens the one-click create (focus on its button). One warning when base and
  target are the same branch. None in the new-project wizard.
- **A ticket's branch settings (Change)**: the target field offers the local branches (a native
  `<datalist>`; any name can still be typed) and, for a typed branch that doesn't exist, the
  one-click create right under it.
- **GitHub card, Create a repository**: "Push main now" and "…, then pushes main." once the
  branch list says which branch the folder is on (else the old "current branch" words).

## Work log

| Date       | What                                   | Commit    | Checks                                                                                                       |
| ---------- | -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| 2026-10-23 | Server: list and create, tests         | `c609aa4` | typecheck(server) ✓ eslint ✓ prettier ✓ vitest branches + board branches + code-host + board connect 80/80 ✓ |
| 2026-10-23 | Web: card, fixes, combobox, tests, e2e | `b999b96` | typecheck(-r) ✓ eslint ✓ prettier ✓ vitest 9 files 189/189 ✓ e2e github + ticket 26/26 ✓                     |
| 2026-10-23 | Progress file, status review           | this one  | docs only                                                                                                    |

## Decisions and findings

- **Module:** the branch logic is `code-host/branches.ts`, reached through `CodeHostService`, so
  it reuses the hook-free push and bootstrap needs no change.
- **Push flags:** the brief said "the existing push helper"; it sets `--set-upstream`, so a
  pushed branch tracks `origin/<name>` afterwards (as ticket branches do). ADR-0025 §8 writes the
  command without `-u`; the difference is one `branch.<name>.*` entry in `.git/config`.
- **Extra codes:** `invalid_branch_name` (422) and `branch_create_failed` (409) beside the three
  of the contract; both snake_case.
- **201** for a created branch (the other code host POSTs answer 200 for a status).
- **Retry, not a button, after creating:** the owner's click on "Create dev from main" is the
  intent to start; the box says so ("…and the ticket starts again"). The retry is guarded per
  refusal object, so it can never repeat on its own.
- **No `<form>`** in the one-click create: it sits inside the Settings form and the ticket
  dialog's form.
- **Shared files touched (one line each):** `ProjectSettings.tsx` renders `BranchesCard` and
  passes `projectId` to `BranchingFields`; `BoardPage.tsx` and `TicketHeader.tsx` add the fix
  under their Start alert (the brief's "Start error banner").
- **Not covered:** a Start refused inside the Start dialog ("Start with options…") shows the
  server's sentence only (the dialog is `review-loop/StartDialog.tsx`, not G-F's); New ticket's
  target field stays plain text (`NewTicketDialog.tsx`, not G-F's). Both can pass `projectId`
  / render `MissingTargetFix` later.
- **Server message:** the refusal still says "create it locally first" (workspace manager, not
  G-F's); with the box under it, "or create it here" would read better.

## Proposed (not made)

- `packages/server/src/workspace/manager.ts`: reword `target-branch-missing` to "…does not exist
  in the project yet. Create it, then start again." (no code change; the web words it anyway).
- `review-loop/StartDialog.tsx`: an optional slot under its error for `MissingTargetFix`;
  `NewTicketDialog.tsx`: pass `projectId` to `TicketBranchInputs` for the combobox.
