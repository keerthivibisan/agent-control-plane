# C-A

> Progress file for C-A. Only its agent edits it. Plan: [../README.md](../README.md) (part 4,
> Comments, Conversation, attachments). Binding: ADR-0026, with ADR-0009, ADR-0013, ADR-0024 and
> ADR-0025.

| Field  | Value                                                |
| ------ | ---------------------------------------------------- |
| Status | review                                               |
| Branch | `wp/c-a-activity`, from `release/0.3.0` at `94ac992` |

## What changed

### Database (migration 0009, `packages/db`)

- `ticket_comments.kind` (nullable; older rows are derived on the server) and `agent_run_id` (FK to
  `agent_runs`, cascade), with a partial unique index: one `agent-note` per agent run.
- `ticket_attachments` (id, ticket, optional comment with `SET NULL`, name, type, size up to
  10 MiB, sha256, created_at).
- Repositories: comments read and write `kind`/`agentRunId` (`StoredTicketComment`),
  `upsertAgentNote` replaces an agent run's note and moves it to now; attachments insert (per-ticket
  limit, comment of the same ticket), list, count, `attachToComment` (all or none), delete,
  `countBySha256`. Statements over 0009's columns are prepared on first use, so the upgrade tests
  can still build repositories on older schemas.

### The note tool (`report_work`)

- Contract (pre-approved): `LeadToolInputs.report_work` (`{ note }`, 1–600 characters) and its
  label "Reported its work".
- Engine: `report-tool.ts` and `agent-note.ts`. A live worker or tester of a ticket run may call it;
  refused for the lead, planner and reviewers, after the turn (including `AWAITING_REVIEW`), while
  stopping, and in runs without a ticket. It emits the `agent-note` effect (redacted, capped) and
  changes no state. `controlToolsFor` gives it to workers (rework turns and depth-2 parents too)
  and testers of ticket runs, never to the lead.
- Brief: `AGENT_NOTE_LINE` ("Before you finish, call report_work with 2 to 4 plain sentences on
  what you did and how you checked it. The owner reads it on the ticket.") ends a ticket run's
  helper task, the tester brief and the rework prompt.
- Adapter: `AGENT_NOTE_TOOL_NAMES`; worker and tester get `report_work` (plus the child tools at
  depth 2) when the server passes a handler (ticket runs only); the lead's set excludes it.
- Server: stored with the transition as the agent run's one `agent-note` comment (author `app`,
  `agentRunId` set).

### The lead's whole-ticket summary and the run facts

- `HANDOVER_NOTE_LINE` asks for "a summary of the whole ticket so far, like a teammate's comment:
  3 to 6 short past-tense sentences on what was done, how it was tested, and anything left or
  risky".
- At a handover with a note: a lead comment of kind `ticket-summary` (the note, at most 1,500
  characters) and the app's `run-facts` comment (the S-C format without the note: heading, one
  opening sentence, `Details:`), written in one transaction. A later handover adds a newer
  `ticket-summary`; the older ones stay as history.
- A later run's lead brief ends with the ticket's latest summary from an earlier run
  (`TICKET_SUMMARY_SO_FAR`).
- The pull request body is the ticket summary, then the run facts.
- New rows carry their kind: owner comments `comment`, review findings `review`, change notes and
  merge-anyway reasons `note`, app lines `system`.

### Activity API

`GET /api/tickets/:id/activity` → `TicketActivityDto` (`board/activity.ts`, pure, from records):
runs started and ended; plans proposed and decided (owner, or automatically in Full auto); agents
started and ended; agent notes; change-review findings with the verdict; decisions with the
decider's note (lead, owner or review agent); legacy owner merges and discards; final review
findings; run facts; merge and pull request lines (links: `change`, `files`, `pull-request`,
`plan`). Labels are the workflow block names. Never the Comments tab's texts or any conversation.

### Attachments

- `POST /api/tickets/:id/attachments` (CSRF): raw body up to 10 MiB (413 while streaming),
  `Content-Type` on the allowlist (415 `attachment_type_not_allowed`), `X-Attachment-Name`
  URI-encoded and checked with `AttachmentNameSchema` (400), optional `?commentId=` of the same
  ticket (404), the content checked against the type (signatures for images, PDF, zip, gzip; UTF-8
  without NUL for text, Markdown, CSV, JSON; 415 `attachment_content_mismatch`), empty 400, more
  than 50: 409. → 201 `AttachmentDto`.
- `GET /api/tickets/:id/attachments` → `AttachmentDto[]`; `GET /api/attachments/:id/content`
  (stored type, `nosniff`, a download except images inline, RFC 5987 name, CSP
  `default-src 'none'; sandbox`); `DELETE /api/attachments/:id` → 204.
- `POST …/comments` accepts `attachmentIds`: unattached files of the same ticket, all or none
  (404 for a foreign id, 409 for one already on a comment).
- Bytes: `<dataDir>/attachments/<sha[0:2]>/<sha>`, owner read-only, removed with the last row.

### Attachments for agents (decision)

- Helpers and the tester: `.acp-attachments/` in their own worktree, with its own `.gitignore`
  (`*`, which ignores itself), so the seal's `git add --all` never stages them and no repository
  config is touched. Reviewers: the same in their temporary checkout. Copies are 0444 and refreshed
  on each start, rework turns included.
- The lead: `<dataDir>/runs/<runId>/attachments` (it reads the owner's checkout in place); reading
  one asks the owner. The planner gets none: it may only read inside its folder (see the proposal
  below).
- The brief lists each by name, type, size and path. A path inside the owner's checkout is refused;
  a failed copy never blocks a start.

### Read-only merged "Files changed"

`WorkspaceManager.diffCommits` (base...head, null when git lacks a commit).
`GET /api/runs/:id/ticket-branch` serves the merged or discarded branch from the recorded base →
head commits, and answers 410 `diff_unavailable` when they are gone. `GET /api/runs/:id/review`
shows a removed worktree's change from its recorded start to its sealed head. Nothing is stored.

## For the web (C-B)

- Comment DTOs always carry `kind`, `agentRunId` (null except agent notes) and `attachments`.
- The ticket summary is every comment of kind `ticket-summary`; show the newest, and mark it
  "updated" when an older one exists on the ticket (the history is kept, not replaced).
- Run facts no longer contain `From the lead:`; older run summaries still do.
- Everything else as the coordinator's shapes: attachments, activity, and 410 `diff_unavailable`.

## Golden traces

Before updating, the prompt changes were put back temporarily: golden-v1 (535) and
golden-templates (18) passed unchanged, and legacy-snapshot differed only by the tester's tool list
gaining `report_work`. Then the snapshots were updated.

## Proposed (not made)

- `ManagedAgentSpec.readOnlyDirs?: string[]` (core adapters contract): folders the adapter's gate
  lets an agent read without asking. With it, the lead's and planner's attachment copies would be
  readable without a prompt to the owner (today the lead asks, the planner gets none).

## Log

- 2026-10-22 `8a032b6` db: migration 0009, repositories; server comment DTOs.
- 2026-10-22 `0f98bf8` orchestrator/core/adapter: `report_work`, the brief lines; goldens.
- 2026-10-22 `70befa3` server: notes, ticket summary and run facts, activity API.
- 2026-10-22 `ed22eb4` server: attachments API.
- 2026-10-22 `189d27c` server: attachment copies for agents.
- 2026-10-22 `13fd4d2` server: merged Files changed.
- 2026-10-22 `24ad911` server tests: stage and limits tests for `report_work`.
