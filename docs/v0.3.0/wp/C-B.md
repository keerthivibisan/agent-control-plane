# C-B

> Progress file for C-B. Only its agent edits it. Plan: [../README.md](../README.md) (part 4,
> Comments, Conversation, attachments). Binding: ADR-0026. Contracts: C-0 (`cc6d7eb`).

| Field  | Value                                            |
| ------ | ------------------------------------------------ |
| Status | review                                           |
| Branch | `wp/c-b-tabs`, from `release/0.3.0` at `94ac992` |

## What changed

The ticket page's tabs are **Comments · Agents · Files changed · Checks · Conversation**
(`features/ticket/ticket-tabs.ts`). Comments is the default and leaves `?tab=` out; Conversation is
`?tab=conversation`. Aliases: `comments`, `plan` → Comments (the plan under review is there);
`workflow` → Agents; `changes`, `files-changed` → Files changed; `activity`, `timeline` →
Conversation. The design is in `packages/web/DESIGN.md`, "Ticket page: Comments, Conversation,
attachments".

- **Comments** (`features/ticket/CommentsTab.tsx`, was D-B's `Conversation.tsx`): what waits for
  you and the plan card stay first (so they are on the default tab), then the thread: the
  description box with the key, Edit, **Attach files** (button and drag and drop) and the ticket's
  own attachments; the lead's ticket summary (kind `ticket-summary`: one card, the newest,
  "Updated" with earlier versions folded); people's comments (kind `comment`, with "on plan
  version N" and their attachments); the final-step box; the comment box with attachments. The
  sidebar is unchanged beside it.
- **Conversation** (`features/activity/ActivityTimeline.tsx`): the activity timeline with actor
  filter chips and links per `ActivityItemDto.link` (change → `href.ticketChange`, files →
  `href.ticketFiles`, pull request → the URL in a new tab, plan → the folded plan). The run facts
  card (ADR-0024) and the merge and pull request lines moved here. On a 404 (a server without the
  route) the page builds the same timeline from the ticket's runs, plans and comments
  (`activity-from-detail.ts`); on another error it says so and shows that timeline too.
- **Comment kinds** (`features/activity/comment-kind.ts`): `kind` when present, else derived in one
  helper as ADR-0026 says (owner → comment, reviewer → review, app → run-facts, or system for a
  merge/PR line, lead → note).
- **Safe formatting** (`features/activity/RichText.tsx`): paragraphs (line breaks kept), lists,
  quotes, code, bold, italic, links (`http(s)`/`mailto` only, new tab, no referrer). React elements
  only; HTML shows as text. The skills preview (`features/skills/markdown.tsx`) shows links as text
  by design, so it was not reused for comments.
- **Attachments** (`features/attachments`): client checks with the core limits and allowlist
  (`limits.ts`), uploads at once (`use-uploads.ts`), thumbnails for images (click opens in a new
  tab), chips with size and download for other files, Delete with an in-place confirmation.
- **Files changed after a merge** (`features/ticket/merged-files.ts`, `FilesTab.tsx`): "Merged:
  read only", the merged files and diff, no review links; "no longer available" when the commits
  are gone.
- **API client** (`lib/api.ts`, additions only): `activityPaths`, `activitySchemas`,
  `uploadAttachment`, `deleteAttachment`, `ATTACHMENT_NAME_HEADER`, and `ApiClient.postRaw` (a POST
  whose body is the bytes; `request` sends a `RawBody` as is with its own `Content-Type`).
- Header shortcuts (needs you, the final step) go to Comments; "N findings from the reviewer"
  opens Conversation at the timeline (`ACTIVITY_ID`).
- Copy is in `features/activity/copy.ts` (not `lib/copy.ts`, which C-S edits in parallel).
  `TICKET_PAGE_COPY.tabs` in `lib/copy.ts` is no longer used by the page; it can go at merge.

## API shapes assumed from C-A

