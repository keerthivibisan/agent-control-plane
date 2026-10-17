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

- [ ] 1. `canConnect`: the edge-type matrix, self and duplicate edges, unknown nodes
- [ ] 2. `validateWorkflowGraph`: every README §2 rule plus the refinements, deterministic order
- [ ] 3. `compileWorkflow` and `WorkflowGraphInvalidError`: routes a, b, c, overrides, modes,
      plan auto-approval, pool limit, final stage order
- [ ] 4. `migrateWorkflowV1`: lossless, node ids = v1 stage ids; golden tests for every v1
      combination
- [ ] 5. Templates: `workflowTemplate`, `WORKFLOW_TEMPLATES`
- [ ] 6. Test support: seeded PRNG, `generateValidGraph`, `GRAPH_MUTATIONS`,
      `enumerateSmallGraphs`
- [ ] 7. Property tests (layer 3), small-graph agreement and rule coverage (layer 4, core part)

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks     |
| ---------- | ------------- | ------ | ---------- |
| 2026-10-17 | Claimed WG-A  | (this) | see commit |

## Decisions and findings
