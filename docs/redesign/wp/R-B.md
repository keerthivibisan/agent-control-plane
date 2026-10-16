# R-B — Workflow page

> Progress file for R-B. Only the agent working on R-B edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value             |
| ------- | ----------------- |
| Status  | review            |
| Owner   | frontend agent    |
| Branch  | `wp/r-b-workflow` |
| Started | 2026-10-16        |
| Updated | 2026-10-16        |

## Tasks

- [x] 1. `buildWorkflowGraph(workflow, setup)`: a pure, data-driven graph model, with unit tests for
      every planner mode and stage toggle
- [x] 2. The Workflow page: React Flow graph, agent nodes, legend, ⓘ "fixed for now"
- [x] 3. Stage panel: model, skill, enabled, planner mode, helper limits and allowlist (setup PUT),
      review explanation, Save / Discard, refusals in plain words
- [x] 4. Agent definitions side list (hidden when `GET …/agents` answers 404)
- [x] 5. Wire into the shell (`project-pages.ts`, `ProjectScreen`)
- [x] 6. Component tests with fixture DTOs; Playwright spec with screenshots (light/dark, 1440/1024)
- [x] 7. Completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                               | Commit                      | Checks                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed R-B; read the spec and code                                                                                         | `docs(redesign): claim R-B` | docs-only; checks not run                                                                                              |
| 2026-10-16 | WIP: graph model, node views, canvas + legend, stage panel, agent files, api/copy sections, shell wiring; no tests yet      | `a949038` (was `053e74d`)   | web typecheck ✓; format/lint/test/build not run (paused)                                                               |
| 2026-10-16 | Paused by the owner; handoff note below                                                                                     | `1c28c0b`                   | docs-only                                                                                                              |
| 2026-10-16 | Resumed; rebased on main. Graph unit tests, page component tests, shared fixtures; shell/palette expectations list Workflow | `f8688cc`                   | format ✓ lint ✓ typecheck ✓ test (web 383; server 323 with one environmental flake per run, passes on rerun) ✓ build ✓ |
| 2026-10-16 | e2e spec + `workflow` Playwright project; screenshots looked at; smaller nodes, shorter labels, compact depth choice        | `18d7920`                   | web checks ✓; e2e workflow 3/3 ✓                                                                                       |
| 2026-10-16 | Rebased on main `817d61c` (R-E merged; kept both sides); loop label kept in view; final checks; report; `review`            | `dd6b9a4` + this            | format ✓ lint ✓ typecheck ✓ test 1,841 ✓ build ✓; e2e 27/27 ✓                                                          |

## Handoff notes

### Resumed and finished (2026-10-16)

The pause note below is kept for history. All of its next steps are done, except DESIGN.md (see
the report, item 6).

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

## Completion report — R-B

1. **Summary:** the Workflow page (`#/p/:projectId/workflow`). A data-driven process graph shows
   how a ticket flows from Ticket to Done. Each agent node shows its role, model, skill (with a
   missing-skill warning) and workspace. A stage panel saves stage settings with `PUT …/workflow`
   and helper limits and the allowlist with `PUT …/setup`, and explains refusals in plain words.
   A side list shows agent files as "available, not mapped", hidden while that route answers 404.
2. **Files changed:**
   - created: `packages/web/src/features/workflow/{graph.ts, draft.ts, WorkflowNodes.tsx,
WorkflowGraph.tsx, StagePanel.tsx, AgentFiles.tsx, WorkflowPage.tsx}`,
     `packages/web/tests/features/{workflow-graph.test.ts, workflow.test.tsx}`,
     `packages/web/e2e/{workflow-fixtures.ts, workflow.spec.ts}`;
   - modified (add-only or as the spec allows): `packages/web/src/lib/api.ts` (Workflow section),
     `packages/web/src/lib/copy.ts` (`WORKFLOW_COPY`), `packages/web/src/app/project-pages.ts`
     (Workflow `available`), `packages/web/src/app/App.tsx` (the `workflow` case),
     `packages/web/e2e/playwright.config.ts` (one `workflow` project, allowed by the coordinator),
     `packages/web/tests/app/shell.test.tsx` and `packages/web/tests/features/palette.test.tsx`
     (Workflow is now an available page; Skills is the unbuilt example), this file.
