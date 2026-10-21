# WG-V: Verification

> Progress file for WG-V. Only the agent working on WG-V edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-V row and the "WG-0 refinements";
> [RESUME.md](../RESUME.md) Step 4 and Step 4b (the no-regression gate).

| Field   | Value                                    |
| ------- | ---------------------------------------- |
| Status  | review                                   |
| Owner   | WG-V agent, part 1 (Claude Code)         |
| Branch  | `wp/wg-v-finish` (from `wp/wg-v-verify`) |
| Started | 2026-10-20                               |
| Updated | 2026-10-21                               |

## State (2026-10-21): part 1 in review

- **Branch:** `wp/wg-v-finish`, rebased onto `release/0.2.0` (`022e30b`). Tasks 1–3 are
  committed; the coordinator's runs are below, under "For the coordinator".
- **Resumed 2026-10-21** from the paused worktree's uncommitted files. Running the dry runs found
  two driver bugs (no product bug): an approval was decided with `allow` instead of `approve`
  (400), and the base commit was taken before the owner's own skill commit, so (b) and (c)
  reported the base as moved. Both fixed in the driver.
- **Decisions:**
  - **Data-copy check:** "a non-empty `ACP_CLAUDE_DIR`" is read as a folder that has
    contents. Unset means an empty temp folder is made; an existing empty folder is accepted.
  - **The driver has two parts:** `flow.ts` (`driveScenario`, called by the test directly) and
    `drive.ts` (the command line: `--scenario a|b|c|mixed`, `--dry-run`, or `ACP_REAL_RUN=1`; it
    refuses both at once, neither, or a real run in CI).
  - **A dry run still uses the real Claude Code adapter's options:** each start is also handed
    to the adapter with a stub SDK `query` that records the options and ends at once, so the
    `permissionMode` and sandbox are the adapter's own. A real run keeps the real home folder
    only for Full auto's deny-read list.
  - **The scenarios:**
    - (a) `lead-only`;
    - (b) `todays-setup` with the pool set to Full auto and the run's ceiling at Auto edits.
      This is where "a tightened Full auto block gets the sandbox" is asserted.
    - (c) `reviewer-helper-loop` with a `review-tests` skill. The rework is scripted only in the
      dry run.
    - mixed: `lead-only`, with a Full auto pool, a Manual `frontend` helper, an Auto edits
      tester (the project's mode) and the plan gate on auto.
  - **How the owner answers approvals:** it allows only a Manual block's own edit tools
    (summary without `..`) and denies everything else.

Part 1 covers the server-side gate items: the upgrade test, the data-copy check script and the
real-run driver (prepared, not run). The e2e per template and the removal of the version 1
endpoints wait for WG-D (it is editing `packages/web/**`).

## Tasks

- [x] 1. Upgrade test `packages/server/tests/verification/workflow-graph/upgrade-from-0.1.0.test.ts`
      (Step 4b item 3, plus rollback item 5 as far as a test can prove it)
- [x] 2. Data-copy check script `.../workflow-graph/data-copy-check.ts` (Step 4b item 4; the owner
      consented on 2026-10-20), tested on the synthetic upgrade data dir
- [x] 3. Real-run driver `.../workflow-graph/real-run/drive.ts` for scenarios a, b, c and mixed
      (Step 4), with `--dry-run` on the fake adapter, tested in CI; commands, duration and token
      estimates below for the coordinator
- [x] 4. Status `review` with the AGENTS.md §9 report

## Work log (append-only; newest last)

| Date       | What was done                                                                                              | Commit  | Checks                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| 2026-10-20 | Claimed WG-V                                                                                               | ff3531d | format ✓ (this file only)                                                               |
| 2026-10-20 | Engine fix F1: a reloaded run's graph keeps its change reviewers (own commit)                              | f8dd7bc | format ✓ lint ✓ typecheck ✓ test orchestrator 2293/2293 ✓ build ✓                       |
| 2026-10-20 | Upgrade test from v0.1.0 (10 tests) with the v0.1.0 fixture, frozen v0.1.0 readers and the agent autopilot | (this)  | format ✓ lint ✓ typecheck ✓ test server 529/529 ✓ (upgrade file 5/5 runs green) build ✓ |
| 2026-10-21 | Resumed; rebased onto `release/0.2.0` `022e30b` (F1 is now `b37d235`, the upgrade test `46c9394`)          | —       | —                                                                                       |
| 2026-10-21 | Data-copy check script and its test on the synthetic copy (task 2); `tableDigests` streams rows            | 0403ade | format ✓ lint ✓ typecheck ✓ test 4551/4551 ✓ (server 531) build ✓                       |
| 2026-10-21 | Real-run driver with four dry-run scenarios and the command-line refusals (task 3); two driver bugs fixed  | 74eb80a | format ✓ lint ✓ typecheck ✓ test 4556/4556 ✓ (server 536) build ✓                       |
| 2026-10-21 | Status `review`; commands and estimates for the coordinator; finding F4 (a load flake, passed on rerun)    | (this)  | format ✓ lint ✓ typecheck ✓ test 4556/4556 ✓ build ✓; e2e 71/71 ✓ (ports 7731/7741)     |

## For the coordinator

Run everything from a worktree of this branch (or of `release/0.2.0` once it is merged), never
from the owner's checkout, with the toolchain on the path:

```bash
export PATH=<scratchpad>/bin:$HOME/.nvm/versions/node/v22.21.1/bin:$PATH   # Node 22.21.1, pnpm 10.26.1
pnpm install --frozen-lockfile
```

`<scratchpad>` is your session's scratchpad folder (absolute path). Nothing below uses ports 7420
or 5173.

### The data-copy check (Step 4b item 4; the owner consented on 2026-10-20)

Read-only on a copy, no agent run, about 1–5 minutes depending on the size of the owner's data
(well under a minute on the synthetic 29-project copy).

```bash
# 1. The copy, with SQLite's online backup (safe while the owner's app runs; WAL included).
#    Never inside ~/.agent-control-plane: the script refuses that.
mkdir -p <scratchpad>/acp-copy <scratchpad>/acp-copy-claude      # the second stays EMPTY
sqlite3 -readonly ~/.agent-control-plane/acp.sqlite ".backup '<scratchpad>/acp-copy/acp.sqlite'"

# 2. The check: the current server on the copy, on port 7781, with an empty Claude dir.
ACP_CLAUDE_DIR=<scratchpad>/acp-copy-claude \
  pnpm --filter @acp/server exec node --conditions=development --import tsx \
  tests/verification/workflow-graph/data-copy-check.ts \
  --data-dir <scratchpad>/acp-copy --port 7781 > <scratchpad>/acp-copy-check.json
echo "exit $?"     # 0 all passed, 1 a check failed, 2 refused (the reason is on stderr)
```

- **Read** `<scratchpad>/acp-copy-check.json`: `ok`, `assertions` (every GET answered as
  expected, every body parsed, no graph error issue, **no agent start**, today's repositories
  and v0.1.0's readers read every row), `counts`, `workflowGraphs.stored` and issue codes,
  per-route `checks`, `tablesChanged` (expected: at most `agent_runs` for a run that was in
  flight, `project_setup` for a project without a setup row) and `v010Readers`. Aggregates only;
  quote counts, never anything else.
- **What it touches:** only the copy. It starts the server in live mode on the copy with a temp
  home folder, the empty Claude dir and a managed adapter that refuses every start; startup
  cleanups only look under the copy's folder. The GETs read the owner's registered project
  folders (skills, agent files and git refs, read-only), as the app always does.
- **Rollback (Step 4b item 5)** next, on the same copy: start v0.1.0 (`main`) on it on free
  ports with `ACP_DATA_DIR=<scratchpad>/acp-copy` and the empty `ACP_CLAUDE_DIR`, and open the
  pages. The check above already reports `v010Readers.after` (expected: nothing unreadable,
  since the check only reads).
- **Afterwards**, once the counts are read, delete the copy:

  ```bash
  rm -rf <scratchpad>/acp-copy <scratchpad>/acp-copy-claude <scratchpad>/acp-copy-check.json
  ```

### The real runs (Step 4; ask the owner in chat before EACH one)

Each starts real `claude` processes through the Agent SDK on the owner's account. Without
`ACP_REAL_RUN=1` the driver refuses; with `CI` set it refuses. Every run uses a throwaway repo, a
temp data dir, an empty Claude dir and an ephemeral 127.0.0.1 port (printed on stderr: open it to
watch). The owner's side is played by the driver: it approves the plan (unless the gate does),
allows only a Manual block's own edits, denies every other prompt, merges or discards changes the
lead hands over, and makes the one merge of the ticket branch.

```bash
ACP_REAL_RUN=1 pnpm --filter @acp/server exec node --conditions=development --import tsx \
  tests/verification/workflow-graph/real-run/drive.ts --scenario a > <scratchpad>/wgv-real-a.json
echo "exit $?"     # 0 every assertion held, 1 one failed (named on stderr), 2 refused
```

Replace `a` with `b`, `c` or `mixed` (and the output name). The summary is aggregate only; the
temp folders are kept for inspection (paths on stderr; `real-run-summary.json` and `server.log`
in the data dir) unless `ACP_REAL_RUN_CLEANUP=1`. Time limit: `ACP_REAL_RUN_LIMIT_MS`, 30 minutes
by default, after which the run is stopped; Ctrl-C stops the run and the server. Remove the kept
folders afterwards.

Estimates, from RL-V's real runs (lead about 18k, a helper 5–14k, a change reviewer 4–11k budget
tokens; about 54–65k for two helpers and three reviewers). Each agent's budget is 80k, so the hard
ceiling is 80k × the number of agent sessions. Full auto's classifier calls are not counted.

| Scenario | What it shows                                                                                                                          | Agent sessions                                            | Expected time | Budget tokens (estimate) |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------- | ------------------------ |
| `a`      | Route (a): the lead reviews and merges; Auto edits                                                                                     | lead, 1 helper                                            | 5–10 min      | 25–35k                   |
| `b`      | Route (b): a change reviewer (review skill) reports to the lead; Full auto pool tightened to Auto edits keeps the sandbox in `default` | lead, 1 helper, 1 change reviewer                         | 6–12 min      | 30–45k                   |
| `c`      | Route (c): the reviewer sends the change straight back (likely, not forced), `decidedBy: reviewer`                                     | lead, 1 helper (plus a rework turn), 1–2 change reviewers | 8–15 min      | 40–60k                   |
| `mixed`  | Manual named helper (owner allows its edits), Full auto pool (sandbox, `auto`), Auto edits tester, plan gate on auto                   | lead, 2 helpers, 1 tester                                 | 10–20 min     | 45–65k                   |

All four: about 30–60 minutes and 140–205k budget tokens. In (c) a real reviewer may approve at
once; then `reviewerReworkedDirectly` is not asserted (dry run only) and the note should say so.
Check in each summary: `assertions` all true; `agents[].initPermissionModes` (from `system/init`)
equal to `permissionMode`; `prompts.byModeKindTool` (Manual edits asked and allowed, Auto edits
commands asked and denied, `fullAutoAskedOwner: 0`); `reviewRoutes.decidedBy`; `ticketBranch`
(`baseMovedBeforeOwnerMerge: 0`, `mainAtMergedCommit: true`); `tokens`. Write the note
`docs/research/wg-v-real-run-<date>.md` as for RL-V.

## Decisions and findings

### Data-copy check (task 2)

- **Refusals (exit 2, nothing printed on stdout):** a `--data-dir` that is, holds or is inside
  the real path of `~/.agent-control-plane` (a link to it too); a folder without `acp.sqlite`;
  no or a bad `--port`, and 7420 or 5173; an `ACP_CLAUDE_DIR` that is inside `~/.claude`, does not
  exist or is not empty (unset: a temp empty one is made).
- **Read-only:** GET routes only; agent starts are refused by the adapter and counted (must stay
  0); the server is closed in a `finally`, and its temp home, Claude and log folders are removed.
  The server's log goes to a temp file that is deleted, never to the output.
- **Output:** counts, pass/fail, HTTP status (and error code) counts, graph issue codes, table
  names with row counts, and the v0.1.0 readers' fixed reasons (schema paths with array positions
  blanked). The test checks that no project id, name or path, run or ticket id, ticket text or
  temp path appears.
