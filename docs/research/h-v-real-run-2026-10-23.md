# H-V real run: harness setup and Checks blocks (2026-10-23)

The owner consented in chat on 2026-10-23 ("yes, run the real test"). The run used `release/0.3.0`
at `602c073` with the WG-V driver `ACP_REAL_RUN=1 --scenario a --harness`. Scenario a has a lead
that reviews each change and a helper pool. The harness had:

- one setup step with no network;
- a fast labelled check and a full check.

The workflow had:

- a Checks block on the helper's change (failures back to the helper, 1 round);
- the block before the lead's merge;
- a block on the ticket branch.

It ran on a throwaway temp repo and data dir with an empty Claude dir and free ports. It used
25,249 budget tokens (lead 13,979, helper 11,270) and reached the owner's merge. All 20 driver
assertions held, including the 10 for the harness:

| Assertion                     | Result                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| setupRanInEachEditingWorktree | true: one setup run in the helper's worktree, passed          |
| noSetupForReadingRoles        | true: none for the lead                                       |
| editorsBriefedWithChecks      | true: the helper's brief listed the checks and commands       |
| readersNotBriefedWithChecks   | true                                                          |
| changeBlockRan                | true: the fast check ran on the sealed change (`change`)      |
| branchBlockRanOnTip           | true: both checks ran on the tip (`branch`)                   |
| tipCheckoutSetUp              | true: setup ran in the tip checkout before its checks, passed |
| onlyKnownPlaces               | true                                                          |
| outputsNeverCommitted         | true: no commit on any branch holds the setup's output        |
| outputsNeverInOwnerCheckout   | true                                                          |

Check runs by place: `change` 1 (passed), `merge` 1 (passed), `branch` 2 (passed).

## Observations

- **No failure route was exercised.** The helper's change passed the fast check on its first try,
  so the change block did not send it back. That route is covered by the engine and server tests
  and by the driver's dry run, which scripts a failing first turn.
- **The lead merged the change** after the merge block passed. The owner's merge then went
  through with the required checks passing on the tip.
- The temp folders were deleted after reading the summary.