3. **Commands run and actual results** (at `dd6b9a4`, rebased on main `817d61c`):
   - `pnpm check`: format:check ✓, lint ✓, typecheck ✓, tests core 246, demo 12, orchestrator
     424, adapter 283, db 153, web 400, server 323, all passed; build ✓.
     Earlier full runs before this rebase each had one environmental server failure
     (`harness/runner` once and the smoke test once). Both passed on rerun; main's flake fix
     has landed since.
   - `pnpm --filter @acp/web test:e2e` (`ACP_E2E_PORT=8251 ACP_E2E_CONTROL_PORT=8261`): 27/27
     passed, including `workflow` 3/3.
4. **Acceptance criteria** (the R-B brief):
   - Graph from Ticket to Done, left to right, in React Flow: **met** (three wrapped rows, below).
   - Lead mode is one agent with a "Same agent" badge on Plan and Orchestrate; separate mode is a
     planner and a lead: **met** (unit, component and e2e tests).
   - Optional stages that are off are dimmed, with faint edges and a dashed "Off: skipped" bypass:
     **met** (all four combinations unit-tested).
   - Pure `buildWorkflowGraph(workflow, setup)`, data-driven (README §7a): **met** (the
     post-merge chain is generic; selection lives in context, not in the model).
   - Nodes show role, model or "Project default", the skill chip or "No skill", a missing-skill
     warning, the helper limits, and read-only vs own copy: **met**.
   - Panel: model (the project default as placeholder), skill select, enabled toggle for the
     optional stages, "Separate planner agent", helper limits and allowlist via the setup PUT,
     always-on required checks with an explanation and a Harness link, Save / Discard, refusals in
     words: **met** (component tests cover both PUT bodies, 400 and 409 refusals, validation and
     discard; `refusalMessage` covers 403, 404 and unreachable).
   - Agent files list, hidden on 404: **met**.
   - Legend, one sentence, and a ⓘ saying the stages are fixed for now: **met**.
   - Playwright screenshots in light and dark at 1440 and 1024, looked at: **met** (findings
     below).
5. **Assumptions** (also in the handoff notes):
   - **Layout: three wrapped rows.** Each row reads left to right and the flow wraps to the next
     row like a line of text. The screenshots were checked as the coordinator asked. At 1024 the
     graph renders at full size (zoom 1); at 1440 it sits beside the panel at about 0.8 zoom, and
     every label stays readable. A single row would be about 1,950px wide: it would either shrink
     to about half size or need horizontal scrolling, which would hide Review, the post-merge
     stages and Done behind a scroll. So I kept the wrapped rows.
   - **Side panel:** it is a right column at ≥1360px, beside the graph, never over it. Below
     1360px it sits under the graph and scrolls into view when you select a stage (the
     `…-panel-1024` screenshots).
   - The plan-approval gate has no settings, so clicking it does nothing. Clicking a helper opens
     the Helpers stage.
   - One Save writes both parts: the stage settings first, then the limits. If the limits are
     refused after the stages were saved, the message says only the limits are left.
   - Helper depth is a compact 1 / 2 choice in the panel; the cards from Settings don't fit its
     width.
6. **Contract or shared-file changes:** none to contracts or routes.
   - Shared web files changed: only add-only sections, plus the allowed `playwright.config.ts`
     entry.
   - Proposed for the coordinator: DESIGN.md's routes table still reads "Workflow (R-B; not
     available yet)". R-A owns that file, so I didn't edit it. Proposed new cell:
     `Workflow (stages, agents, limits; R-B)`.
7. **Known gaps and follow-ups:**
   - The agent files list shows only while R-D serves `GET /api/projects/:id/agents`.
   - Mapping a stage to an agent file is a later decision (ADR-0018 amendment).
   - The ticket page's live graph (R-H) can reuse `buildWorkflowGraph`, `workflowNodeTypes` and
     `WorkflowGraphContext` with `select: null`. Run state would need a node data field or
     context, for example from `RunWorkflowDto`.
   - Screenshots are in the session scratchpad (`rb-shots/`), not committed.
8. **Next recommended task:** R-H (the live workflow graph on the ticket page, reusing this graph),
   then R-V.