- **Large data:** `tableDigests` streams each table's rows (rowid order) instead of one JSON string
  per table.

### Real-run driver (task 3)

- `flow.ts` holds the flow (`driveScenario`, also called by the test); `drive.ts` is the command
  line. The scenarios and decisions are listed under "State" above.
- **Base before the owner's merge** is the commit after the owner's own setup (the harness and
  skill commits), taken just before the ticket starts.
- The dry run (`drive.test.ts`, about 15 s for all four plus the command line) asserts, per
  scenario: the lead and reviewers are `default` with no sandbox; each editing agent's mode is
  within its node's; the sandbox exactly for Full auto blocks, and in (b) the tightened Full auto
  pool keeps it with `default`; Full auto never asks the owner; `main` does not move before the
  owner's merge, then sits at the merged commit; the plan gate is followed; the review route is
  followed and (c) records `decidedBy: reviewer` once; and the summary has no path, uuid or
  commit hash.

### Upgrade test (task 1)

`packages/server/tests/verification/workflow-graph/upgrade-from-0.1.0.test.ts`, about 15–20 s.

- **The v0.1.0 data dir** (`v010-fixture.ts`): 29 projects. 24 store a version 1 workflow, one
  per planner `lead`/`separate` × reviewer `agent`/`lead`/unset (a workflow stored before
  ADR-0021) × code review on/off × unit tests on/off, with the four approval modes in turn;
  every fourth has a committed skill, an agent file and models set, the next one names a skill
  that no longer exists. Plus `run-b` and `run-full` (version 1), `run-auto` and `run-legacy`
  (the default workflow) and `plain` (registered, no setup row at all). Runs: a legacy run
  (before ADR-0021), route b to the owner's merge, a stopped run, a control-panel run, a
  separate planner with a plan sent back, the lead reviewing with a rework round, the final code
  review and a tester; and a Full auto run (plan approved automatically, a reviewer's rework
  round) left **in REVIEW** at the upgrade. Five tickets have their own run options, two never
  started.
