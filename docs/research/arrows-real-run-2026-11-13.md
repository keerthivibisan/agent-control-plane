# AR-6 real run: researchers, one planner and a review fan-out (2026-11-13)

The owner consented in chat on 2026-11-13 to exactly one real run for AR-6. It used
`feature/workflow/arrows` (on top of `70fbe40`) with the CX real-run driver and its new scenario:

```
ACP_REAL_RUN=1 ACP_REAL_RUN_SCENARIO=arrows ACP_REAL_RUN_CLAUDE_MODEL=haiku \
  ACP_REAL_RUN_LIMIT_MS=1500000 node --conditions=development --import tsx \
  tests/verification/codex/real-run/drive.ts
```

It ran once. It was not repeated: the one failure is an ACP bug, not a driver bug (below).

## Scenario

A version 3 graph (`arrowsGraph` in `record.ts`), saved through `PUT /api/projects/:id/workflow-graph`
with no graph issues:

- two researchers, Claude (`haiku`, effort low) and Codex (`gpt-6.1-sol`, effort low), each with a
  `research` arrow into the planner, label "Repo layout", purpose "Tell the planner where math code
  and tests live";
- one planner (Claude `haiku`, low) with a `plan` arrow to Plan approval (asks the owner);
- the lead (Claude `haiku`, low) and the helper pool (Claude `haiku`, low; project limit 1 helper);
- the helper's change fanned out by two `review` arrows to two change reviewers, Claude (`haiku`,
  low) and Codex (`gpt-6.1-sol`, low); both send `findings` to the lead and both may rework the
  helper directly (1 round each);
