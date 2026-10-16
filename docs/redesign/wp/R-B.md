# R-B — Workflow page

> Progress file for R-B. Only the agent working on R-B edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value                           |
| ------- | ------------------------------- |
| Status  | in-progress (paused 2026-10-16) |
| Owner   | frontend agent                  |
| Branch  | `wp/r-b-workflow`               |
| Started | 2026-10-16                      |
| Updated | 2026-10-16                      |

## Tasks

- [ ] 1. `buildWorkflowGraph(workflow, setup)`: a pure, data-driven graph model, with unit tests for
      every planner mode and stage toggle
- [ ] 2. The Workflow page: React Flow graph, agent nodes, legend, ⓘ "fixed for now"
- [ ] 3. Stage panel: model, skill, enabled, planner mode, helper limits and allowlist (setup PUT),
      review explanation, Save / Discard, refusals in plain words
- [ ] 4. Agent definitions side list (hidden when `GET …/agents` answers 404)
- [ ] 5. Wire into the shell (`project-pages.ts`, `ProjectScreen`)
- [ ] 6. Component tests with fixture DTOs; Playwright spec with screenshots (light/dark, 1440/1024)
- [ ] 7. Completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                          | Commit                      | Checks                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| 2026-10-16 | Claimed R-B; read the spec and code                                                                                    | `docs(redesign): claim R-B` | docs-only; checks not run                                |
| 2026-10-16 | WIP: graph model, node views, canvas + legend, stage panel, agent files, api/copy sections, shell wiring; no tests yet | `053e74d`                   | web typecheck ✓; format/lint/test/build not run (paused) |
| 2026-10-16 | Paused by the owner; handoff note below                                                                                | this                        | docs-only                                                |

## Handoff notes

### Paused (2026-10-16)

**Done (in WIP `053e74d`; code is written but untested, so tasks 1–5 stay unchecked):**

- `features/workflow/graph.ts`: `buildWorkflowGraph(workflow, setup, skills?, labels?)`, pure and
  data-driven. Node types are `terminal` (Ticket, Done), `agent` (plan, orchestrate, code-review,
  unit-tests), `gate` (You approve the plan), `helpers` (a box) with N `helper` children
  (`parentId: 'helpers'`, N = `maxConcurrentHelpers`, a `nested` hint when `maxDepth` is 2) and
  `review`. Edge kinds are `flow`, `loop` (approve → plan, "Changes"), `off` (touches a stage that
  is off, faint) and `bypass` (dashed, "Off: skipped"; generic over the post-merge chain).
  - Layout decision: three rows that read left to right and wrap like text (Ticket → Plan →
    Approve / Orchestrate → Helpers → Review / Code review → Unit tests → Done), so it stays
    readable next to a side panel. One row would need ~1950px and zoom down to about 0.5.
  - Lead mode: Plan and Orchestrate both show the role Lead with a "Same agent" badge (a tooltip
    names the other stage). Separate mode: Planner, then Lead.
  - `stageOfNode(id)` maps a click back to a stage (a helper selects `helpers`).
- `WorkflowNodes.tsx`: node views with hidden handles (`in-left`, `out-right`, `in-top`,
  `out-top`, `out-bottom`, `in-bottom`), the skill chip (set, none, missing with a warning), the
  model line ("Project default" or "<model> (project default)"), the workspace tag (Read-only /
  Own copy) and `WorkflowGraphContext` (selected, select).
- `WorkflowGraph.tsx`: React Flow, read-only (no drag, connect or scroll-zoom); the canvas takes
  the graph's aspect ratio and refits on resize. `WorkflowLegend`.
- `draft.ts`: workflow and limits drafts, `workflowView` and `setupView` (the graph shows the
  draft), `workflowRequest`, `setupRequest` (the full setup body from the saved setup plus the
  page's limits), `sameWorkflow`, `sameLimits` and `refusalMessage` (csrf, 400, 404, 409,
  unreachable).
- `StagePanel.tsx`: the fields for each stage; it reuses `project-setup/fields` and its copy.
- `WorkflowPage.tsx`: the page, with the graph card on the left and the panel plus agent files on
  the right at ≥1360px (stacked below that; the panel scrolls into view). Save writes the workflow
  first, then the setup. Save, Discard, an unsaved marker, "Saved", and refusals.
- `AgentFiles.tsx`: `GET …/agents`; hidden on a 404 and while loading.
- Add-only sections: `lib/api.ts` (`workflowPaths`, `workflowSchemas`, `isWorkflowPath`,
  `updateWorkflow`) and `lib/copy.ts` (`WORKFLOW_COPY`). In the shell, Workflow is `available` and
  `ProjectScreen` has its case.

**Next steps (exact):**

1. Run `pnpm check` and fix lint, format and test failures. The shell, palette and router tests may
   expect Workflow to be unavailable, so update those expectations.
2. `tests/features/workflow-graph.test.ts`: lead vs separate mode (roles, `sameAgentAs`); each of
   the four on/off combinations of code-review and unit-tests (`off` and `bypass` edges and their
   handles); helper count 1..6 with nested at depth 2; a missing skill flagged only when
   `skills` is given; the loop edge; `stageOfNode`.
3. `tests/features/workflow.test.tsx` (fixture DTOs). React Flow in jsdom needs mocks in the test
   file: `DOMMatrixReadOnly`, the `offsetWidth`/`offsetHeight` getters, and `SVGElement.getBBox`.
   Cover a stage change → PUT workflow body; helper limits → PUT setup body (keeps `projectKey`
   and `contextFiles`); a 400, 409 and 403 refusal in words; the missing-skill warning on the node
   and in the panel; separate-planner rendering; agent files hidden on 404 and listed on 200.
4. `e2e/workflow-fixtures.ts` and `e2e/workflow.spec.ts` (page.route: `/api/projects` +
   `fixtureProject`, `…/workflow` GET/PUT, `…/setup` PUT, `/api/control/token`, `…/agents`). Add
   a `workflow` project to `e2e/playwright.config.ts` (R-V owns e2e; this adds one entry). Run with
   `ACP_E2E_PORT=8251 ACP_E2E_CONTROL_PORT=8261 ACP_SCREENSHOT_DIR=<scratch>`. Take screenshots at
   1440 and 1024, light and dark, then look at them and fix the layout (node heights: `AGENT_H` 152,
   `HELPERS_HEADER_H` 148; check that the content fits).
5. Update DESIGN.md's routes row ("Workflow (R-B)") only if the coordinator agrees, since R-A owns
   it. Then write the completion report and set the status to `review`.

**Open problems:** node content heights are estimates and haven't been seen in a browser yet. The
Harness link points to a page that reads "not found" until R-E lands.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