- **Decision: how the fixture is written.** Through the same routes v0.1.0's UI used, on
  version 1 workflows, by today's server with the fake adapter; then the snapshot keys v0.1.0
  never wrote (`graph`, `graphContext`) are removed. Hand-writing a dozen tables per run would
  test the fixture more than the upgrade, and v0.1.0's write path (the run store) differs from
  today's only in those keys (`git diff b6a1f27 -- packages/server/src/control/store.ts`;
  version 1 runs store no plan step `helper`). The frozen v0.1.0 readers then prove every row
  is v0.1.0-shaped before the upgrade starts.
- **Frozen v0.1.0 readers** (`v010-readers.ts`): `git diff b6a1f27 -- packages/db/src
packages/core/src` shows that only five stored columns are read differently since v0.1.0:
  `orchestration_runs.limits` (the snapshot; its v0.1.0 parser is copied verbatim, strict
  limits), `project_workflow.workflow`, `agent_runs.stage`, `change_reviews.decided_by` and
  `ticket_plans.steps`. Every other repository is byte-identical, so today's code reading a
  row is v0.1.0's read (`sweepRepositories`).
- **Agent autopilot** (`autopilot.ts`): plays the fake agents of one run from a script (plan,
  files per round, verdicts, lead decisions, tester, permission requests) through the fake
  adapter's channels only; the owner's part stays with the caller over HTTP. Shared with the
  real-run driver's `--dry-run`.
