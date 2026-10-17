# WG-A: Core logic

> Progress file for WG-A. Only the agent working on WG-A edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-A row and the "WG-0 refinements".

| Field   | Value                                          |
| ------- | ---------------------------------------------- |
| Status  | review                                         |
| Owner   | WG-A agent (Claude Code)                       |
| Branch  | `wp/wg-a-core` (from `feature/workflow-graph`) |
| Started | 2026-10-17                                     |
| Updated | 2026-10-17                                     |

## Tasks

- [x] 1. `canConnect`: the edge-type matrix, self and duplicate edges, unknown nodes
- [x] 2. `validateWorkflowGraph`: every README §2 rule plus the refinements, deterministic order
- [x] 3. `compileWorkflow` and `WorkflowGraphInvalidError`: routes a, b, c, overrides, modes,
      plan auto-approval, pool limit, final stage order
- [x] 4. `migrateWorkflowV1`: lossless, node ids = v1 stage ids; golden tests for every v1
      combination
- [x] 5. Templates: `workflowTemplate`, `WORKFLOW_TEMPLATES`
- [x] 6. Test support: seeded PRNG, `generateValidGraph`, `GRAPH_MUTATIONS`,
      `enumerateSmallGraphs`
- [x] 7. Property tests (layer 3), small-graph agreement and rule coverage (layer 4, core part)

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                       | Commit  | Checks                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 2026-10-17 | Claimed WG-A                                                                                                                        | b12dc82 | format ✓ lint ✓ typecheck ✓ test 2635/2635 ✓ build ✓ |
| 2026-10-17 | `canConnect`, `validateWorkflowGraph`, templates (+ `migrateWorkflowV1`, which `todays-setup` uses; golden tests come with compile) | 06dbc83 | format ✓ lint ✓ typecheck ✓ test 2683/2683 ✓ build ✓ |
| 2026-10-17 | `compileWorkflow`, `WorkflowGraphInvalidError`; compile tests; golden migration tests (2,304 v1 combinations)                       | 069153e | format ✓ lint ✓ typecheck ✓ test 2708/2708 ✓ build ✓ |
| 2026-10-17 | Test support (PRNG, generator, mutations, small-graph enumeration); property and layer 4 tests; status `review`                     | (this)  | format ✓ lint ✓ typecheck ✓ test 2717/2717 ✓ build ✓ |

## Decisions and findings

- **Plan path (one definition):** with a planner `ticket → planner → plan-approval → lead`;
  without one `ticket → lead → plan-approval` (the lead writes the plan, so the gate ends its plan
  path). `canConnect` therefore allows `ticket → lead` and `lead → plan-approval` only without a
  planner, and `plan-approval → lead` only with one.
- **Edges are checked in order:** the validator checks edge `i` with `canConnect` against the nodes
  and the edges before it, as if the owner had drawn them in order. It reports exactly the code
  `canConnect` returns (`edge-unknown-node`, `self-edge`, `edge-not-allowed`, `duplicate-edge`) on
  that edge id, and every path rule reads only the edges that pass, so a refused edge is reported
  once.
- **Cycles:** checked over `flow` and `merge` edges. The change loop (assigns → review → findings,
  and rework) always goes through the lead and back by design, so including it would refuse every
  graph; its bounds are the rework rounds and the review-route rules.
- **Reserved helper labels** (`RESERVED_HELPER_LABELS`, compared trimmed, ignoring case and repeated
  spaces): the plan-step coordinator words (`lead`, `the lead`, `lead agent`, `planner`,
  `orchestrator`), `coordinator`, the other roles (`reviewer`, `change reviewer`, `code reviewer`,
  `tester`), the owner (`owner`, `you`) and the pool's generic names (`helper`, `helpers`,
  `helper pool`, `pool`). Only an exact match is refused: "Lead designer" is fine.
- **Mode warnings with an unknown project mode:** a node without its own mode is not guessed, so
  `plan-auto-without-full-auto` is raised only when every editing node's mode is known.
