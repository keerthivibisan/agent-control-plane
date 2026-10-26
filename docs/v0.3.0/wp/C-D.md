# C-D

> Progress file for C-D. Only its agent edits it. Plan: [../README.md](../README.md). Binding:
> ADR-0026 §5 (read-only merged diffs). Owner request 2026-10-22: "we have two different UI for
> code review and view after; we need a single UI. Let's have the Files changed page as direct, so
> here we can do all the stuffs. If merged we show the files alone with the status as merged. If
> not merged we can add comments and stuffs here. We will have the GitHub format here itself."

| Field  | Value                                                                                    |
| ------ | ---------------------------------------------------------------------------------------- |
| Status | review                                                                                   |
| Branch | `wp/c-d-files-2`, from `wp/c-d-files` (the stopped agent's WIP `9e82e6c`, squashed here) |

## What changed

The ticket page's **Files changed tab is D-A's GitHub review UI**; the summary table, the change
rows and the separate "combined change, line by line" viewer are gone, and so is the review page
(`features/review/ReviewPage.tsx`). Web only: no core or server change, no new dependency.

- **The tab** (`features/ticket/FilesTab.tsx`): a head, then D-A's `FilesChanged` (file tree,
  Unified / Side by side, Viewed, line comments, the pending review, Review changes through the
  existing owner endpoints, extracted send hook `features/review/use-send.ts`).
  - **Changes from** (`features/review/ChangePicker.tsx`): All changes (the ticket branch, base →
    tip, `GET /runs/:id/ticket-branch`) or one helper's change (`GET /runs/:id/review`), each with
    its state word, checks and file count. In the address as `?tab=files&change=<agentRunId>`
    (replaced; another tab drops it; another run resets it). A run without a ticket branch has no
    "All changes" and opens its first change.
  - **State label**: Open (green), Merged (purple), Closed (red, discarded), GitHub's filled pill
    with an icon and the word; then `branch into target` / `merged into target` + merge commit /
    `was discarded`, the tip and its checks, changes merged; for one change its state, round,
    checks, rework badges, commit and **Open in Agents** (the change card in the side panel,
    replacing the old rows' Open).
  - **Not merged:** interactive as before. **Merged or closed:** the same layout read only
    (`FilesChanged readOnly`): no "+" on lines, no comment boxes, no `c` key, no Review changes
    ("Read only" badge in its place), Viewed still kept locally; a pending review kept from before
    stays in the browser, unseen and unsent. **410** (or a refusal naming missing commits, or an
    empty answer for settled work): "Files no longer available" under the same head.
  - Rules in `features/review/files-state.ts` (pure): `changeChoices`, `selectionFor`,
    `filesStateOf`, `isReadOnly`, `isGoneError`, `branchFilesState` (replaces
    `features/ticket/merged-files.ts`).
- **Addresses** (`lib/router.ts`, `app/redirects.ts`, `App.tsx`): `href.ticketFiles` and
  `href.ticketChange` now build `…/tickets/:id?tab=files[&change=…][&run=…]`, so every link (change
  card "Review files", ticket branch card "Files changed", Conversation links) goes straight to the
  tab. D-A's `…/tickets/:id/files` and `…/changes/:agentRunId` still parse and redirect (replace)
  to the tab with the same change and run (`reviewTarget`).
- **The ticket page** (`TicketPage.tsx`, `ticket-tabs.ts`): the run on screen is the address's
  `?run=` (it was page state), so a link with a run opens it; `useTicketParams`, `paramFromHash`,
  `hashWithParams`; `hashWithTab` drops `change` when another tab opens.
- **Shell** (`app/nav.ts`, `TopBar.tsx`, `Shell.tsx`): the breadcrumb on a ticket is
  "Board / <KEY>" (the key the current page, not a link; it reads the ticket's cached detail);
  the main column is full width while Files changed is open (`fullWidth`).
- Copy in `features/review/copy.ts` (picker, states, read only, gone); `MERGED_FILES_COPY` removed
  from `features/activity/copy.ts`. Icons for the state labels in `features/review/icons.tsx`.
- DESIGN.md: routes table, href helpers, breadcrumb, "Files changed: one GitHub review UI"
  (replacing "Review pages"), the ticket section's merged-files line and Conversation links.

## Decisions (made by the agent)

- **The picker sits in a head row above the sticky bar**, not inside it: the picker and the state
  label stay visible in every state (loading, no change, 410), so the frame never changes. The
  WIP's `barStart` slot was dropped.
- **All changes reads the branch's diff whenever the tab shows it**, also while agents work (D-A's
  page did the same; the owner opened it on purpose). The Comments tab still reads it only at the
  final step.
- **Open in Agents replaces the per-change Open**; the per-change rework/direct-rework/conflict
  badges moved to the head when that change is chosen; the picker's items show state, checks and
  files (a plain state word there, without the ⓘ tip, so no button sits inside a menu item).
- **Closed is red**, as GitHub's closed pull requests; the label uses `text-canvas` on the filled
  status color so it reads in both themes.
- **A change of a merged branch is read only too**, even though its own state may be "merged into
  the ticket branch" earlier.
- **`?run=` moved into the address** so the redirects and the cards' links (which carry the run)
  open that run; the run picker writes it (replace) and resets `change`.

## Proposed (not made)

- None needed. `TICKET_PAGE_COPY.files` in `lib/copy.ts` (shared) is no longer read by the tab
  (`reviewAll`, `filesChanged`, `filesChangedFor`, `open`, `openFor`, `changesTitle`,
  `helpersTitle`, `changesNone`, `branchTitle`, `noRun`); it can be removed at merge with C-B's
  unused `TICKET_PAGE_COPY.tabs`.

## Checks

Lean, as directed: `pnpm --filter @acp/web typecheck` ✓; prettier and eslint on `packages/web`
src, tests and e2e ✓; vitest on the 9 touched files 181/181 ✓ (`review-page` rewritten on the
ticket page, `review-routes`, `review-logic`, `ticket-page`, `review-loop-ticket`, `run-limit`,
`ticket-activity`, `app/shell`, `app/redirects`). e2e after `pnpm --filter @acp/web build`, with
`ACP_E2E_PORT=7933 ACP_E2E_CONTROL_PORT=7943`: `review-page` 7/7, `ticket` 14/14,
`ticket-activity` 5/5, `diff-viewer` 2/2, `review-loop` 3/3, `review-loop-live` 3/3, `shell` 11/11,
`github` 8/8. `ticket-activity`'s "Comments: … a comment with an uploaded file" (C-B, not touched
here) failed twice under load at its last step (the refused `.svg` upload row never appears) and
passed 5 times in a row alone; reported as a flaky race in the comment form, not fixed here.
`design-shots` and `readme-screenshots` (gated) were updated but not run.

## Pictures

`.acp-data/c-d-shots/review-{change,change-popover,branch,branch-popover,picker,merged,gone}-1440-{light,dark}.png`
(git-ignored), made by `ACP_SCREENSHOT_DIR=<abs dir> ACP_E2E_PORT=7933 ACP_E2E_CONTROL_PORT=7943
pnpm --filter @acp/web exec playwright test -c e2e/playwright.config.ts --project=review-page`.

## Log

- 2026-10-22 Started (`wp/c-d-files`); the first agent stopped after a partial WIP (`9e82e6c`).
- 2026-10-22 Continued on `wp/c-d-files-2`: kept the WIP's routes, redirect, breadcrumb, picker,
  read-only mode and send hook; built the tab, the rules, the states and the tests; squashed the
  WIP into the commits below; status `review`.
