# WG-V: Verification

> Progress file for WG-V. Only the agent working on WG-V edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-V row and the "WG-0 refinements";
> [RESUME.md](../RESUME.md) Step 4 and Step 4b (the no-regression gate).

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | in-progress                                      |
| Owner   | WG-V agent, part 1 (Claude Code)                 |
| Branch  | `wp/wg-v-verify` (from `feature/workflow-graph`) |
| Started | 2026-10-20                                       |
| Updated | 2026-10-20                                       |

Part 1 covers the server-side gate items: the upgrade test, the data-copy check script and the
real-run driver (prepared, not run). The e2e per template and the removal of the version 1
endpoints wait for WG-D (it is editing `packages/web/**`).

## Tasks

- [x] 1. Upgrade test `packages/server/tests/verification/workflow-graph/upgrade-from-0.1.0.test.ts`
      (Step 4b item 3, plus rollback item 5 as far as a test can prove it)
- [ ] 2. Data-copy check script `.../workflow-graph/data-copy-check.ts` (Step 4b item 4; the owner
      consented on 2026-10-20), tested on the synthetic upgrade data dir
- [ ] 3. Real-run driver `.../workflow-graph/real-run/drive.ts` for scenarios a, b, c and mixed
      (Step 4), with `--dry-run` on the fake adapter, tested in CI; commands, duration and token
      estimates below for the coordinator
- [ ] 4. Status `review` with the AGENTS.md §9 report

## Work log (append-only; newest last)

| Date       | What was done                                                                                              | Commit  | Checks                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| 2026-10-20 | Claimed WG-V                                                                                               | ff3531d | format ✓ (this file only)                                                               |
| 2026-10-20 | Engine fix F1: a reloaded run's graph keeps its change reviewers (own commit)                              | f8dd7bc | format ✓ lint ✓ typecheck ✓ test orchestrator 2293/2293 ✓ build ✓                       |
| 2026-10-20 | Upgrade test from v0.1.0 (10 tests) with the v0.1.0 fixture, frozen v0.1.0 readers and the agent autopilot | (this)  | format ✓ lint ✓ typecheck ✓ test server 529/529 ✓ (upgrade file 5/5 runs green) build ✓ |

## Decisions and findings

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
- **Note:** a `GET` of a project with no setup row writes its default setup (`setupFor`), as in
  v0.1.0. The data-copy check reports which tables changed.