- **Compile overrides, read literally (refinement 7):** `maxReworkRounds` replaces the rounds of
  the rework edges that exist and adds none, so route (c) without a lead rework edge keeps
  `leadRounds: 0`. With `reviewer: 'lead'`, `leadRounds` is the lead rework edge's rounds (0 without
  one), or `maxReworkRounds` when set.
- **`changeReviewers`** in the program lists only the change reviewers some route uses (graph
  order), so it is empty under `reviewer: 'lead'`.
- **Golden tests mirror `stages.ts`:** core cannot import the orchestrator, so
  `tests/graph/migrate.test.ts` re-states `skillsFor`, `stageModelFor`, `stageAgentFor`,
  `changeReviewerLaunchFields` and `nextStage`'s order (code-review, then unit-tests). WG-B can
  cross-check the engine's own functions against the compiled program.
- **Test support is exported from `@acp/core`** (`createGraphRng`, `generateValidGraph`,
  `LEGAL_GRAPH_MOVES`, `GRAPH_MUTATIONS`, `enumerateSmallGraphs`) so WG-B's simulator tests can
  reuse it. It is pure and tree-shaken out of the web bundle when unused.
- **`enumerateSmallGraphs`** yields `{ name, graph }`: 3,516 graphs (1,172 valid). The full product
  of per-node choices (16 per editing node, up to 5 editing nodes) is too large, so each structure
  yields one legal baseline plus every other choice for one node at a time.
- **Rule coverage:** every structural error code is reached by some mutant or enumerated graph; no
  code is excluded. Shapes `WorkflowGraphSchema` already refuses (a mode on a read-only node, bad
  ids, more than 40 nodes or 120 edges) are not validator rules and have no mutant.

## Completion report — WG-A

1. **Summary:** core graph logic in `packages/core/src/workspace/graph/`: `canConnect`,
   `validateWorkflowGraph`, `compileWorkflow` (+ `WorkflowGraphInvalidError`), `migrateWorkflowV1`,
   templates, and seeded test support (generator, mutations, small-graph enumeration), with
   matrix, rule, compile, golden migration and property tests.
2. **Files:** created the graph modules `index.ts`, `graph-index.ts`, `connect.ts`,
   `validate.ts`, `compile.ts`, `build.ts`, `migrate.ts` and `templates.ts` in
   `packages/core/src/workspace/graph/`; the test support `rng.ts`, `graph-ops.ts`, `generate.ts`,
   `mutations.ts` and `enumerate.ts` in its `testing/` folder; and `helpers.ts` plus the
   `connect`, `validate`, `compile`, `migrate`, `templates` and `properties` test files in
   `packages/core/tests/graph/`. Modified `packages/core/src/index.ts` (one export line) and this
   file.
3. **Commands:** `pnpm check` from the worktree root: format ✓, lint ✓, typecheck ✓, test 2717
   passed (core 399, adapters/demo 12, adapters/claude-code 348, orchestrator 574, db 195, web
   708, server 481), build ✓. The graph tests add 82 tests and about 5.6 s to the core run.
4. **Acceptance criteria:** `canConnect` matrix: met (every triple vs an explicit table, with and
   without a planner). Every validation rule has a named valid and invalid test: met. Compile
   routes a/b/c, overrides, modes and sandbox, `planAutoApprove`, pool limit, stage order, throws
   exactly on validator errors: met. Golden migration for all 2,304 v1 combinations: met. Templates
   valid with zero issues under Auto edits: met. Property layer 3 (2,000 seeds, every mutant,
   agreement) and layer 4 core part (errors ⇔ compile throws, rule coverage): met.
5. **Assumptions:** listed under "Decisions and findings" above (plan path, cycle scope, reserved
   labels, edge order, override reading, used-only change reviewers).
6. **Contract changes:** none needed.
7. **Known gaps / follow-ups:** the golden tests mirror `stages.ts` (core cannot import the
   orchestrator); WG-B should cross-check the engine's functions against the compiled program.
   The simulator-backed soundness and completeness checks over `enumerateSmallGraphs()` and the
   generator are WG-B's.
8. **Next:** WG-B (engine) on top of `compileWorkflow`; WG-D can build the editor on `canConnect`,
   `validateWorkflowGraph` and `workflowTemplate`.
