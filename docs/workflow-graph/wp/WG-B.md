# WG-B: Engine

> Progress file for WG-B. Only the agent working on WG-B edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-B row and the "WG-0 refinements".

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | review                                           |
| Owner   | WG-B agent (Claude Code)                         |
| Branch  | `wp/wg-b-engine` (from `feature/workflow-graph`) |
| Started | 2026-10-17                                       |
| Updated | 2026-10-18                                       |

## Tasks

- [x] 0. Golden traces (layer 5): a deterministic trace harness in
      `packages/orchestrator/tests/graph-correctness/`, snapshots recorded on the unchanged engine
- [x] 1. Contract commits (pre-approved): `helper?` on `start_agent` and `submit_plan.steps[]`;
      `'reviewer'` in `ChangeDeciderSchema`; core tests and the adapter's `start_agent` key pin
- [x] 2. The program: `RunState.graph?`/`graphContext?`, `programOf(state)` (memoized, v1 runs
      migrate their snapshot), `createRun` inputs
- [x] 3. Node-keyed agents: `EngineAgent.stage` is a node id; `launchFieldsFor(program, nodeId)`;
      `nextStage` over `program.finalStages`; `isSeparatePlanner` from `program.planner`
- [x] 4. Named helpers: `start_agent.helper`, label match, pool, refusal with the list; plan step
      resolution at submit; `maxInstances`; `canStartHelpers`; briefs list helper nodes
- [x] 5. Review routes a, b, c in `loop.ts` (per-decider rounds, `decidedBy: 'reviewer'`, info
      line to the lead)
- [x] 6. Approval per agent: `effectiveMode(state, agent)`, per-agent allowlist and Full auto,
      `autoMode`/`sandbox` on the launch effect
- [x] 7. Plan auto-approval from `program.planAutoApprove`
- [x] 8. `deriveRunWorkflowGraph(state)`
- [x] 9. Graph-correctness suite: simulator with invariants (layer 1), exploration (layer 2),
      small graphs soundness/completeness (layer 4); golden traces unchanged
- [x] 10. Status `review`, final `pnpm check`, completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                    | Commit  | Checks                                               |
| ---------- | -------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 2026-10-17 | Claimed WG-B                                                                     | c511ad5 | format ✓ lint ✓ typecheck ✓ test 2717/2717 ✓ build ✓ |
| 2026-10-17 | Golden v1 traces (267 cases) on the unchanged engine                             | e5d1c5d | format ✓ lint ✓ typecheck ✓ test 2985/2985 ✓ build ✓ |
| 2026-10-17 | Contract: `helper?` on `start_agent` and plan steps                              | 332ed22 | format ✓ lint ✓ typecheck ✓ test 2986/2986 ✓ build ✓ |
| 2026-10-17 | Contract: `reviewer` decider (+ the coordinator-approved copy.ts line)           | d710b66 | format ✓ lint ✓ typecheck ✓ test 2988/2988 ✓ build ✓ |
| 2026-10-18 | Program-driven engine; golden traces unchanged (v1 and migrated-graph runs)      | 7441bb2 | format ✓ lint ✓ typecheck ✓ test 3255/3255 ✓ build ✓ |
| 2026-10-18 | `deriveRunWorkflowGraph`; graph-run unit tests; `reviewerRounds` kept over turns | 2a0c12f | format ✓ lint ✓ typecheck ✓ test 3543/3543 ✓ build ✓ |
| 2026-10-18 | Simulator invariants, exploration (layer 2), small graphs (layer 4)              | d2050e1 | format ✓ lint ✓ typecheck ✓ test 3890/3890 ✓ build ✓ |
| 2026-10-18 | Template traces pinned; status `review`                                          | (this)  | see commit                                           |

## Decisions and findings

### The engine

- **v1 runs compile their own snapshot.** `programOf` migrates `RunState.workflow` (or the
  default) after putting the run's review settings (`integration.reviewer` and
  `maxReworkRounds`, so ticket overrides included) into the review stage, with the context
  `{projectMode: approvalPolicy.mode ?? 'manual', approvalCeilings: [], maxConcurrentHelpers}`.
  A v1 ticket mode replaced the project's mode, so it is the project mode here, with no ceiling.
- **Golden traces are identical** for all 267 cases on the program-driven engine, through the
  per-agent mode, and as explicit migrated-graph runs. The one intended difference: a graph
  run's helper and tester `start-agent` carries `autoMode`/`sandbox` (only in Full auto cases);
  v1 runs never get these fields. `agentLaunchMode(state, agent)` answers for every run.