- **What it proves** (all pass): every project's `GET /workflow-graph` is 200 with `stored`
  `v1` (26) or `default` (3), no error issue, and the graph equals `migrateWorkflowV1` of the
  stored workflow; the missing skill only warns; the version 1 `GET /workflow` answers for all
  29; every old run's `GET /api/runs/:id`, `/workflow` and `/workflow-graph` are 200, the run
  graph equals its snapshot's workflow (with the run's review settings) migrated, and every
  agent sits on a node; the board, ticket lists, skills, agents and every ticket page answer,
  with each ticket's run options unchanged; the read-only visit changed only `agent_runs` (the
  restart recovery of the run in flight: status and end time, in values v0.1.0 knows) and
  `project_setup` (one default row for `plain`, as v0.1.0 does on first read); the run in
  flight completes with the owner's merge and keeps a graph-free snapshot; a new ticket on a
  version 1 project starts, reaches plan review and snapshots `graph` (equal to the project's
  graph) and `graphContext`; after a graph is saved, the version 1 `GET` and `PUT` answer 409
  `workflow_is_graph`.
- **Rollback (Step 4b item 5), what a test can prove:** after all of the above, today's
  repositories read every row, and v0.1.0's readers read every row **except exactly two**: the
  new run's snapshot and the project saved as version 2. See R1.

