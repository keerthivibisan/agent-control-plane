# H-B (with H-C)

> Progress file for H-B and H-C (one branch, so the engine/server interface stays consistent).
> Only its agent edits it. Plan: [../README.md](../README.md) (part 5, the harness in the workflow).
> Binding: [ADR-0027](../../decisions/0027-harness-setup-and-check-blocks.md), with ADR-0017,
> ADR-0021 §3–4, ADR-0023 and ADR-0026 §4. Contracts from H-0 (`42bfbab`), core logic from H-A
> (`0267b96`).

| Field  | Value                                                                                    |
| ------ | ---------------------------------------------------------------------------------------- |
| Status | review                                                                                   |
| Branch | `wp/h-bc-2` (continues `wp/h-bc-server-engine`), rebased on `release/0.3.0` at `16cd046` |

## Done

### Database (migration 0010, additive)

- `check_runs.place` (`change` | `merge` | `branch` | `main`, nullable) and
  `check_runs.block_node_id` (nullable); rows from before 0010 read without them.
- `setup_runs`: one row per setup step run (project, run, agent run, step id and name, status,
  exit code, duration, the redacted last 16 KiB of output, start, commit), cascading with its run
  and agent run. `HarnessRepositories.setupRuns`: `insert`, `getById`, `listForRun`,
  `listForAgentRun`, `listForProjectMain` (newest first). Upgrade from 0009 tested.

### Engine (H-C)

- Effect `run-change-checks` `{ agentRunId, commit, blockNodeId, select }`: a sealed change whose
  node flows into a change block waits in `ready` (`EngineChange.blockChecks: 'pending'`).
- Command `changeChecksFinished(state, agentRunId, { commit, passed, failed: FailedCheck[] })`:
  pass → the normal review route; fail → the block's route (helper: a rework turn of the same
  helper with the failing checks and the last 4 KiB of each output, counted in
  `EngineChange.checkRounds` against the block's `maxRounds`, the lead told each round, the lead
  decides when rounds run out; lead: the lead decides with the failure note; owner: needs-owner).
- Merge block with `onFailure: 'owner'`: failed checks send the change to needs-owner.
- Effect `run-branch-checks` `{ blockNodeId, select }` when the final chain reaches a branch block
  that has a final stage after it (a block right before the owner's merge has no effect: the tip
  checks at review are its run).
- Command `agentSetupFailed(state, agentRunId, reason | { reason, outputTail }, ctx)`: a STARTING
  helper or tester whose setup failed never starts; the lead gets the reason and the end of the
  step's output (≤ 4 KiB).
- Restart: a pending change block result is dropped (the owner decides the change, as for
  pending merge checks).

### Server

- **Setup runner** (`harness/runner.ts` `runSetup`): ADR-0017's policy (argv, no shell, a bare
  command name, its own process group, the filtered environment, timeout kill of the group, the
  redacted last 16 KiB); one command at a time with the checks; steps in order, the first that
  does not pass stops the rest; `network: true` while the project's `setupNetwork` is not on is
  recorded `refused` with a plain reason and never spawned.
- **Where setup runs:** in a new helper's or tester's worktree before the agent starts (never on a
  rework turn, a follow-up, or for the lead, planner or reviewers; `control/service.ts`
  `setupWorktree` hook); in each fresh check checkout before its checks (the ticket branch tip,
  "Run checks now" on main); never in the owner's checkout. A failed or refused setup: the agent
  does not start (the lead and the ticket get a readable reason); tip and main checks are recorded
  as not run (`skipped`, or `interrupted` when the app stopped). Every step is stored.
- **Outputs** (`workspace/setup-outputs.ts`, `manager.ts`): the outputs declared by the harness
  file at the worktree's base commit and in the owner's checkout are excluded from staging,
  unstaged if the agent staged them, ignored by the "unsealed" check, and a branch whose history
  touched them is refused (`invalid-workspace`), like `.acp-attachments`.
- **Briefs:** an editing agent's first brief gets 1–2 lines, only with a harness file: the setup
  steps that ran, and the checks it may run with their exact commands.
