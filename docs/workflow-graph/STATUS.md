# Workflow graph (WG series): status

Coordinator-owned. Plan: [README.md](README.md). Decision:
[ADR-0023](../decisions/0023-editable-workflow-graphs.md). Branches `wp/wg-<id>-<slug>` come off
`feature/workflow-graph` (from `release/0.2.0`, from `main` `b6a1f27`) and are merged back with
`--ff-only` after review.

| WP   | Title                                                                   | After     | Status          | Branch            | Merged |
| ---- | ----------------------------------------------------------------------- | --------- | --------------- | ----------------- | ------ |
| WG-0 | ADR-0023, graph contract, DTOs, `tightenMode`, docs                     | —         | **in progress** | wp/wg-0-contracts |        |
| WG-A | Core: validate, `canConnect`, compile, migrate-v1, templates; generator | WG-0      | **in progress** | wp/wg-a-core      |        |
| WG-B | Engine: program-driven stages, routes a/b/c, per-node modes; simulator  | WG-A      | not started     | wp/wg-b-engine    |        |
| WG-C | Server, db and adapter; API fuzz                                        | WG-B      | not started     | wp/wg-c-server    |        |
| WG-D | Web: graph editor, wizard template step                                 | WG-A      | not started     | wp/wg-d-editor    |        |
| WG-E | Web: live run graph, run options "at most", copy                        | WG-C DTOs | not started     | wp/wg-e-live      |        |
| WG-V | Verification: e2e per template; consented real runs a, b, c, mixed      | all       | not started     | wp/wg-v-verify    |        |

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
