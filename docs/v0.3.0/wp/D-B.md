# D-B

> Progress file for D-B. Only its agent edits it. Plan: [../README.md](../README.md) (part 3, the
> GitHub-like redesign). Owner feedback: "everything is there but not clear"; the ticket page is
> one of the two least clear pages.

| Field  | Value                                              |
| ------ | -------------------------------------------------- |
| Status | review                                             |
| Branch | `wp/d-b-ticket`, from `release/0.3.0` at `e71a5b4` |

## What changed

The ticket page reads like a GitHub pull request page (`packages/web/src/features/ticket/`):

- **Header** (`TicketHeader.tsx`): `WEB-21 Saved searches` with Edit (the title only, PATCH
  `{ title }`); one state label (the board's stage word: Planning, Plan review, Agents working,
  Needs you, In review, Done, Cancelled, also Backlog/Ready); the "wants to merge" line
  `feature/WEB-21-saved-searches → main · 1 change merged · 6 agents · 1 request waits for you`
  (the planned name with an ⓘ until the run creates the branch); actions on the right: the run
  picker, Stop all, Options + Start/Re-run, and the final step's main action (Merge into main,
  Merge anyway…, or Push new commits), which opens Conversation at the final-step box and focuses
  it.
- **Tabs with counts** (`ticket-tabs.ts`): Conversation (comments), Agents (agents), Files changed
  (files), Checks (latest checks). In the address as `?tab=agents|files|checks`; Conversation
  leaves the query out. Aliases for the old sections: `changes`, `files-changed` → Files changed;
  `comments`, `plan` → Conversation; `workflow` → Agents. A tab click replaces the address (no
  history entry per tab). The router is untouched: the ticket route ignores the query.
- **Conversation** (`Conversation.tsx`): what waits for you first (approvals, changes that need
  you, or the legacy review list), the plan under review, then a timeline: the description box
  (Edit sends `{ description }`), each run start (with Show this run), each plan version
  (collapsed), the comments of you, the lead and the reviewer, run summaries and merge lines; then
  the **final-step box** (`FinalStep.tsx`, GitHub's merge box: a headline such as "Ready to merge
  into main", the tip's checks in one line with a link to Checks, the actions of
  `BranchFinalStep`) and the comment box.
- **Sidebar** (`Sidebar.tsx`, right of Conversation from `lg`, under it below): Branch (edit in a
  dialog; read-only once created), Pull request (link, state, Checked, Refresh), Run options (edit
  in a dialog), Labels (type, priority, labels), This run (status, approvals, budget tokens),
  Sessions (named as on the Sessions page), Details.
- **Agents** (`AgentsTab.tsx`): the live graph, the agent tree and the side panel (unchanged).
  The chat draft lives on the page, so it survives a visit to another tab.
- **Files changed** (`FilesTab.tsx`): the ticket branch on top (name, base, tip, changes merged,
  "Review all files", combined files and the collapsed diff), then every change with its state,
  checks, rework and conflict badges, "Files changed" (to D-A's change page) and Open (the side
  panel on Agents).
- **Checks** (`ChecksPanel.tsx`): checks on the tip, then each change's checks with output and Run
  checks again.
- "1 finding from the reviewer **in the conversation**" (was "in the comments below") opens
  Conversation at the comments.

### Links to D-A's pages (for the coordinator)

`features/ticket/review-links.ts` has `ticketFilesHref(ticket)` and
`ticketChangeHref(ticket, agentRunId)`; swap them for D-A's helpers at merge. The ticket page no
longer uses `TicketBranchCard` or `ChangesOverview` (in `features/review-loop`); D-A's buttons in
those won't show on the ticket page, and they can be deleted once D-A is merged if nothing else
uses them.

### Shared or other-WP files touched

- `features/review-loop/BranchFinalStep.tsx`: `showPullRequest` prop (default true).
- `features/review-loop/RunOptions.tsx`: `TicketRunOptionsSection` in the sidebar style, editing
  in a dialog.
- `features/branching/TicketBranchFields.tsx`: `TicketBranchSection` likewise.
- `lib/copy.ts`: new `TICKET_PAGE_COPY` after `TICKET_COPY`; `TICKET_BRANCH_COPY.actualBranch` is
  "Name" (it sat under the heading "Branch"); the reviewer-findings link's words.
- `e2e/design-shots.spec.ts` and `e2e/readme-screenshots.spec.ts` (gated): open the right tab.

## Every action, before and after

