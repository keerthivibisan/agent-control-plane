# ADR-0026: Comments, Conversation and attachments

- **Status:** accepted: owner decisions in chat 2026-10-22 ("two different tabs, Comments and
  Conversation… each agent can add what they did… comments and attachments"; the answers:
  - the owner adds attachments and agents can read them;
  - every helper and tester writes a note;
  - the lead writes a summary of the whole ticket in Comments;
  - it goes into 0.3.0.)
- **Date:** 2026-10-22
- **Amends:**
  - ADR-0009 (one more kind of text written for the ticket);
  - ADR-0019 §7 (`worker` and `tester` gain one tool);
  - ADR-0024 §3 (the lead's note becomes the whole-ticket summary in Comments, and the run's facts
    move to Conversation).
- **Plan:** [docs/v0.3.0/README.md](../v0.3.0/README.md), part 4

## Decision

1. **Two tabs.**
   - **Comments**, the first tab: the ticket's key, title and description, attachments, people's
     comments, and the lead's ticket summary.
   - **Conversation**, the last tab: a timeline of what happened:
     - runs and plans;
     - agents starting and ending, and their notes;
     - reviews, the lead's notes and decisions;
     - run facts, merges and pull requests.

   `TicketCommentDto.kind` (stored, or derived for older rows) decides the tab.
   `GET /api/tickets/:id/activity` builds the timeline from records.

2. **The lead's ticket summary.** `request_review.summary` is now asked for as a summary of the
   whole ticket so far, in past tense, like a teammate. It is stored as a lead comment of kind
   `ticket-summary`; a later run adds an updated one, and the newest is shown first. The run's facts
   are an `app` comment of kind `run-facts` (Conversation).
3. **Agent notes.** `worker` and `tester` get one tool, `report_work({ note })`, of at most 600
   characters. Their brief asks for 2–4 plain sentences (what changed, how it was checked) at the
   end of each turn, about 50–150 tokens. It is stored as kind `agent-note`, with the agent run.
   This is the only tool added; no role gains anything else.
4. **Attachments.** The owner uploads files to a ticket or a comment.
   - **Limits:** 10 MB each, at most 50 per ticket, and an allowlist of types (images, text,
     Markdown, CSV, JSON, PDF, zip, gzip). Never HTML or SVG.
   - **Storage:** in the app's data folder, content-addressed by SHA-256, with rows in the database
     (migration 0009).
   - **Serving:** by the local server only, as a download (images may show inline) with
     `nosniff`.
   - **Agents:** they read them as read-only copies outside the owner's checkout and never commit
     them; their brief lists them by name.
5. **Merged diffs.** After a merge, "Files changed" is read-only, built from the recorded commits.
   Diffs are still never stored.

## Consequences

- **Tokens:** a little more per helper turn, for a readable record of what each agent did.
- **Migration 0009:** the comment `kind` and agent run, agent notes, and attachments. The live
  database is backed up before it is applied.
- **Rollback:** 0.2.0 and earlier cannot read 0.3.0 data after this, as for 0008.
