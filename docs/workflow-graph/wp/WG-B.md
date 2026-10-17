# WG-B: Engine

> Progress file for WG-B. Only the agent working on WG-B edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-B row and the "WG-0 refinements".

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | in-progress                                      |
| Owner   | WG-B agent (Claude Code)                         |
| Branch  | `wp/wg-b-engine` (from `feature/workflow-graph`) |
| Started | 2026-10-17                                       |
| Updated | 2026-10-17                                       |

## Tasks

- [ ] 0. Golden traces (layer 5): a deterministic trace harness in
      `packages/orchestrator/tests/graph-correctness/`, snapshots recorded on the unchanged engine
- [ ] 1. Contract commits (pre-approved): `helper?` on `start_agent` and `submit_plan.steps[]`;
      `'reviewer'` in `ChangeDeciderSchema`; core tests and the adapter's `start_agent` key pin
- [ ] 2. The program: `RunState.graph?`/`graphContext?`, `programOf(state)` (memoized, v1 runs
      migrate their snapshot), `createRun` inputs
- [ ] 3. Node-keyed agents: `EngineAgent.stage` is a node id; `launchFieldsFor(program, nodeId)`;
      `nextStage` over `program.finalStages`; `isSeparatePlanner` from `program.planner`
- [ ] 4. Named helpers: `start_agent.helper`, label match, pool, refusal with the list; plan step
      resolution at submit; `maxInstances`; `canStartHelpers`; briefs list helper nodes
- [ ] 5. Review routes a, b, c in `loop.ts` (per-decider rounds, `decidedBy: 'reviewer'`, info
      line to the lead)
- [ ] 6. Approval per agent: `effectiveMode(state, agent)`, per-agent allowlist and Full auto,
      `autoMode`/`sandbox` on the launch effect
- [ ] 7. Plan auto-approval from `program.planAutoApprove`
- [ ] 8. `deriveRunWorkflowGraph(state)`
- [ ] 9. Graph-correctness suite: simulator with invariants (layer 1), exploration (layer 2),
      small graphs soundness/completeness (layer 4); golden traces unchanged
- [ ] 10. Status `review`, final `pnpm check`, completion report

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks                                               |
| ---------- | ------------- | ------ | ---------------------------------------------------- |
| 2026-10-17 | Claimed WG-B  | (this) | format ✓ lint ✓ typecheck ✓ test 2717/2717 ✓ build ✓ |

## Decisions and findings
