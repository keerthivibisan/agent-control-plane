# Workflow graph (WG series): status

Coordinator-owned. **Paused 2026-10-18: resume from [RESUME.md](RESUME.md).** Plan:
[README.md](README.md). Decision:
[ADR-0023](../decisions/0023-editable-workflow-graphs.md). Branches `wp/wg-<id>-<slug>` come off
`feature/workflow-graph` (from `main` `b6a1f27`) and are merged back with
`--ff-only` after review.

| WP   | Title                                                                   | After     | Status          | Branch            | Merged    |
| ---- | ----------------------------------------------------------------------- | --------- | --------------- | ----------------- | --------- |
| WG-0 | ADR-0023, graph contract, DTOs, `tightenMode`, docs                     | —         | **done**        | wp/wg-0-contracts | `5f6c1e8` |
| WG-A | Core: validate, `canConnect`, compile, migrate-v1, templates; generator | WG-0      | **done**        | wp/wg-a-core      | `1da44e6` |
| WG-B | Engine: program-driven stages, routes a/b/c, per-node modes; simulator  | WG-A      | **done**        | wp/wg-b-engine    | `eb8276a` |
| WG-C | Server, db and adapter; API fuzz                                        | WG-B      | **done**        | wp/wg-c-server    | `4742d8d` |
| WG-D | Web: graph editor, wizard template step                                 | WG-A      | **done**        | wp/wg-d-editor    | `f2a1211` |
| WG-E | Web: live run graph, run options "at most", copy                        | WG-C DTOs | **done**        | wp/wg-e-live      | `059820b` |
| WG-V | Verification: e2e per template; consented real runs a, b, c, mixed      | all       | **in progress** | wp/wg-v-verify    |           |

## Owner decisions (2026-10-17)

- **Building blocks with rules:** a palette with validated connections, not free-form.
- **Templates:** offered at project creation and on the Workflow page, or build your own.
- **Approval modes:** each agent node sets its own; ticket and run settings only tighten it.
- **Sandbox:** a node configured as Full auto keeps the OS sandbox when tightened.
- **Plan auto-approval:** decided by the plan gate's switch.
- **Helpers:** a helper pool plus named helpers.
- **Correctness:** prove it with a simulator, bounded exploration, generated and mutated graphs,
  exhaustive small graphs and golden version 1 traces (README "Graph correctness").
- **Coordinator defaults:**
  - in loop (c) the lead is told each round;
  - "Lead reviews" stays as a ticket or run override;
  - a plan step with no matching helper node is refused, with the list of helper nodes.

## Log

- 2026-10-17 Plan approved by the owner. `release/0.2.0` and `feature/workflow-graph` created from
  `main` `b6a1f27`. WG-0 started.
- 2026-10-17 WG-0 merged (`5f6c1e8`): graph contract, DTOs, ADR-0023 (accepted), docs.
  - Coordinator change: the tool fields (`helper?`) and the `reviewer` decider moved to WG-B,
    because they mean something only once the engine uses them.
  - Coordinator check: 2,635 tests.
- 2026-10-17 WG-A started.
- 2026-10-17 WG-A merged (`1da44e6`): `canConnect`, `validateWorkflowGraph`, `compileWorkflow`,
  `migrateWorkflowV1`, templates, and the seeded generator, mutants and small-graph enumeration.
  - All 2,304 version 1 combinations migrate with no issues; 2,000 generated graphs and all their
    mutants pass; 3,516 enumerated graphs; every structural issue code is reached.
  - Decisions accepted by the coordinator:
    - the plan path is `ticket → planner → plan-approval → lead`, or `ticket → lead →
plan-approval` without a planner;
    - cycles are checked over `flow` and `merge` edges;
    - reserved helper labels match exactly;
    - `maxReworkRounds` replaces rounds on existing rework edges and adds none.
  - Coordinator check: 2,717 tests.
- 2026-10-17 WG-B (engine and simulator) and WG-D (editor) started in parallel.
- 2026-10-17 WG-D in review (`cf2424f`): graph editor, Project defaults card, wizard template step;
  2,725 tests; workflow e2e 6/6 on mocked routes.
  - Held until WG-C serves `/workflow-graph`: against a real server the page would fail to load.
  - Before merging, WG-D rebases on WG-C and updates the three e2e specs that drive the old page
    (`review-loop`, `workspace`, `review-loop-live`), so the full e2e suite stays green.
  - Decisions accepted:
    - a 422 shows the issues from `…/validate`;
    - the template choice is in wizard step 2;
    - the default choice saves nothing.
