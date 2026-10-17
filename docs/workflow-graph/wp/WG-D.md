# WG-D: Web graph editor

> Progress file for WG-D. Only the agent working on WG-D edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-D row and the "WG-0 refinements".

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | in-progress                                      |
| Owner   | WG-D agent (Claude Code)                         |
| Branch  | `wp/wg-d-editor` (from `feature/workflow-graph`) |
| Started | 2026-10-17                                       |
| Updated | 2026-10-17                                       |

## Tasks

- [x] 1. Client for the new endpoints: `GET`/`PUT /api/projects/:id/workflow-graph` and
      `POST …/workflow-graph/validate` (lib/api.ts), with the 422 `workflow_invalid` handling
- [x] 2. Editor state: a pure reducer (add, remove, connect, refused connections, positions,
      planner and final-chain wiring, templates, restore) and auto-layout
- [x] 3. `GraphEditor` (React Flow canvas, typed handles, edge-type choice, delete, nudging),
      `Palette`, `NodePanel`, `EdgePanel`, `IssuesList`, `TemplatePicker`
- [x] 4. The Workflow page on the graph editor: save (disabled with errors), unsaved-changes
      guard, 422 issues; the project's limits and approvals kept on the page
- [x] 5. The new-project wizard's template choice, PUT to `/workflow-graph` on finish
- [x] 6. Copy in plain words (`lib/copy.ts`, a new section)
- [x] 7. vitest: reducer, NodePanel, IssuesList focus, template picker and restore, save
      disabled, 422, wizard template step
- [ ] 8. e2e (`workflow.spec.ts`, mocked routes) with the light and dark screenshot hooks
- [ ] 9. Status `review` and the completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                               | Commit  | Checks                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 2026-10-17 | Claimed WG-D                                                                                                                                                                | 650fd18 | format ✓ lint ✓ typecheck ✓ test 2717/2717 ✓ build ✓ |
| 2026-10-17 | Graph editor (reducer, layout, canvas, palette, panels, problems, templates), the Workflow page on `/workflow-graph`, project defaults card, wizard template choice; vitest | (this)  | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓ |

## Decisions and findings
