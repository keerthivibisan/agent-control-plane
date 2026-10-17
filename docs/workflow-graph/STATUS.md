# Workflow graph (WG series): status

Coordinator-owned. Plan: [README.md](README.md). Decision:
[ADR-0023](../decisions/0023-editable-workflow-graphs.md). Branches `wp/wg-<id>-<slug>` come off
`feature/workflow-graph` (from `release/0.2.0`, from `main` `b6a1f27`) and are merged back with
`--ff-only` after review.

| WP   | Title                                                                   | After     | Status                      | Branch            | Merged    |
| ---- | ----------------------------------------------------------------------- | --------- | --------------------------- | ----------------- | --------- |
| WG-0 | ADR-0023, graph contract, DTOs, `tightenMode`, docs                     | —         | **done**                    | wp/wg-0-contracts | `5f6c1e8` |
| WG-A | Core: validate, `canConnect`, compile, migrate-v1, templates; generator | WG-0      | **done**                    | wp/wg-a-core      | `1da44e6` |
| WG-B | Engine: program-driven stages, routes a/b/c, per-node modes; simulator  | WG-A      | **in progress**             | wp/wg-b-engine    |           |
| WG-C | Server, db and adapter; API fuzz                                        | WG-B      | **in progress**             | wp/wg-c-server    |           |
| WG-D | Web: graph editor, wizard template step                                 | WG-A      | **review** (holds for WG-C) | wp/wg-d-editor    |           |
| WG-E | Web: live run graph, run options "at most", copy                        | WG-C DTOs | **in progress**             | wp/wg-e-live      |           |
| WG-V | Verification: e2e per template; consented real runs a, b, c, mixed      | all       | not started                 | wp/wg-v-verify    |           |

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