- Checks, ticket merge, owner merge, done (the template's tail).

Project mode Auto edits, budget 80,000 tokens per agent, the tiny ticket (`add(a, b)` in
`src/math.mjs` and `test/math.test.mjs`). The driver approved the plan through
`POST /api/tickets/:id/plans/:planId/decision` (one planner: the normal plan route), denied every
approval that still asked, and made the owner's one merge of the ticket branch into the throwaway
repo's `main`. Nothing was pushed. The temp root was under the home folder (not `/tmp`) and was
deleted at the end.

## Outcome

Run `COMPLETED`, ticket `DONE`, ticket branch merged into the throwaway `main`, both ticket files on
`main`, the one required check passed. 15 of 17 assertions held; the two fan-out assertions failed.

| Assertion                        | Result                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| researchersOnBothProviders       | true                                                                                      |
| researchersStartedBeforePlanner  | true (both also finished before the planner started)                                      |
| researchNotes                    | true: 2 `research` comments, 1,610 and 1,024 characters                                   |
| planSubmittedAndApprovedByDriver | true: 1 plan, 1 step, approved by the driver (owner)                                      |
| reviewFanOutTwoProviders         | **false**: 1 `change_reviews` row for round 0, not 2                                      |
| reviewFanOutDecided              | **false** (follows from the above; the change was merged)                                 |
| runEnded                         | true                                                                                      |
| everyCodexAgentStarted           | true                                                                                      |
| noAgentCouldNotStart             | true                                                                                      |
| codexWorktreeReadable            | true: the Codex reviewer submitted its review                                             |
| reachedOwnerMerge                | true                                                                                      |
| ticketFilesOnMain                | true                                                                                      |
| codexUsageRecorded               | true                                                                                      |
| noPlanOrCommentTextInLog         | true                                                                                      |
| noDiffTextInDatabase             | true                                                                                      |
| acpCheckoutUnchanged             | true: this checkout's HEAD and status unchanged (no git write outside the throwaway repo) |
| planDecided                      | true                                                                                      |

## Start and finish order

From the adapters' own start and finish events, by provider and role:

1. Claude researcher started, finished;
2. Codex researcher started, finished;
3. Claude planner started, finished (after its plan was approved);
4. Claude lead started;
5. Claude helper started, finished;
6. Claude change reviewer started, finished;
7. Codex change reviewer started, finished;
8. the lead finished.

The researchers ran one after the other, not in parallel, and so did the two change reviewers. Both
are by design here: researchers and reviewers take helper slots, and the project allows 1 helper.

## Tool calls (names and outcomes only)

- Claude researcher: `code_map` 1, `report_findings` 1. Codex researcher: `code_map` 6 ok and 1
  error, `report_findings` 1.
- Planner: `submit_plan` 1 error then 1 ok (the first plan was refused and corrected).
- Lead: `start_agent` 1 error and 1 ok, `agent_status`, `view_change`, `merge_change`,
  `request_review` 1 each.
- Helper: `Write` allowed 2, `Bash` denied 2 (Auto edits asked; the driver denies), `report_work` 1.
- Claude reviewer: `submit_review` 1 (approve). Codex reviewer: `code_map` 1, `submit_review` 1.
- Outbox: 2 engine notices to the lead, both delivered.

## Tokens per provider

| Provider    | Agents | Budget tokens used                                                                   | Usage records                                                    |
| ----------- | ------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Claude Code | 5      | 55,323 (lead 13,611, planner 9,761, researcher 9,990, helper 12,301, reviewer 9,660) | none (see below)                                                 |
| Codex       | 2      | 52,538 (researcher 26,850, reviewer 25,688)                                          | 8 records, no nulls: input 51,811, output 727, cache read 48,128 |

The Codex budget total equals its usage records' input plus output. Claude Code reported an
estimated cost of USD 0.017 over the four Claude agents that ended with a result (the planner was
stopped after its plan, without one). Claude usage records come from observed transcripts; the
driver points the app at an empty Claude directory, so there are none, as in earlier CX runs.

## Problems found

### ACP bug: a review fan-out stores one `change_reviews` row per round, not one per reviewer

Both change reviewers submitted a review of round 0 (`submit_review:ok` on each), yet the change has
one `change_reviews` row. Cause, in `packages/server/src/control/store.ts`:

- each reviewer's `review-comment` effect calls `roundRow(runId, changeOf, round, { kind: 'agent',
agentRunId })`;
- `roundRow` returns the latest existing row of that change and round and ignores `agentRunId`, so
  the second reviewer's effect finds the first reviewer's row and calls
  `changeReviews.setVerdict(row.id, verdict, comment.id)` on it;
- the engine's `change-round` effect (`emitRound` in `packages/orchestrator/src/loop.ts`) carries
  only `change.reviewerAgentRunId`, the first reviewer started.

Effect: the one row names the Claude reviewer's agent run but holds the verdict and the comment id
of whichever reviewer submitted last (here the Codex one; both said approve, so the verdict did not
change). The first reviewer's findings comment still exists as a `review` comment, but no round row
points at it, and the change card shows one reviewer. With mixed verdicts the row's verdict would be
the last reviewer's, not the fan-out's combined verdict. The engine itself decided correctly: the
lead got one notice with both verdicts and merged.

Suggested fix (not made; product code is out of scope for this run): in a fan-out, key the round row
by `(change, round, reviewerAgentRunId)` for agent reviews, so each reviewer gets its own row, and
keep the lead's or owner's decision on the round's decision row; add a server store test with two
reviewers of one round.

### Observations (no bug)

- The planner's first `submit_plan` and one lead `start_agent` call were refused and corrected by
  the agents; refusals are the tools' normal answers.
- One Codex researcher `code_map` call failed and the next ones worked.
- The helper's two `Bash` requests were denied by the driver (no human), and the helper still
  finished; the required check passed on the ticket branch.

## Driver change

`record.ts` gains the `arrows` scenario (`arrowsGraph`, `ARROWS_NODES`), a start and finish
timeline in `observeManaged`, `arrowsChecks` and `tokensByProvider`. `drive.ts` records the
timeline, the research comments' lengths, the review rounds with each reviewer's provider and the
token sums, and checks that this checkout's HEAD and status do not change. `drive.test.ts` covers
the graph (valid, derived roles, labels, providers and models) and the new checks with fakes.