| Action                                   | Before (one long page)                        | After                                            |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Back to the board                        | eyebrow link, and an "Open board" button      | eyebrow link (the duplicate button removed)      |
| Pick an earlier run                      | header run picker; Runs list "Show"           | header run picker; timeline "Show this run"      |
| Show the latest run again                | banner button                                 | banner button (above the tabs)                   |
| Stop all                                 | header                                        | header                                           |
| Start / Re-run, Options (Start dialog)   | header                                        | header                                           |
| Edit title                               | ticket card form (title + description)        | header Edit                                      |
| Edit description                         | ticket card form                              | description box Edit (Conversation)              |
| Add a comment                            | ticket card                                   | comment box (Conversation)                       |
| Approve plan / Request changes on a plan | plan card instead of the tree                 | plan card, first on Conversation                 |
| Read earlier plan versions               | plan card "Earlier versions"; Plan history    | timeline, collapsed per version                  |
| Approve / deny an agent's request        | list above the tree; side panel Approvals tab | first on Conversation; side panel Approvals tab  |
| Open a change that needs you             | band above the tree                           | first on Conversation (opens it on Agents)       |
| Review a helper (legacy run)             | review list above the tree                    | first on Conversation (opens it on Agents)       |
| Merge / rework / discard a change        | side panel Changes tab                        | same (Agents)                                    |
| Merge / merge anyway / discard (legacy)  | side panel Changes tab                        | same (Agents)                                    |
| Open a change from the list              | "Changes in this run" under the tree          | Files changed: Open; and "Files changed" link    |
| Run checks again                         | side panel Checks tab                         | same, and on the Checks tab                      |
| Read the combined files and diff         | ticket branch card                            | Files changed (and "Review all files" link)      |
| Read the tip's checks                    | ticket branch card                            | Checks tab; one line in the final-step box       |
| Merge into the target / merge anyway     | ticket branch card                            | final-step box; header shortcut                  |
| Push & open PR, Push new commits         | ticket branch card                            | final-step box (Push new commits also in header) |
| Request changes / Discard the branch     | ticket branch card                            | final-step box                                   |
| Update from the target                   | ticket branch card                            | final-step box                                   |
| Refresh the pull request, open its link  | ticket branch card                            | sidebar, Pull request                            |
| Change branch name / target              | Branch section (inline form)                  | sidebar, Branch → dialog                         |
| Change run options                       | Run options section (inline form)             | sidebar, Run options → dialog                    |
| Chat with the lead or planner            | side panel                                    | side panel (Agents)                              |
| Message a helper, Stop a helper          | agent cards                                   | agent cards (Agents)                             |
| Continue a held stage                    | live workflow                                 | live workflow (Agents)                           |
| Go to the reviewer's findings            | link scrolls down                             | link opens Conversation at the comments          |
| Open a session                           | side panel Activity / Details                 | same, and sidebar Sessions                       |
| Ticket id, created                       | Details in the ticket card                    | sidebar Details                                  |

## Decisions

- Conversation is always the default tab (GitHub's); it never changes by itself as the run moves.
- Tabs replace the address instead of adding history entries (arrow keys select tabs as they move).
- Editing in the sidebar opens dialogs: the selects and fields need more room than 18rem.
- The pull request shows in the sidebar only; the final-step box says it is open and points there.
- The plan under review is not repeated in the timeline; earlier versions are, collapsed.
- Inactive tabs unmount (Radix), so their requests still run only where they did before; the
  run's review, checks and ticket-branch reads moved to the page so the header and tabs share them.

## Checks

As directed by the coordinator: `pnpm --filter @acp/web typecheck` ✓; eslint and prettier on the
changed files ✓; vitest on the 11 touched files 250/250 ✓ (an earlier full `pnpm check` had only 2
lint errors in a test, since fixed); e2e `ticket`, `review-loop`, `github`, `session-names`:
29 passed. `review-loop-live`, `workspace` and `diff-viewer` were updated for the tabs but not run
(the coordinator runs the full e2e at merge).

## Pictures

`.acp-data/d-b-shots/ticket-{conversation,agents,files,checks}-1440-{light,dark}.png` (git-ignored).
Re-run: `pnpm --filter @acp/web build`, then
`ACP_E2E_PORT=7731 ACP_TICKET_SHOTS=$PWD/.acp-data/d-b-shots pnpm --filter @acp/web exec playwright test -c e2e/ticket-page-shots.config.ts`.

## Work log

- 2026-10-22: branch from `release/0.3.0`; header, tabs, timeline, final-step box, sidebar, Files
  changed and Checks tabs; tests moved and added; scoped checks green; status `review`.