- 2026-10-18 WG-B merged (`eb8276a`): the program-driven engine.
  - It adds named helpers, review routes a, b and c (`decidedBy: reviewer`), a mode per agent
    with `autoMode` and `sandbox`, plan auto-approval from the gate, and
    `deriveRunWorkflowGraph`.
  - **Golden traces:** 267 version 1 traces were recorded on the unchanged engine and stay
    identical.
  - **Correctness:** the simulator checks 9 invariant families on every step. Exploration covered
    the templates, the 32 migrated loop workflows and 200 generated graphs. Of the small graphs,
    1,172 accepted ones explored clean and 2,344 rejected ones were refused. No validator gap was
    found.
  - **Edits outside its paths (approved):** the `copy.ts` decider label, and the db stage parser,
    which now accepts node ids.
  - Coordinator check: 3,908 tests.
- 2026-10-18 Coordinator contract (`PlanStepSchema.helper?`, WG-B proposal a): a stored plan keeps
  each step's helper node. 3,909 tests.
- 2026-10-18 WG-C started.
- 2026-10-18 WG-E started in parallel with WG-C, against the DTOs with mocked routes.
- 2026-10-18 **Branch flow (owner decision).**
  - Coordinators and agents never touch `main` (no commit, merge or reset).
  - `release/0.2.0` (from `main` `b6a1f27`) is the integration branch. `feature/workflow-graph`
    merges into it when the feature is done.
  - The MR from `release/0.2.0` to `main` is always raised in GitHub, and the owner merges it
    there. `main` changes only through that merge.
- 2026-10-18 Docs merged (`cb9c4c2`, owner request).
  - Added: ADR-0001's "why TypeScript" amendment, `BUILD.md`, `START.md`, a README landing page
    with 8 sample-data screenshots, and a reproducible screenshot spec
    (`e2e/readme-screenshots.config.ts`, which runs only with `ACP_README_SHOTS`).
  - Coordinator fix: the app reads the first 64 KB of every session file to find its folder, and
    reads the rest only for added projects.
  - Coordinator follow-up (`d38ce0e`): stale facts in `AGENTS.md` and `CLAUDE.md`.
  - 3,909 tests; full e2e 62/62 (the docs agent's run).
  - **At release:** add the workflow-graph section at the README placeholder, re-run the screenshot
    spec so the Workflow shot shows the editor, bump the badges, and refresh the stale
    `docs/roadmap.md` and `docs/architecture.md` headers.
- 2026-10-18 **Paused by the owner.** WG-C (tasks 1–5 committed; fuzz and scenario tests
  uncommitted) and WG-E (main slice committed; e2e in progress) were asked to stop and record
  "Resume here" in their progress files. WG-D is held for WG-C. Resume steps are in
  [RESUME.md](RESUME.md).
- 2026-10-18 Paused states recorded in RESUME.md:
  - WG-C: `dd05a0b`, with 2 test files uncommitted and the open `ManagedAgentSpec.sandbox?`
    proposal;
  - WG-E: `d539e7d`, clean, only the review hand-off left; its 2 questions are answered in
    RESUME.md.
- 2026-10-20 **Resumed by the owner.**
  - `start.sh` added (`176ddd3`): one command to set up Node 22 and pnpm 10.26 and start the app;
    README and START.md lead with it.
  - Coordinator contract (`1a341dc`): `ManagedAgentSpec.sandbox?`, accepting WG-C proposal 1, so a
    tightened Full auto block keeps the sandbox with `default`.
  - WG-C resumed: wire `sandbox`, fix the mixed-mode scenario test, docs, review.
  - WG-E resumed: its 2 questions answered, then task 9.
  - Next: merge WG-C, then WG-E, then rebase WG-D (3 e2e specs), then WG-V.
- 2026-10-20 WG-E merged (`059820b`).
  - It adds the live run graph on the ticket page (block states, agents, per-run mode, the
    "Sandboxed" marker, direct rework), run options as "at most" with "No limit" and a no-effect
    note, the review agent as the decider on change cards, and "Used by" naming blocks. It falls
    back to the v1 view on 404/409.
  - Coordinator check: 3,940 tests; full e2e 65/65 (ports 7931/7941).
  - To check in the real app before release: the Start dialog screenshots open with a large blank
    band at the top (possibly the screenshot crop).
- 2026-10-20 **No-regression gate added** (owner: "make sure we don't break anything"); see
  RESUME.md Step 4b. The owner **consented** to testing the new build on a copy of their data
  (online backup, other ports, empty Claude dir, counts only, copy deleted after), to run after
  WG-C and WG-D merge.
- 2026-10-20 WG-C merged (`4742d8d`).
  - **db:** stores v1 or v2 workflows; the run snapshot gains `graph` and `graphContext`.
  - **Routes:** `/workflow-graph` (GET, PUT with 422, `/validate`) and the run graph route.
  - **Runs:** graph runs with ticket and run ceilings, and `approvalPolicy.mode` is the tightened
    mode. A mode applies per agent at the gate, the allowlist and launch. A tightened Full auto
    block keeps the sandbox in `default`, so the fail-closed path is gone.
  - **Tests:** the API fuzz (50 valid graphs, over 250 mutants); scenarios a, b and c to the
    owner's merge; a mixed-mode run; restart.
  - **Coordinator review:** the adapter prefers `sandbox` (the stricter choice) if both fields are
    ever set; read-only roles and follow-ups get neither.
  - **Coordinator fix (`4742d8d`):** 3 web e2e specs read the v1 live view and the v1 "used by",
    and now read `live-block-<node>` and blocks. Clicks on agent buttons are scoped to the agent
    tree, since the live graph has a button with the same name.
  - Coordinator check: 4,001 tests; full e2e 65/65.
- 2026-10-20 WG-D resumed: rebase on WG-C and WG-E, update the Workflow-page e2e steps.
- 2026-10-20 WG-D merged (`f2a1211`).
  - It adds the graph editor on the real endpoints and the wizard's template step.
  - Three e2e specs now drive the real editor, and a new `workflow-live` e2e project covers
    default, v1 and v2 projects, saving, a real 422, the v1 409 and the wizard, against the real
    server.
  - The dead v1 client code is removed; the core v1 DTOs stay for WG-V.
  - Coordinator check: 4,009 tests; full e2e 71/71 (ports 7931/7941).
  - Screenshots weren't viewed by the coordinator (a read setting blocks files outside the main
    repo). The UI is checked in the browser in WG-V.
