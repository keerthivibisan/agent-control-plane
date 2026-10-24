# S-C

> Progress file for S-C. Only its agent edits it. Plan: [../README.md](../README.md).

| Field    | Value                                                        |
| -------- | ------------------------------------------------------------ |
| Status   | review                                                       |
| Branch   | `wp/s-c-human-comment`, rebased on `release/0.3.0` `249d668` |
| Worktree | `.claude/worktrees/agent-a0f8d98453fef2751`                  |

Owner feedback (2026-10-21): "The comments are like what each phase did; we don't need that. We
need a proper comment like humans write: we explored this, we added this feature and tested this,
developed this."

## Tasks

- [x] The lead's brief asks for the note like a teammate's ticket update, with a two-sentence
      example (`HANDOVER_NOTE_LINE`, orchestrator `plan.ts`), trimmed to 297 characters at the
      owner's request; the 1,500-character cap is unchanged.
- [x] Golden traces: proved that only the prompt text changed, then updated them.
- [x] The comment body (server `control/run-summary.ts`): `Run summary`, the note (or one plain
      sentence), then `Details:` with the facts as short sentences.
- [x] The web card (`features/ticket/RunSummary.tsx`, `run-summary.ts`): "Lead · Run summary",
      the note as comment text, the details behind a "Details" disclosure; older summaries as
      before.
- [x] Tests (server, orchestrator, web, e2e), docs, ADR-0024 §3 amendment line.
- [x] Full `pnpm check`; full web e2e.

## Work log

| Date       | What                                                          | Commit    | Checks                                                  |
| ---------- | ------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| 2026-10-21 | Paused by the owner; code left uncommitted (lint failed)      | `4cea97c` | format ✓ (progress file only)                           |
| 2026-10-22 | Lead brief: the human-style note (297 chars); golden traces   | `5e83890` | format ✓ lint ✓ typecheck ✓ test 4701/4701 ✓ build ✓    |
| 2026-10-22 | Server: the comment layout and the details wording            | `c286559` | as above                                                |
| 2026-10-22 | Web: the card reads like a comment; e2e                       | `0a44ac0` | as above                                                |
| 2026-10-22 | Docs: ADR-0024 §3 amendment, security, architecture           | `7151cb8` | as above                                                |
| 2026-10-22 | Rebased on `release/0.3.0` `249d668` (docs only, no conflict) | —         | —                                                       |
| 2026-10-22 | e2e fix: close with Enter; the older heading "Changes (1)"    | `ae1f746` | format ✓ lint ✓ typecheck ✓ (web); full web e2e 76/76 ✓ |

The first full e2e run had 74 passed and 2 failed, both in the new tests. Space, as Playwright sent
it, did not close the native disclosure in Chromium, and I had expected a heading of "Changes"
where the older summary says "Changes (1)". After `ae1f746` the full run (ports 7831/7841) is
76/76.

## Decisions and findings

- **The prompt line** was 165 characters. The first S-C version, with the owner's whole example,
  was 611. At the owner's request it is now **297**: "Pass request_review a summary for the owner
  like a teammate's ticket update: 3 to 6 short past-tense sentences on what was explored, then
  built, then tested, then anything left or risky. No code or step-by-step log. Example: "Added a
  dark mode switch to Settings. Tested it with three unit tests."" That is 132 characters more
  than before S-C, about 30 input tokens per review-loop run. The hand-over prompts' "(with your
  summary)" and "with an updated summary" stay as they were.
- **Golden traces.** Before the change all 2,300 orchestrator tests passed on the old snapshots.
  With only `HANDOVER_NOTE_LINE` changed, exactly 255 snapshots failed (golden-v1 and
  golden-templates), both for the 611-character version and for the 297-character one. Against
  the base commit, after `-u`, every changed snapshot line is either a lead prompt or brief line
  (`start-agent … kind="lead" prompt=…`, `send-to-agent … text="The owner approved plan…"`,
  `"Plan v1 was approved automatically (Full…"`) or a whole-trace digest. Each of the 79 changed
  text hashes grew by exactly 132 characters, the length difference of the line. Nothing else in
  any trace moved.
- **Whose words.** The comment's author is `app`, so the plain text says which words are the
  lead's: a `From the lead:` line before the note. The web hides it and says "Lead · Run summary"
  instead. It also tells the web, without guessing from sentences, whether there is a note.
- **Finding the details.** The web splits at the _last_ `Details:` line: the facts never contain
  one (every fact line starts with `- `), while a lead's note might.
- **The ticket key line** (`WEB-12: the lead handed the work over.`) is gone: the comment sits on
  the ticket, and the note or the plain sentence says how the run ended.
- **No-note sentences:** "The lead handed the work over without a note.", "The run failed before
  the work was handed over.", "The run was stopped before the work was handed over.", "The run
  timed out before the work was handed over.", "The lead failed before handing the work over.",
  "The lead was stopped before handing the work over.", "The lead ended without handing the work
  over.", and for legacy runs "The agents finished, and their changes are waiting for your
  review." or "The run finished with nothing to review."
- **Details wording.** One sentence per fact: the plan ("Plan v2 was approved with 2 steps:
  Frontend helper and Helpers."), one per change ("Merged 1 change from Helpers: 2 files, 18 lines
  added; the check passed."; "Discarded …", "… is still in review", "… is back in rework", "… is
  waiting for your decision", "… finished with no changes", "There is no change from …"; "; it
  failed" when the agent itself ended badly), the ticket branch ("… has 1 change merged and is
  waiting for your merge; checks passed on the tip (2)." — the S-A2 wording kept), and the budget
  tokens ("Budget tokens used: 12,400 by the lead, 48,000 by 2 helpers and 9,100 by 2
  reviewers."). Checks read "the check passed", "both checks passed", "all 3 checks passed", or
  "1 of 3 checks passed (failed: Unit tests; not run: Lint)". Lines are left out when git could not
  tell, and "0 removed" is not said.
- **Unchanged:** the merge line, the triggers, idempotence (one summary per handover, facts-only
  once per run), the 8,000-character cap (later change lines give way to a count; the note stays
  whole), and S-B's recognition by the first line.
- **Web.** The disclosure is the shared native `Details` component (keyboard: Tab to "Details", then
  Enter; checked in the e2e). `data-layout` on the card says `comment` (S-C) or `sections` (older).
- **Untrusted content.** No instructions aimed at agents were found in the files read.

## Example comment bodies (synthetic)

With a note:

```text
Run summary

From the lead:
Explored the settings code and found the theme is set in theme-store.ts. Added a dark mode switch on the Settings page. Tested it with three unit tests; all checks pass. Not done: the print view still uses the light colours.

Details:
- Plan v2 was approved with 2 steps: Frontend helper and Helpers.
- Merged 1 change from Frontend helper: 3 files, 42 lines added and 5 removed; both checks passed; 2 rework rounds, asked for by the lead (1) and the reviewer (1).
- Discarded 1 change from Helpers: 1 file; 1 of 3 checks passed (failed: Unit tests; not run: Lint).
- The ticket branch acp/WEB-12 (from main) has 1 change merged and is waiting for your merge; checks passed on the tip (2).
- Budget tokens used: 12,400 by the lead, 48,000 by 2 helpers and 9,100 by 2 reviewers.
```

Without a note (a run that failed while planning):

```text
Run summary

The run failed before the work was handed over.

Details:
- No helpers were started.
- Budget tokens used: 0 by the lead.
```