- **Blocks** (`harness/blocks.ts`, `CheckSpec`): change block = its selection runs and gates in
  the helper's worktree, result (failing names, exit, last 4 KiB each, redacted) to
  `changeChecksFinished`; a pass starts the merge block's early run (checks already passed on the
  commit are not rerun). Merge block = `merge_change`'s gate runs and gates on its selection
  (`required` keeps the old behaviour: every check runs, the required ones gate), place `merge`.
  Branch = the tip runs required ∪ the branch block's selection with place `branch` and its
  `blockNodeId`; the owner's merge gate stays the required checks. Main = place `main`, setup
  first.

### API (as the merged web calls it)

- `GET /api/projects/:id/harness` → `HarnessStatusDto` with `setup` (the declared steps).
- `GET /api/projects/:id/harness/checks` → `CheckRunDto[]` for main, with `place: 'main'`.
- `POST /api/projects/:id/harness/checks` (CSRF, `{}`) → `CheckRunDto[]`: setup, then checks.
- `GET /api/projects/:id/harness/setup-runs` → `SetupRunDto[]`, the latest main setup runs,
  newest first (404 for an unknown project).
- `PUT /api/projects/:id/setup` with `setupNetwork`; absent keeps it, and absent approvals,
  allowlist and branching are kept.
- `TicketDetailDto.setupRuns`: the current run's setup runs (agents' worktrees and tip checkouts).
- `CheckRunDto.place` / `blockNodeId` on every run's check list.

### Real-run driver

- `drive.ts --harness` (with `flow.ts`): the harness file gains a setup step (no network, output
  `.prepared`) and labelled checks (`test` fast and required, `full` full); the graph gains a
  fast change block on each helper (back to the helper, 1 round) and a full branch block before
  the owner's merge. Asserts setup once per editing worktree and never for reading roles, briefs,
  block runs at the right places, the tip checkout set up, outputs never committed nor in the
  owner's checkout; in the dry run each helper's first turn fails the fast check, so the block
  sends it back. Dry run tested (`drive.test.ts`, scenarios a and mixed, and the command line). No
  real run was made.

## Decisions

- The branch block's gate stays the required checks (ADR-0027 §6); its other picks run and are
  shown, not enforced.
- Outputs are read from the harness file at the worktree's base commit and from the owner's
  checkout (whose setup ran), normalised; an output naming the project folder itself is ignored;
  pathspecs are `literal`.
- Setup interrupted by the app's shutdown records the checks `interrupted` (WG-F3), not skipped.
- The change block's no-check-service path reports a pass after the effect, never inside it.

## Tests

- db: `migration-0010.test.ts`, schema snapshot.
- orchestrator: `check-blocks.test.ts` (13), simulator invariants, `generated-checks.test.ts`
  (`generateValidGraph(seed, { checkBlocks: true })` seeds 1–60); golden traces byte-identical
  (no snapshot changed).
- server: `harness/setup-runner.test.ts` (8), `harness/main-checks.test.ts` (+2),
  `workspace/ticket-branch.test.ts` (+3 outputs), `board/harness-history.test.ts` (+2 API),
  `board/harness-blocks.test.ts` (6: setup and briefs, refused and failed setup, change block back
  to the helper, merge block selection and "ask me", branch block on the tip),
  `real-run/drive.test.ts` (+2 `--harness` dry runs and the command line).

## Checks

Lean verification: `pnpm -r typecheck` ✓; eslint and prettier on every changed file ✓; db
235/235 ✓; orchestrator 2322/2322 ✓ (CI mode: golden, legacy snapshot, graph-correctness);
server `tests/board tests/control tests/workspace tests/harness` 363/363 ✓; `drive.test.ts` 7/7 ✓;
`drive.ts --scenario a --dry-run --harness` exit 0. Full `pnpm check` and e2e are the
coordinator's.

## Work log

- 2026-10-23: branch from `release/0.3.0`; migration 0010 and the setup runs repository.
- 2026-10-23: engine: change blocks, merge block owner route, branch block effect, setup failure.
- 2026-10-23: paused by the owner with the server part in progress.
- 2026-10-23: resumed on `wp/h-bc-2`, rebased on `release/0.3.0` (`16cd046`); server finished
  (setup runner, outputs, blocks, API, briefs), tests, the driver's `--harness`; status review.
