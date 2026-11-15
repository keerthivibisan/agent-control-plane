# FR-7 real run: a tester's failing tests routed by a When arrow to the Author (2026-11-14)

The owner consented in chat on 2026-11-14 to exactly one real run for FR-7, Claude only (every
agent Claude `haiku`, effort low; no Codex agent). It used `feature/workflow/failure-routing` (on
top of `4b7cdb7`) with the CX real-run driver and its new scenario:

```
ACP_REAL_RUN=1 ACP_REAL_RUN_SCENARIO=failure-routing ACP_REAL_RUN_CLAUDE_MODEL=haiku \
  ACP_REAL_RUN_LIMIT_MS=1500000 node --conditions=development --import tsx \
  tests/verification/codex/real-run/drive.ts
```

It ran once and was not repeated: the flow worked end to end. The four failed assertions are three
driver assertions that do not apply to a Claude-only scenario (fixed in the driver after the run)
and one that was stricter than the tester's report (below).

## Scenario

A version 3 graph (`failureRoutingGraph` in `record.ts`), saved with no graph issues:

- the `lead-only` template: the lead (Claude `haiku`, low) reviews and merges the helper pool's
  changes (Claude `haiku`, low; project mode Auto edits); no change reviewer, to save tokens;
- after the ticket merge, one tester (Claude `haiku`, low): `test` arrow from the ticket merge,
  `review` arrow to the lead, `flow` to the owner's merge;
- a **When arrow** from the tester, `on: ['tests-failed']`, to an **Author** block, `maxRounds: 2`,
  label "Fix failing tests", purpose "Fix the code the failing tests point at; don't change the
  tests".

Project limit 2 helpers (the tester holds a slot while it reports; the fixer needs another), budget
80,000 tokens per agent.

The ticket (owner text, synthetic) asks for `clamp(x, min, max)` in `src/clamp.mjs` and, on
purpose, a first version with min and max swapped (the exact line is given), corrected only when a
later fix request says so; it tells the lead to merge that first version and ask for the tests, and
the tester to run exactly `node --test test/clamp.test.mjs` and report with `report_test_results`.
The owner seeded `test/clamp.test.mjs` (three cases; the swapped version fails two) on `main`.

Harness (`FR_HARNESS`): the required check `node check.mjs` runs `test/*.test.mjs` with
`node --test` **except** `clamp.test.mjs`, plus a seeded smoke test (`clamp` is a function). Reason:
with the clamp test in the required check, the change's required check fails, the lead cannot merge
and reworks the helper itself, and the When arrow never fires. The clamp test is a second,
non-required check (`node --test test/clamp.test.mjs`), so the tester's exact command would run
without asking under Auto edits.

The driver approved the plan, denied every approval that still asked, and made the owner's merge of
the ticket branch into the throwaway repo's `main`. Nothing was pushed. The temp root (throwaway
repo, data dir, empty Claude dir) was under the home folder (`~/.acp-cx-real-run-VLdAP4`) and was
deleted at the end.

## Outcome

Run `COMPLETED`, ticket `DONE`, ticket branch merged into the throwaway `main` (branch deleted),
`src/clamp.mjs` on `main`, the required check passed. The When arrow did the routing, not the lead.

| Assertion                      | Result                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| helperMergedBeforeTester       | true                                                                                   |
| testerReportedFailedInTestFile | **false**: status failed, 1 failing test, not named in the seeded test file (Problems) |
| whenArrowStartedFixRound1Of2   | true: "fix started", round 1 of 2, no "to the lead" line                               |
| leadTold                       | true                                                                                   |
| exactlyOneFixer                | true: one new helper start after the results                                           |
| fixChangeMerged                | true                                                                                   |
| leadBriefHasWorkflowSection    | true: the lead's first prompt, 2,974 characters, holds "Your workflow"                 |
| runEnded, reachedOwnerMerge    | true, true                                                                             |
| ticketFilesOnMain, planDecided | true, true                                                                             |
| noAgentCouldNotStart           | true                                                                                   |
| noPlanOrCommentTextInLog       | true                                                                                   |
| noDiffTextInDatabase           | true                                                                                   |
| acpCheckoutUnchanged           | true                                                                                   |
| three Codex assertions         | **false** (driver: no Codex agent in this scenario; now skipped for it)                |

## Sequence (as the driver saw it, every 2 s)