- 2026-10-20 WG-V part 1 running in `../acp-wg-v`: the upgrade test, the data-copy check script,
  and the real-run driver (prepared, with a fake-adapter dry run).
- 2026-10-20 **WG-V part 1 stopped by the owner** mid-work. State in `../acp-wg-v` (`wp/wg-v-verify`):
  - committed: only the claim (`ff3531d`);
  - written, not committed: `packages/server/tests/verification/workflow-graph/`
    (`upgrade-from-0.1.0.test.ts`, `v010-fixture.ts`, `v010-readers.ts`, `harness.ts`,
    `owner.ts`, `autopilot.ts`);
  - **a real bug the upgrade test found**, with its fix and regression test uncommitted. A run
    reloaded from the database (after a restart, or an old v0.1.0 run's page) has no
    `reviewsAgentRunId` on its change reviewers, so `deriveRunWorkflowGraph` showed the review
    block as "skipped" with no agent. Fix: `run-workflow.ts` also matches a reviewer by its stored
    `stage`. The test is `orchestrator/tests/graph-correctness/live-state-reload.test.ts`, which
    compares the reloaded and live graph views at every idle step of every golden case.
  - **To resume:** run that test and the check, commit the fix and the upgrade test, then the
    data-copy script and the real-run driver (RESUME.md Step 4b).
- 2026-10-20 **Owner decision: all v0.2.0 work lives on `release/0.2.0`**, and `main` is never
  touched.
  - `release/0.2.0` was fast-forwarded to all the work (`bfe2c3b`). The merged
    `feature/workflow-graph` branch is deleted.
  - `wp/wg-*` branches now merge straight into `release/0.2.0`, and the owner raises the PR to
    `main` in GitHub.
  - Worktrees moved **inside the repo**, to `.claude/worktrees/` (git-ignored), as in v0.1.0:
    `wg-coord` has `release/0.2.0` checked out, and `wg-v` has WG-V. Worktrees beside the repo
    made every agent action count as outside the session, which caused the permission prompts and
    blocked reads. The finished `acp-wg-a`…`e` worktrees were removed.
