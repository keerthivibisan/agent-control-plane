# S-V real run: session titles and run summaries (2026-10-21)

The owner consented in chat on 2026-10-21 ("yes, run it after S-A merges"). The run used
`release/0.3.0` at `7d77f81`, the WG-V driver with `ACP_REAL_RUN=1 --scenario b` (lead, a helper
pool and a change reviewer), a throwaway temp repo and data dir, and free ports. It took 90 s and
about 37k budget tokens, and every driver assertion was true.

## Session titles

Each of the run's three sessions was checked with the Agent SDK's `getSessionInfo(sessionId, {
dir })`. `dir` was that session's own working folder (the project, the helper's worktree, the review
checkout), so no other project's sessions were read.

| Agent    | `customTitle` recorded by Claude Code | AI title generated |
| -------- | ------------------------------------- | ------------------ |
| lead     | `WGVB-1 · Lead`                       | no                 |
| helper   | `WGVB-1 · Helpers`                    | no                 |
| reviewer | `WGVB-1 · Change reviewer → Helpers`  | no                 |

The SDK `title` option is recorded as the session's custom title, and Claude Code's automatic
title request is skipped. Whether the desktop app lists SDK sessions was not checked; the docs say
the `claude --resume` picker leaves them out.

## Ticket comments

The run left, in order:

1. **The reviewer's findings** (458 characters).
2. **The run summary** (author `app`, 724 characters):
   - the plan (1 step);
   - the change ("merged; 2 files, +18 -0 lines; checks passed");
   - the ticket branch;
   - budget tokens per kind;
   - the lead's note.

   The note was four plain sentences: what was added and how it works, the tests, that the check
   passed and the change merged, and one caveat about behaviour the ticket did not ask for.

3. **The merge line**, "Merged acp/WGVB-1 into main at c91107b.".

The ticket page shows the summary as a "Run summary" card with the note under "Lead's note", and
the merge line under it.

## Observations

- **Stale branch state:** the summary is written at handover, so its ticket-branch line says "open"
  and has no tip checks yet (the known S-A gap); the merge line that follows records the outcome.
- **Content:** the note held no code and no conversation text, as asked.