- **Briefs list helper nodes only when the graph has named helpers**, so v1 prompts stay
  byte-identical. Final-stage agents keep the roles `Reviewer`/`Tester` on the v1 ids
  (`code-review`, `unit-tests`); other final nodes use their label.
- **Route c**, per the coordinator: the reviewer's rework comments are its `review-comment`
  (author reviewer) on that round, so no `change-comment` with a new author and no server
  change. The direct rework needs rounds left, a going run, the helper waiting within its
  budget, a free slot (not counting the submitting reviewer) and room in the node; otherwise the
  change goes to the lead with one extra sentence. The lead's info line has no findings.
- **Rounds per decider:** `EngineChange.reviewerRounds` (in memory, like `verdict`; a restart
  sends every undecided change to the owner anyway). The lead's used rounds are
  `round - reviewerRounds`, which still counts owner-granted rounds, as in v1.
- **Mixed routes:** `assignReviewers` skips (instead of stopping at) a change that needs a review
  agent slot, so a lead-reviewed change behind it is not held up. Same result for one route.
- **`maxInstances`** counts the node's live workers (sub-helpers included) at `start_agent` and
  at a rework restart; testers have no per-node limit.
- **`effectiveMode`** is undefined for the lead, planner and reviewers and for runs without an
  approval policy; `requestPermission` re-checks a pre-approval against it.
- **Plan step nodes** are kept in `RunState.planStepHelpers` (in memory) for the lead's brief of
  the approved plan, since storing them on the plan is a contract change (proposal below).
- **`createRun` with a graph** refuses (`invalid-input`, the validator's message) an invalid
  graph, a graph without `graphContext` or a ticket, and a `graphContext.maxConcurrentHelpers`
  different from `limits`. No new refusal code.
- **Coordinator-approved web line:** `reviewer: 'Review agent'` in `web/src/lib/copy.ts`, in the
  same commit as the decider widening (d710b66), because neither half passes the checks alone.
- **Minimal db edit (7441bb2):** the run-audit stage parser and types accept `WorkflowNodeId`
  (v1 ids still parse), so the server compiles with node-id stages; its test's invalid stage is
  now a non-id. The run snapshot does not store `graph`/`graphContext` yet: WG-C.

### The correctness suite (`packages/orchestrator/tests/graph-correctness/`)

- **Simulator** (`sim.ts`): real engine commands, fake agents, server and owner; every
  behaviour is a choice point. The lead is reactive (acts only on engine messages and its own
  tool replies), so the idle-lead deadlock is visible as `stuck`.
- **Exploration bounds** (`explore.ts`): answers explored per choice kind (a first turn changes
  files, changes nothing or fails; reviewers approve or rework; every allowed lead decision;
  merges succeed or fail a check; the owner merges, discards or grants one extra round per
  change). Explored states are pruned by a fingerprint that drops history that can no longer
  matter (ended change reviewers, decided changes' rounds and verdicts, decided approvals).
  One-helper graphs and the v1 workflows explore the full product; many-helper graphs explore
  node by node (each editing node branches while the others answer by default). Every
  exploration in the suite finishes within its budget (3,000 or 5,000 runs).
- **Layer 4 bound:** valid baselines node by node, valid variations on their varied node (the
  rest is the baseline's). 1,172 valid graphs explored, 2,344 rejected graphs refused by compile.
- **Time:** the orchestrator suite went from about 2 s to about 20–27 s wall (29 files in
  parallel).
- **Validator gaps: none found.**

### Proposals (not made)

1. **`PlanStepSchema.helper?`** (core, coordinator): store the node a step was given to on the
   plan, so it survives a restart and shows on the plan card. Affects core, db plan storage, web
   plan view. Until then the engine keeps it in memory.
2. **WG-C:** persist `RunState.graph`, `graphContext` (and optionally `planStepHelpers`) in the run
   snapshot; build `graphContext` from `resolveRunOptions` as ceilings; pass
   `{plannerMode: program.planner ? 'separate' : 'lead'}` to `ticketRunPrompts` for graph runs;
   use `agentLaunchMode` (or the new `start-agent` fields) for each agent's `ManagedAgentSpec` and
   `effectiveMode` for the gate and allowlist (`evaluateAllowlist({policy: {...policy, mode}})`).
