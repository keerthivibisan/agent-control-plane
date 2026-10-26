# C-V real run: agent notes, the ticket summary and attachments (2026-10-22)

The owner consented in chat on 2026-10-22 ("yes, run the real test"). The run used `release/0.3.0`
at `7834326` plus the driver change in this commit: the WG-V driver with `ACP_REAL_RUN=1 --scenario
b --attach` (a lead, a helper pool and a change reviewer; one synthetic `notes.md` attached to the
ticket before Start). Throwaway temp repo and data dir, an empty Claude dir, free ports. About
42k budget tokens (lead 15,325, helper 16,016, reviewer 10,525). All 18 driver assertions held,
including the 7 new ones:

| Assertion                    | Result                                                   |
| ---------------------------- | -------------------------------------------------------- |
| editorsAndLeadGotAttachments | true: the lead, the helper and the reviewer were told    |
| everyEditorReportedWork      | true: one `agent-note` for the helper (422 characters)   |
| leadWroteTicketSummary       | true: one `ticket-summary` by the lead (541 characters)  |
| runFactsApartFromSummary     | true: the `run-facts` comment has no lead's note in it   |
| timelineHasNotes             | true: the activity API lists the note                    |
| attachmentsNeverCommitted    | true: no commit on any branch touches `.acp-attachments` |
| notesAndSummaryWithinLimits  | true                                                     |

## What the ticket got

1. **The helper's note** (Conversation): what it added, the four test cases, one deliberate
   deviation from the ticket (a named import, with the reason), that the check passed, and what it
   did not add. Four plain sentences, no code.
2. **The reviewer's findings** (Conversation). It read the attachment and said how it relates to
   the work.
3. **The lead's ticket summary** (Comments): what was built, how it was tested, what was left out
   on purpose, and what the attachment said. Written like a teammate's comment, past tense.
4. **The run facts** (Conversation): the plan, the merged change, the branch, the budget tokens.
5. **The merge line** (Conversation).

## Observations

- **The lead's read of its copy was refused once.** The lead's copies are outside its folder, so a
  read asks the owner; the driver denies such asks. In the app the owner would get an approval
  prompt each time. C-A's proposal `ManagedAgentSpec.readOnlyDirs?` would let the adapter's gate
  allow reads there without asking. Recommended before release.
- **The helper** made no gated read of its copy (reads inside its own worktree are not gated), so
  whether it opened it is not observable without conversation content, which is never stored.
- The temp folders were deleted after reading the comments.