1. lead started (plan: `submit_plan` refused twice, then accepted; approved by the driver);
2. helper started; its change went to review (change 0);
3. helper finished; the lead merged change 0 (the swapped version);
4. the lead called `request_review`; the tester started;
5. `test-results` comment: "Tests failed: 1 failing test.";
6. app comment: "When tests fail at Tester: Helpers is fixing it (round 1 of 2). The lead was
   told." (`failure-routed`, `fix-started`);
7. a new helper (the fixer, of the pool's node) started;
8. a change from the **tester** went to review (change 1, 1 file, checks failed), the tester
   finished, and the lead discarded change 1;
9. the fixer's change went to review (change 2, 1 file, both checks passed); the fixer finished; the
   lead merged it;
10. the lead called `request_review` again; the tester did **not** run again; the run went to
    REVIEW, the driver merged the ticket branch, the lead's session was ended.

Fix rounds used: 1 of 2. No reroute; nothing went to the lead as a decision. Outbox: 10 entries,
9 engine notices to the lead, all delivered.

Tool calls (names and outcomes only): lead `code_map` 1, `submit_plan` 2 error + 1 ok,
`start_agent` 1, `message_agent` 1, `view_change` 3, `merge_change` 2, `request_review` 2,
`discard_change` 1. Helper: `Write` 1, `Bash` 1 allowed and 1 denied, `report_work` 1. Tester:
`Write` 1, `Bash` 2 denied, `report_test_results` 1, `report_work` 1. Fixer: `Edit` 1, `Bash` 1
denied, `report_work` 1.

## Tokens per role (`budget.used`)

| Role   | Agents | Tokens                              |
| ------ | ------ | ----------------------------------- |
| lead   | 1      | 20,712                              |
| worker | 2      | 17,415 (helper 13,681, fixer 3,734) |
| tester | 1      | 13,922                              |
| total  | 4      | 52,049                              |

Claude Code reported an estimated cost of USD 0.042 over all four agents. No `usage_records` (the
driver points the app at an empty Claude directory, as in earlier runs).

## Problems found

### Observation: the tester did not run the test command it was told to

Both of the tester's `Bash` requests were denied by the gate (so neither was exactly
`node --test test/clamp.test.mjs`, the harness check that Auto edits allows), and it also wrote a
file. It reported 1 failing test (the swapped version fails 2), so its report came from reading the
code, not from a test run; its failing test's file was not `test/clamp.test.mjs` (the driver counts
only that path; the text was not recorded). The engine still found exactly one known author (the
helper's merged change), so the file or message named `src/clamp.mjs` or a path matching it. Not an
ACP bug; a `haiku` tester at low effort following the brief loosely. A stronger tester model, or a
tester brief that names the harness checks it may run, would make this deterministic.

### Gap (by design, worth a look): a tester's file write became a change the lead had to discard

The tester's `Write` produced a change of its own (change 1, checks failed) while the fix ran; the
lead discarded it. FR-1 tells the tester not to fix product code, but a tester may still write
(tests). Behaviour was correct; it cost one lead review.

### By design: the tester does not run again after the fix

`fix-turn.ts`: "The final stages do not run again." After the fixer's change merged and the lead
called `request_review` a second time, no tester started; the owner's merge was gated only by the
required checks (which do not include the clamp test here). The fix was right (the fixer's change
passed both checks, the clamp check included), but no tester confirmed it. If the owner wants a
retest after a routed fix, that needs a decision (an ADR-0038 amendment), not a bug fix.

### Observation: the non-required check ran on each change

Every change shows two check results: the helper's swapped change one failed and one passed, the
fixer's both passed. So the clamp acceptance check (non-required) ran on changes too, and the lead
merged the swapped change with a failed non-required check, as the ticket told it to. No bug: only
required checks gate a merge.

### Driver bug (fixed after the run)

The driver asserted the Codex checks (`everyCodexAgentStarted`, `codexWorktreeReadable`,
`codexUsageRecorded`) for every scenario; a Claude-only scenario has no Codex agent. They are now
left out for `failure-routing`. Not a reason to repeat the run.

## Driver change

`record.ts` gains the `failure-routing` scenario (`failureRoutingGraph`, `FR_NODES`, `FR_WHEN`,
`FR_TICKET`, `FR_HARNESS`), each start's prompt length and "Your workflow" marker (`promptChars`,
`workflowSection`), the content-free step list (`FrStep`: starts, finishes, test-results head lines,
the app's failure-routed lines, change states), `failureRoutingChecks` and `tokensByRole`.
`drive.ts` uses the scenario's harness, ticket, files and 2-helper limit, records the steps while it
polls, and adds the scenario's assertions. `drive.test.ts` covers the graph (valid, tester role,
When arrow, Claude only, harness) and the checks with fakes.
