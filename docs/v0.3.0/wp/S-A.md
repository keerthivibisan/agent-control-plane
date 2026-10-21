# S-A

> Progress file for S-A. Only its agent edits it. Plan: [../README.md](../README.md).

| Field  | Value                                  |
| ------ | -------------------------------------- |
| Status | review                                 |
| Branch | `wp/s-a-server` (rebased on `9a95746`) |

## Tasks

- [x] Titles: the server builds `ManagedAgentSpec.title` for every agent it starts; the adapter
      passes it to the SDK's `title` option, never on a resume.
- [x] `SessionSummaryDto.managed` in the session list, detail and tree.
- [x] `request_review.summary` (pre-approved contract change), the `handover-summary` effect, the
      lead's brief and hand-over prompts.
- [x] The run summary comment (author `app`): at handover, facts only when a run ends without
      one, legacy runs, the merge line, no duplicates.
- [x] Docs: `security.md`, `architecture.md`, `provider-adapters.md` §11.1.
- [x] Added by the coordinator: `ProjectTokensDto.bySession` gains `managed?`, `firstSeenAt?`,
      `gitBranch?`, `agentType?`; the server fills them; the Tokens list uses `nameSession`.

## Work log

| Date       | What                                                   | Commit    | Checks                                                          |
| ---------- | ------------------------------------------------------ | --------- | --------------------------------------------------------------- |
| 2026-10-21 | Engine: handover note, effect, brief and prompts       | `97592eb` | format ✓ lint ✓ typecheck ✓ test 4609/4609 ✓ build ✓            |
| 2026-10-21 | Adapter: SDK `title` option                            | `e0d8231` | format ✓ lint ✓ typecheck ✓ test 4627/4627 ✓ build ✓            |
| 2026-10-21 | Server: titles at launch, `managed` on session DTOs    | `692d7ff` | format ✓ lint ✓ typecheck ✓ test 4627/4627 ✓ build ✓            |
| 2026-10-21 | Server: run summary comments and the merge line        | `0a6c684` | format ✓ lint ✓ typecheck ✓ test 4645/4645 ✓ build ✓            |
| 2026-10-21 | Docs                                                   | `af32944` | as above                                                        |
| 2026-10-21 | Rebased on `release/0.3.0` `9a95746` (S-B merged)      | —         | —                                                               |
| 2026-10-21 | Tokens rows' naming fields (core, server, minimal web) | `02314d0` | format ✓ lint ✓ typecheck ✓ test 4679/4679 ✓ build ✓; e2e 75/75 |

Server tests that time out at 5 s under load (another agent working in parallel) passed on
rerun, alone and in a second full check: `verification/control/restart.test.ts`, and earlier
`api.test.ts`, `workspace/manager.test.ts`, `skills/service.test.ts` and
`verification/workflow-graph/upgrade-from-0.1.0.test.ts`.

## Decisions and findings

- **SDK option.** SDK 0.3.296 declares `Options.title?: string` ("skips automatic title
  generation"; "no effect on the persisted title when resuming"). The adapter sets it only when
  the options do not `resume` a session: not on follow-ups, not on a rework turn that resumes the
  helper's session. The server still names the rework spec; the adapter drops it.
- **Title formats** (`control/session-names.ts`):
  - `<KEY> · <block label>`: `WEB-12 · Lead`, `WEB-12 · Planner`, `WEB-12 · Frontend helper`,
    `WEB-12 · Helpers` (the pool), `WEB-12 · Code reviewer`, `WEB-12 · Tester`;
  - change reviewer: `WEB-12 · Change reviewer → Frontend helper`;
  - no ticket: `Run · Lead`, `Run · Helper`;
  - a block's label missing from the run's program: the role word (`Lead`, `Planner`, `Helper`,
    `Reviewer`, `Tester`);
  - a later agent with the same label and role is numbered (`WEB-12 · Helpers 2`), counted in
    creation order, so the name is the same at launch and after a reload; change reviewers are
    named after their (numbered) helper instead;
  - the lead-chosen `role` ("API builder") is never used: it is the lead's words, not app data;
  - capped at `MAX_SESSION_TITLE` (120) UTF-16 units with `…`, never splitting a surrogate pair;
    control characters become spaces.
- **`managed.label`** is the title without `<KEY> · ` (or `Run · `). Only top-level sessions are
  matched (`providerAgentId` null); a reloaded change reviewer finds its helper through
  `change_reviews.reviewer_agent_run_id`. One run load per call
  (`services/managed-sessions.ts`), batched link lookup (`listForProviderSessions`).
- **Handover note.** Review-loop runs only: `requestReview` emits
  `{ type: 'handover-summary', note }` with the note redacted and capped at 1,500. Legacy runs
  emit nothing new (the legacy snapshot test is unchanged) and ignore a note.
- **Golden traces.** 255 loop snapshots changed. Before updating them I checked that with the new
  brief line, the "(with your summary)" prompt text, the "with an updated summary" text and the
  `handover-summary` line removed, all 1695 graph-correctness tests matched the old snapshots.
- **Summary triggers and idempotence: one summary per handover.** Every loop handover writes one;
  a later one (after "Request changes") is headed `Run summary (updated)`. Facts-only summaries
  (fail, stop, timeout, a loop run reaching REVIEW without a handover, a legacy run reaching
  REVIEW or COMPLETED) come once per run and never after any summary of that run. Summaries are
  written after the transition commits (line counts need git), one at a time per run, with the
  duplicate check on the stored comments. Effects never replay, so restarts and recovery cannot
  duplicate; a crash between the commit and the write loses that summary (documented). A restart
  that finishes stopping a CANCELLING run writes its facts-only summary once.
- **Lines added and removed** come from git (`WorkspaceManager.lineCounts`): a loop change's
  sealed or integrated commit against its base, or against the ticket tip its merge commit merged
  (second parent); a legacy change from its worktree while it exists. Binary files count as files,
  not lines. Unknown when git cannot tell.
- **Tip checks** run after the move to REVIEW, so a summary written at the handover often shows
  the ticket branch without them; the owner sees them on the ticket branch card.
- **Merge line.** Written before the run completes, so the board's notice already carries it:
  `Merged acp/<KEY> into <base branch> at <7-character commit>.`
- **Overview cost list** reads `OverviewDto.latestSnapshots`, which has none of the new fields, so
  only the Tokens list switched to `nameSession`.
- **Untrusted content.** No instructions aimed at agents were found in the files read.

## Summary layout (synthetic example)

```text
Run summary
WEB-12: the lead handed the work over.

Plan v2: 2 steps (Frontend helper, Helpers).

Changes (2):
- Frontend helper: merged; 3 files, +42 -5 lines; checks passed (2); 2 rework rounds (lead 1, reviewer 1).
- Helpers: discarded; 1 file; checks: 1 of 3 passed; failed: Unit tests; not run: Lint.

Ticket branch acp/WEB-12 (from main): open; 1 change merged; tip checks passed (2).

Budget tokens: lead 12,400; helpers 48,000 (2 agents); reviewers 9,100 (2 agents).

Lead's note:
Added the theme toggle and its settings entry. ...
```

Facts-only headlines: `the run failed before the lead handed over.`, `the run was stopped
before the lead handed over.`, `the run timed out before the lead handed over.`, `the lead failed
before handing over.`, `the lead ended without handing over.`, and for legacy runs `the agents
finished; their changes wait for your review.` or `the run finished with nothing to review.`
