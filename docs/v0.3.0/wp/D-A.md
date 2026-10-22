# D-A

> Progress file for D-A. Only its agent edits it. Plan: [../README.md](../README.md) (part 3, the
> GitHub-like redesign); the binding rules are in [packages/web/DESIGN.md](../../../packages/web/DESIGN.md)
> (v3, section "Review pages"). Owner decision of 2026-10-22: "The code review should be like a
> code review in GitHub, side by side": GitHub's "Files changed", with comments on lines that go
> back as rework notes.

| Field  | Value                                              |
| ------ | -------------------------------------------------- |
| Status | review                                             |
| Branch | `wp/d-a-review`, from `release/0.3.0` at `e71a5b4` |

## Tasks

- [x] **Routes** (`lib/router.ts`): `#/p/:projectId/tickets/:ticketId/files` (the ticket branch's
      combined change) and `#/p/:projectId/tickets/:ticketId/changes/:agentRunId` (one helper's
      change), both with an optional `?run=` for an earlier run; route name `review`. Href
      helpers `href.ticketFiles({ projectId, ticketId, runId? })` and
      `href.ticketChange({ projectId, ticketId, agentRunId, runId? })`. Registered in `App.tsx`;
      `nav.ts` puts them under Board (sidebar, crumbs, page key); `Shell.tsx` drops the 88rem
      limit for them (full width).
- [x] **The page** (`features/review/`): `ReviewPage` (loads the ticket, the run, then
      `GET /runs/:id/review` or `GET /runs/:id/ticket-branch`; header with the back link,
      helper, state, round, checks, commit; empty and error states) and `FilesChanged` (sticky
      bar, file tree, file boxes). Sticky offsets are measured (`sticky.ts`: the top bar, the
      demo banner when shown, the bar).
- [x] **File tree** (`FileTree.tsx`, `file-tree.ts`): folders first, single-folder chains folded,
      filter box, status icons, +/−, comment counts, viewed checks, `aria-current`; a click
      scrolls to the file and focuses its header. The files follow the tree's order.
- [x] **Viewed** (`viewed.ts`): a checkbox in each sticky file header; collapses the file; kept per
      change and commit in guarded localStorage; older commits' lists dropped.
- [x] **Line comments** (`LineComments.tsx`, `pending-review.ts`): a "+" per line and side,
      shift-click for a range, inline box (Ctrl/⌘+Enter adds, Escape cancels, focus returns to
      the "+"), pending comments inline with Edit and Delete, kept per change in guarded
      localStorage until sent; stored text is validated as data. Comments on a folded line open
      the fold; comments off the diff are listed above the files.
- [x] **Review changes** (`ReviewPopover.tsx`, `choices.ts`, `compile.ts`): overall comment, the
      choices by state (rework to the helper when it is the owner's turn on the change; Request
      changes to the lead while the branch waits for the final step; Comment always), disabled
      ones with the reason; the compiled text (`Review comments:` / `- path:42 (new): …` /
      overall) with a preview and its length against the endpoint's limit (4,000 rework; 8,000
      request-changes and comments); over the limit it says so and waits, never cuts. Sent
      through the existing `reviewAction`, `ticketBranchAction` and `addTicketComment`; the pending
      review is cleared after a successful send.
- [x] **Entry points:** "Review files" on the change card (once saved) and "Files changed" on the
      ticket branch card (while open), both small additive `ButtonLink`s.
- [x] **Keys and accessibility** (`keyboard.ts`): `j`/`k` next/previous file, `v` viewed, `c`
      comment on the focused line (on a file: its first changed line), never while typing or in a
      dialog; a keys popover documents them. The "+" buttons are one tab stop per file with
      ↑/↓/Home/End; screen-reader names ("Comment on src/api.ts line 42 (after)", "Mark … as
      viewed", "Review changes, 2 pending comments"), the totals and tree entries read in words.
- [x] **Diff viewer, additive** (`components/diff/DiffFileView.tsx`, `index.ts`): optional
      `slots` (`gutter`, `below`, `selected`, `pinned`), `headerEnd` and `stickyHeader`; the file
      box is `overflow-clip` instead of `overflow-hidden` so its header can stick. Without the new
      props it draws as before (the G-C/G-D tests are unchanged and pass).
- [x] **Tests:** `tests/features/review-logic.test.ts` (pending store add/edit/delete,
      persistence, blocked and full storage, cleared after submit; compilation, ordering, ranges,
      earlier commits, limits; choices by state; the tree and its filter; viewed per commit; keys),
      `review-routes.test.ts` (routing, href helpers, shell), `review-page.test.tsx` (the page on
      the loop fixtures: context, comments, rework POST body, edit/delete, too long, disabled
      reasons, viewed, tree filter and jump, folds and off-diff comments, branch Request changes
      and Comment POSTs, a refusal keeps the review, a merged branch). e2e
      `e2e/review-page.spec.ts` (project `review-page`): split by default, Unified/Split, viewed
      across a reload, two line comments (one a shift-click range by keyboard), Request changes
      and the exact POST body; the keys; the ticket branch with Comment and Request changes
      disabled; a phone at 390 (unified, no sideways scroll); the entry points.
- [x] **Docs:** DESIGN.md (routes, href helpers, the diff viewer's new props, "Review pages"
      section).

## Decisions (recorded here, made by the agent)

- **Copy in `features/review/copy.ts`**, not `lib/copy.ts`: D-A, D-B and D-C ran in parallel, and
  a feature file of its own avoids three agents appending to the same section. The two entry
  buttons on the review-loop cards use it too.
- **The ticket branch page fetches its diff whenever the branch is open**, also while agents work
  (the card fetches only at the final step): the owner opened the page on purpose; refetches on
  stream notices are the same as the ticket page's review fetch.
- **Comment wording:** "Comment" says it adds the review to the ticket's comments "without sending
  it to an agent", which is what `POST /tickets/:id/comments` does today.
- **Split by default** only while the owner has never chosen a view (`acp.diff.view` unset); the
  choice stays shared with every diff in the app.
- **A comment written on an earlier commit** stays in the pending review, is marked "Written on an
  earlier version (abc1234)" and is sent with "written on abc1234" in its reference, since its
  line numbers may have moved.
- **One comment box at a time;** clicking another line's "+" moves the box and keeps its text.
- **Per-comment limit** is the smallest endpoint limit of the page's choices (4,000 on a change,
  8,000 on the branch); the whole review is checked against the chosen endpoint's limit.
- **Links from the cards carry `?run=`** of the card's run, so a card of an earlier run opens that
  run's page.

## Proposed (not made)

- None needed: no server change and no new storage.

## Log

- 2026-10-22 Started.
- 2026-10-22 Routes, page, tree, viewed, line comments, Review changes, entry points, keys, tests
  and docs; status `review`. Verified per the coordinator's narrowed instructions: web
  typecheck, the review and diff vitest files (181 passed), eslint and prettier on the changed
  files, and e2e project `review-page` (5/5). A full `pnpm check` run earlier failed only on the
  server test `tests/verification/control/restart.test.ts` (5 s timeout; no server file changed
  here). The full check and e2e are the coordinator's, at merge. Screenshots (1440, light and
  dark) in `.acp-data/d-a-shots/`.
