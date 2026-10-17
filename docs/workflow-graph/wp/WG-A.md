# WG-A: Core logic

> Progress file for WG-A. Only the agent working on WG-A edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-A row and the "WG-0 refinements".

| Field   | Value                                          |
| ------- | ---------------------------------------------- |
| Status  | in-progress                                    |
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
- [ ] 6. Test support: seeded PRNG, `generateValidGraph`, `GRAPH_MUTATIONS`,
      `enumerateSmallGraphs`
- [ ] 7. Property tests (layer 3), small-graph agreement and rule coverage (layer 4, core part)

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                       | Commit  | Checks                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 2026-10-17 | Claimed WG-A                                                                                                                        | b12dc82 | format ✓ lint ✓ typecheck ✓ test 2635/2635 ✓ build ✓ |
| 2026-10-17 | `canConnect`, `validateWorkflowGraph`, templates (+ `migrateWorkflowV1`, which `todays-setup` uses; golden tests come with compile) | 06dbc83 | format ✓ lint ✓ typecheck ✓ test 2683/2683 ✓ build ✓ |
| 2026-10-17 | `compileWorkflow`, `WorkflowGraphInvalidError`; compile tests; golden migration tests (2,304 v1 combinations)                       | (this)  | format ✓ lint ✓ typecheck ✓ test 2708/2708 ✓ build ✓ |

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
