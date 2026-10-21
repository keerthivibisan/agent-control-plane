# WG-V real runs: editable workflow graphs (2026-10-21)

The owner consented in chat (2026-10-21, "run all four after the fixes merge"). The runs used
`release/0.2.0` at `c14f334`, after WG-F and WG-F3 merged, with the driver
`packages/server/tests/verification/workflow-graph/real-run/drive.ts` (`ACP_REAL_RUN=1
--scenario <id>`).

Each run had:

- a throwaway temp git repo with a tiny project and harness checks;
- a temp data dir;
- an empty Claude dir;
- free ports.

The runs were sequential. Only the aggregate JSON below was recorded: no prompts, replies or tool
output.

## Results

| Scenario | Graph                                                                        | Duration | Budget tokens | Reported cost (estimated) | All assertions |
| -------- | ---------------------------------------------------------------------------- | -------- | ------------- | ------------------------- | -------------- |
| a        | lead reviews (route a)                                                       | 63 s     | 18,429        | $0.34                     | ✓              |
| b        | change reviewer → findings → lead (route b); Full auto pool tightened        | 73 s     | 31,684        | $0.43                     | ✓              |
| c        | reviewer ↔ helper loop with direct rework (route c)                          | 81 s     | 19,474        | $0.33                     | ✓              |
| mixed    | Manual named helper `frontend`, Full auto pool, Auto edits tester; plan auto | 115 s    | 34,946        | $0.84                     | ✓              |

The four runs used about 105k budget tokens. The reported cost is the provider's figure, an
estimate that is never summed into usage, about $1.94 in all. Every run completed, the ticket ended
Done, and the ticket branch was merged by the owner, after which `main` sat at the merged commit.

## What the runs show

The **permission mode** comes from each session's `system/init`.

| Run     | Agent                                                   | Mode      | Sandbox |
| ------- | ------------------------------------------------------- | --------- | ------- |
| all     | lead and every reviewer                                 | `default` | no      |
| a, b, c | worker                                                  | `default` | b only  |
| b       | Full auto pool, tightened by the run's Auto edits limit | `default` | **yes** |
| mixed   | Full auto pool                                          | `auto`    | yes     |
| mixed   | Manual named helper                                     | `default` | no      |
| mixed   | tester                                                  | `default` | no      |

In b, a block configured as Full auto keeps the operating-system sandbox when tightened (ADR-0023
§5, `ManagedAgentSpec.sandbox`).

**Owner prompts per mode:**

- the Manual helper asked once for a write;
- Auto edits workers and the tester asked for `Bash` outside the harness checks, and the scripted
  owner denied those;
- Full auto never asked the owner (`fullAutoAskedOwner: 0`).

**Review routes:**

- **a:** the lead decided the change.
- **b:** the review agent approved, and the lead merged.
- **c:** the real reviewer approved the change on its first review, so no direct rework happened.
  The reviewer's own rework (`decidedBy: reviewer`) is shown by the simulator (layers 1, 2 and 4),
  the dry run of this driver, and the server scenario tests; a real reviewer only sends a change
  back when it finds a problem.
- **mixed:** the lead decided all three changes.

**Named helpers:** in mixed, the plan's steps went to the named helper `frontend` and to the pool,
as the plan named them. The plan was approved by the plan gate's automatic switch
(`decidedBy: auto`).

**Base branch:** `baseMovedBeforeOwnerMerge` was 0 in every run.

## Not covered

- A real direct rework (route c), as explained above.
- Real runs on Windows or Linux. These ran on macOS, with the same Claude Agent SDK version as
  RL-V.
