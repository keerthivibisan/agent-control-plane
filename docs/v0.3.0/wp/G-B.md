# G-B

> Progress file for G-B. Only its agent edits it. Plan: [../README.md](../README.md), Part 2;
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md).

| Field  | Value      |
| ------ | ---------- |
| Status | review     |
| Branch | wp/g-b-web |

## Tasks

- [x] B1 Branching strategy in project settings (`features/branching/BranchingFields.tsx`, pure
      rules in `strategy-form.ts`): GitHub flow, Git flow, Custom and "None, keep acp/<KEY>"; base
      and default target branches; the ticket branch template with the token help and a live
      preview (`renderTicketBranchName` on a sample feature and bug); a word per ticket type;
      sentences per field as typed; saved through the setup PUT (`branching` only when changed,
      `null` for None). Also in the new-project wizard's step 2, collapsed.
- [x] B2 Code host status in project settings (`CodeHostCard.tsx`, rules in `code-host.ts`):
      "Connected to GitHub: owner/repo", or no GitHub remote / no GitHub CLI / not signed in in
      plain words, with Check again. Stream notices never refetch it (`lib/invalidation.ts`).
- [x] B3 A ticket's branch name and target (`TicketBranchFields.tsx`, `ticket-branch.ts`): New
      ticket "More options" (placeholders: the strategy's name for the ticket as typed, the default
      target) and the ticket card's Branch section (Change; empty fields back to the project's,
      `branch: null` for both); read-only actual branch and target once the run created it.
- [x] B4 The final step on the ticket branch card (`review-loop/BranchFinalStep.tsx`,
      `branching/PullRequest.tsx`): Merge into <target> and Push & open PR (disabled with the
      reason without GitHub); the confirmation sentence, editable title (`<KEY>: <title>`) and
      draft; the pull request's number and link (new tab, https only), state pill, Checked <time>
      and Refresh; merged reads "Merged into <target> on GitHub"; every error code in words.
- [x] B5 Copy (`lib/copy.ts`: `BRANCHING_COPY`, `CODE_HOST_COPY`, `TICKET_BRANCH_COPY`,
      `PULL_REQUEST_COPY`; the ticket branch card's tip and description no longer say "main").
- [x] B6 Tests: vitest (`tests/features/branching-logic.test.ts`, `tests/features/branching.test.tsx`,
      `tests/lib/invalidation.test.ts`); e2e with mocked routes (`e2e/github.spec.ts`, Playwright
      project `github`, fixtures `e2e/github-fixtures.ts`), screenshots with `ACP_SCREENSHOT_DIR`.
- [x] B7 Docs (`packages/web/DESIGN.md`, "Branching and GitHub"), gate, report.

## Work log

| Date       | What                                                  | Commit | Checks |
| ---------- | ----------------------------------------------------- | ------ | ------ |
| 2026-10-22 | Strategy, code host, ticket branch, final step, tests | —      | —      |

## Decisions and findings

- **Presets lock names, not branches.** GitHub flow and Git flow fill every field; their template
  and type words are read-only ("Choose Custom to change it"), their base and target stay editable
  (repositories use main, master or trunk). Custom starts from whatever was there. GitHub flow
  starts from the code host's default branch when it is known, else `main`.
- **None** is a fourth choice that sends `branching: null` when a strategy was saved; a project
  without one sends nothing (absent keeps it). Settings saves the strategy with the page's one
  Save button.
- **New ticket placeholder:** the ticket number isn't known before it is created, so the name
  reads `fix/WEB-N-login-fails-on-safari` (the project's key and "N"), live with the title and type.
- **Read-only once created:** the ticket's Branch section shows the current run's actual branch and
  target while that branch is open or merged; after a discard (or before any run) it can be changed
  again for the next run.
- **While a pull request is open** the local merge and Push & open PR are hidden (the merge happens
  on GitHub); Request changes and Discard stay. A closed pull request brings both final steps back.
  Refresh is offered until it is merged.
- **Never on a timer:** the code host status is excluded from every stream notice's refetch; it is
  read when Settings or the final step is on screen and on Check again (ADR-0025 §2).
- **Links:** the pull request links out only for an `https:` URL (`target="_blank"`,
  `rel="noopener noreferrer"`); anything else shows as text.
- **Shared-file overlap with G-C kept small:** the final step moved out of `TicketBranchCard.tsx`
  into `BranchFinalStep.tsx`; the card now renders `<BranchFinalStep>` where the actions were, and
  its imports changed (Button, AlertIcon, ActionError/ConfirmAction, useTicketAction, ReasonForm,
  checksSummary went with the actions). The `Combined` (diff) section is untouched.

## Depends on G-A's real endpoints

Coded against the brief and the G-0 contract, mocked in every test:

- `GET /api/projects/:id/code-host` → `CodeHostStatusDto`;
- `PUT /api/projects/:id/setup` with `branching` (absent keeps, `null` removes);
- ticket create `branch` and PATCH `branch` (a value sets, `null` returns to the project's);
- `POST /api/tickets/:id/branch/pull-request` (`OpenPullRequestRequest`) and
  `POST …/pull-request/refresh` (body `{}`), each answered with a `TicketBranchDto` (parsed with
  `TicketBranchDtoSchema`; a different answer would show as an error after a successful push);
- error codes as `ErrorDto.code`: `gh-not-installed`, `gh-not-logged-in`, `no-github-remote`,
  `push-rejected`, `pr-exists-elsewhere`, `timeout`, `gh-failed`;
- a pull request merged on GitHub sets the ticket branch `merged` (its `pullRequest.state` too) and
  the ticket Done; `TicketBranchDto.baseBranch` is the ticket's target.

## Follow-ups (not in G-B)

- After Request changes on a ticket whose pull request is open, the lead's new commits reach
  GitHub only if the server pushes them; the card has no "Push again". G-A/G-V decide whether
  `POST …/pull-request` re-pushes for an open pull request (then the card can offer it).