- `GET /api/tickets/:id/activity` → `TicketActivityDto` (oldest first). 404 = no route.
- `GET /api/tickets/:id/attachments` → `AttachmentDto[]` (ticket and comment attachments; a 404
  reads as none). The Comments tab shows `commentId === null` ones with the description and a
  comment's from `TicketCommentDto.attachments`.
- `POST /api/tickets/:id/attachments` with the raw bytes, `Content-Type` = the allowed type,
  `X-Attachment-Name` = `encodeURIComponent(name)`, `X-ACP-CSRF`, optional `?commentId=` (unused
  by the page) → `AttachmentDto` (status 200 or 201). An upload for a comment being written is
  sent without `commentId` (it is a ticket attachment until the comment is posted), then
  `POST /api/tickets/:id/comments` `{ body, attachmentIds }` attaches it.
- `DELETE /api/attachments/:id` with `X-ACP-CSRF` → 204.
- `AttachmentDto.contentUrl` is used as given for `<img src>`, the link and the download.
- Merged diffs: `GET /api/runs/:id/ticket-branch` also answers for a **merged** branch with
  `files` and `diff` from the recorded commits (base → merged). "No longer available" is shown for
  HTTP 410, or a 404/409 whose `code` contains `unavailable`, `missing`, `gone` or
  `not_available` (e.g. `commits_unavailable`, `ticket_branch_missing`), or a 200 with no files
  and an empty diff (what servers before C-A answer for a closed branch). It is read only when the
  Files changed tab is open, never on Comments.
- `TicketCommentDto.kind` (optional) and `agentRunId` (an agent note names its agent from the run
  on screen in the 404 fallback; the server's activity carries the label itself).

## Decisions

- What waits for you, the plan card and the final-step box stay at the top and end of Comments,
  the default tab, so they are never a click away.
- The ticket summary sits right after the description, as the "state of the ticket", before
  people's comments; earlier versions fold under it instead of filling the thread.
- Conversation shows every plan version (also the one under review): it is the history; Comments
  holds the decision.
- Conversation is full width without the sidebar; the sidebar belongs to Comments.
- Files picked in the comment box upload at once (so a refusal shows before posting) and are kept
  out of the ticket's own list until the comment is posted. A draft abandoned after an upload
  leaves its files on the ticket (they show there and can be deleted).
- One filter chip at a time (Everyone or one actor).

## Contract or shared-file notes (proposed, not made)

- A route for the merged diff, or an explicit `unavailable` flag on `TicketBranchReviewDto`,
  would remove the guessing above (status/code/empty answer). Today's shape works with either.
- `e2e/playwright.config.ts` gained one project, `ticket-activity` (same demo server).

## Checks

Lean, as directed: `pnpm --filter @acp/web typecheck` ✓; eslint and prettier on the changed files
✓; vitest on the 6 touched files 184/184 ✓ (`ticket-activity` 21 new, `ticket`, `ticket-page`,
`review-loop-ticket`, `branching`, `run-summary`); e2e `ticket`, `ticket-activity`,
`session-names`, `review-loop`, `github`, `diff-viewer`, `review-page`, `pages`: 49 passed.
`workspace`, `review-loop-live` and `ticket-page-shots` were updated for the tabs but not run.

## Pictures

`c-b-{comments,conversation,merged-files}-1440-{light,dark}.png`, made by
`ACP_SCREENSHOT_DIR=<dir> ACP_E2E_PORT=7932 ACP_E2E_CONTROL_PORT=7942 pnpm --filter @acp/web exec
playwright test -c e2e/playwright.config.ts --project=ticket-activity` after
`pnpm --filter @acp/web build`.

## Work log

- 2026-10-22: branch from `release/0.3.0`; the five tabs, the Comments tab with attachments and
  the ticket summary, the Conversation timeline with filters, read-only merged Files changed;
  unit and e2e tests; existing specs moved to the new tabs; scoped checks green; status `review`.