### Findings

- **F1, fixed (`f8dd7bc`, engine):** `deriveRunWorkflowGraph` put an agent on a change-reviewer
  node only when it had `reviewsAgentRunId`, which is not stored. After any restart, and on every
  old run's page after the upgrade, the review block showed no agent and "skipped" instead of
  "done". The node now also takes reviewers whose recorded stage is that node. Test:
  `live-state-reload.test.ts` (256 of 530 failed before, all pass after).
- **R1, not fixed (needs a coordinator decision): rolling back to v0.1.0 after using v0.2.0 is
  only partly safe.** v0.1.0's snapshot parser is strict, so every run v0.2.0 starts (its
  snapshot has `graph` and `graphContext`) is unreadable there; so is a project whose graph was
  saved (`{version: 2, graph}`). In v0.1.0 that fails, with a stored-value error, the run's page,
  its ticket's page (plans read the run snapshot) and the board's run load, and the project's
  Workflow page. Named helpers (`agent_runs.stage` such as `frontend`) and route (c) decisions
  (`decided_by: reviewer`) are unreadable there too. Data v0.2.0 only read stays readable, so
  the owner's copy check (read-only) is safe to roll back. Options: (a) say in the 0.2.0 notes
  that going back to 0.1.0 after running tickets on 0.2.0 is not supported; (b) a 0.1.1 that
  ignores unknown snapshot keys and unknown workflow versions. Recommended: (a) now, (b) only if
  the owner wants a way back.
- **F3, not fixed (pre-existing since v0.1.0, outside WG):** a check the server's shutdown
  stops is stored as `error` (`harness/runner.ts`, "Stopped before it finished"), and the
  ticket-branch gate treats any stored non-pass as failed. So an app stopped while the tip's
  checks run (for instance to upgrade) comes back with the owner's merge refused
  (`checks_failed`), leaving "merge anyway" or "request changes". Found as an intermittent
  failure of the upgrade test; the fixture now waits for the tip checks. Proposal: the gate
  treats a check stopped by a shutdown as missing, so the merge starts it again (as it does
  for a tip with no checks).
- **F4, not fixed (intermittent, under heavy load):** in one of four full `pnpm check` runs on
  2026-10-21 (load average about 20, other agents running suites), two server tests failed and
  passed again on the rerun and in the next full check: `workspace/manager.test.ts` "refuses
  when the base moved, unless integration is asked for" (a 5 s timeout; the file took 53 s), and
  the v0.1.0 fixture build in `data-copy-check.test.ts`. The fixture's Full auto run (`run-auto`)
  never reached REVIEW: the scripted lead's `merge_change` was refused again and again with "A
  required check failed on this change", although every round's files include `fixed.txt` (the
  check passes then). So a check on the reworked commit most likely ended as `error` or
  `timeout`, not `failed`, under load; the gate treats any non-pass as failed (as in F3). Not
  reproduced. If it comes back: record the check's stored status and notes in the fixture's
  timeout message.
- **Note:** a `GET` of a project with no setup row writes its default setup (`setupFor`), as in
  v0.1.0. The data-copy check reports which tables changed.
