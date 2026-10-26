# ADR-0024: Session names and run summary comments

- **Status:** accepted: owner decisions in chat on 2026-10-21 ("can't we name them automatically
  when starting"; "the lead alone can comment what are all done"; "yes go ahead with v0.3.0")
- **Date:** 2026-10-21
- **Deciders:** project owner (decisions); coordinator (draft and review)
- **Amends:**
  - ADR-0009 (one more kind of owner-facing text stored as a ticket comment);
  - ADR-0016 and ADR-0021 (what is kept as ticket comments);
  - ADR-0012 (the managed agent spec gains a title).
- **Plan:** [docs/v0.3.0/README.md](../v0.3.0/README.md)

## Context

**Session names.** Sessions the app starts appear as "Untitled" or with Claude Code's generated
title, which is a summary of the first prompt written by a small model in a background request. The
owner wants each one named after its ticket and role when it starts. The Claude Agent SDK
documents a `title` option on `query()` (SDK 0.2.113; this repo uses 0.3.296) that sets the title
and skips the automatic title request. Sessions the owner starts themselves keep Claude Code's
titles; some never get one, such as helper agents and short sessions.

**Run summaries.** After a run, a ticket's comments hold the plan, the reviewer's findings and the
lead's rework and discard notes, but nothing says what was done. The owner wants a proper summary
without spending many tokens. The lead could write one, but a model-written list of facts costs
tokens and can be wrong.

## Decision

### 1. Every agent the app starts is titled at launch

The server builds a title from app data only and passes it as `ManagedAgentSpec.title`. The
adapter gives it to the SDK's `title` option.

- **Format:** `<ticket key> · <label>`, where the label is the agent's workflow block label, for
  example `WEB-12 · Frontend helper` or `WEB-12 · Lead`.
- **Change reviewers:** `<key> · <reviewer label> → <helper label>`.
- **Runs without a ticket** (control-panel runs): `Run · <role>`.
- **Length:** at most `MAX_SESSION_TITLE` (120) characters.
- **Follow-ups** resume the lead's session, which keeps its title.

No conversation content goes into a title. Claude Code writes the title into its own session
record, as it does for `/rename`; the app never writes to `~/.claude`.

### 2. The app names sessions in its own UI

- **Sessions the app started:** `SessionSummaryDto.managed` carries the run, the agent run, the
  ticket key, the kind and the label (from `agent_run_sessions`), and the web shows that name.
- **Other untitled sessions** get a label built from data Claude Code already records:
  - a helper agent shows its agent type and description;
  - a top-level session shows its branch and start time.

### 3. A run summary comment when the lead hands over

When the lead hands over (`request_review`), the app adds one ticket comment by author `app`.

- **Facts the app already records, at no token cost:**
  - the plan (step count, and the helper or block of each step);
  - each change (its block, files changed with lines added and removed, check results, rework
    rounds by decider, and the decision);
  - the ticket branch (state, changes merged, tip checks);
  - budget tokens per agent kind.
- **The lead's note:** a new optional `request_review.summary` of at most 1,500 characters. The
  lead is asked for 3 to 6 plain sentences about what was done and anything the owner should know.
  It is about 100–300 output tokens, in a tool call the lead already makes; there is no extra agent
  or turn. Without a note, the comment has the facts only.
- **Runs that end without a handover** (failed or stopped) get a facts-only summary.
- **After the owner's merge,** a short `app` comment: `Merged acp/<KEY> into main at <commit>`.

The note is owner-facing text that the lead writes for the ticket, like the plan and the review
findings, so it is stored as a comment (ADR-0016, ADR-0021). Prompts, replies, diffs and tool
output are still never stored.

**Amended 2026-10-21 (v0.3.0 S-C, owner feedback: "a proper comment like humans write"):** the
lead is asked to write the note like a teammate's ticket update (3 to 6 short past-tense sentences:
what was explored, then built, then tested, then anything left or risky; no code or step-by-step
log; a two-sentence example; the brief's line is under 300 characters; the note is still at most
1,500). The comment body is now `Run summary` (or
`Run summary (updated)`), then the note after a `From the lead:` line as the main text, or one
plain sentence on how the run ended when there is no note, then a `Details:` section with the facts
as short sentences ("Merged 1 change from Helpers: 2 files, 18 lines added; the check passed.").
The merge line and the ticket branch wording are unchanged. The web shows the note as the comment
under "Lead · Run summary" and folds the details behind a "Details" disclosure; summaries without a
`Details:` line show as before.

### 4. No migration

Comment authors and session data are validated with Zod (`ticket_comments.author` is plain TEXT),
and the title lives in Claude Code's session.

## Consequences

- **Named everywhere:** managed sessions are named in Claude Code's records and in the app, and the
  automatic title request is skipped for them, which saves a small-model call per agent.
- **Visibility:** the docs say SDK-started sessions are left out of the `claude --resume` picker
  (resume by id still works). Whether the desktop app lists them is not documented; S-V checks it
  with a consented real run.
- **Every run leaves a readable, accurate summary** at the cost of a few hundred tokens.
- **Rollback:** 0.2.0 cannot read `app` comments. The 0.3.0 notes say so, as for 0.2.0.

## Alternatives considered

- **Write `custom-title` records into Claude Code's transcripts.** Rejected: the app never writes
  under `~/.claude`.
- **The SDK's `renameSession()` after start.** Kept as a fallback, if the `title` option does not
  show as a name. Not needed if S-V confirms it.
- **A summary written entirely by the lead.** Rejected: it costs more tokens and its facts can be
  wrong. The app's records are exact, and the lead adds only what records cannot say.
- **A separate summarizer agent.** Rejected: it costs a whole agent for a few lines.
