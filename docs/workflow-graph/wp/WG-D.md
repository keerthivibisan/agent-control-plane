# WG-D: Web graph editor

> Progress file for WG-D. Only the agent working on WG-D edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-D row and the "WG-0 refinements".

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | review                                           |
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
- [x] 8. e2e (`workflow.spec.ts`, mocked routes) with the light and dark screenshot hooks
- [x] 9. Status `review` and the completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                      | Commit  | Checks                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| 2026-10-17 | Claimed WG-D                                                                                                                                                                       | 650fd18 | format ✓ lint ✓ typecheck ✓ test 2717/2717 ✓ build ✓                     |
| 2026-10-17 | Graph editor (reducer, layout, canvas, palette, panels, problems, templates), the Workflow page on `/workflow-graph`, project defaults card, wizard template choice; vitest        | ec34efa | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓                     |
| 2026-10-17 | Three-row layout, Done under your merge, warnings word and icon-only workspace marker on blocks; e2e `workflow.spec.ts` rewritten for the editor (6 tests, light/dark screenshots) | 5e22faf | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓; e2e workflow 6/6 ✓ |
| 2026-10-17 | Status `review`, completion report                                                                                                                                                 | (this)  | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓; e2e workflow 6/6 ✓ |

## Decisions and findings

- **422 issues come from `POST …/workflow-graph/validate`.** `ErrorDtoSchema` has no `issues`
  field (and the client parses error bodies with it, so extra fields would be dropped). On a 422
  `workflow_invalid` the page asks the validate route for the server's issues, a contract DTO, and
  lists them above the local ones. No contract change needed. If WG-C would rather put `issues` in
  the 422 body, that needs `ErrorDtoSchema` (or a `WorkflowInvalidErrorDtoSchema`) extended, which
  is a coordinator decision; the client then reads the body first and keeps the validate call as
  the fallback.
- **The wizard's template choice is in step 2 ("How agents work"), not a sixth step.** A new step
  would change "Step N of 5" and add a Next click in `e2e/workspace.spec.ts` and
  `e2e/review-loop-live.spec.ts` (WG-V's), which walk the wizard against the real server. The
  default choice (today's setup, no planner) saves no graph, because a project without one answers
  today's setup migrated from its version 1 default: the same workflow. Any other choice
  ("Build my own" included, saved as `custom`) is PUT to `/workflow-graph` when the owner finishes;
  a refusal keeps them on the last step with the reason.
- **A template's plan step asks unless the project is Full auto** (`templateGraph`), the same rule
  as `migrateWorkflowV1`, so a fresh template never starts with the `full-auto-plan-manual`
  warning. A template keeps the graph's `legacyV1`, so "Restore my earlier setup" stays possible.
- **Forced wiring is automatic, the rest is the owner's.** Adding the planner rewires the plan path
  (`ticket → planner → plan approval → lead`), removing it restores `ticket → lead → plan approval`;
  a final reviewer or tester is inserted just before your merge, and removing one joins the chain.
  There is only one valid way to do these, and they are always made with `canConnect`. Assigns,
  review routes, findings and rework are drawn by the owner.
- **Links:** a drag from a block's right handle to another's left handle; `allowedEdgeTypes` (every
  type `canConnect` accepts) decides: one kind is made at once, several open a choice, none is
  refused with `canConnect`'s message for the kind the source most likely meant. The block panel's
  "Add a link" form is the keyboard way to do the same. Back links (findings, a review sent to the
  lead) loop over the top and rework underneath, so they never sit on the forward links.
- **Layout:** three rows (plan path; lead, helpers, change reviewers; checks, ticket branch, final
  stages, your merge with Done under it), cells centred on one line and stacks below. A moved block
  keeps `position`; positions are only written for blocks the owner moved. The canvas takes the
  automatic layout's shape, so dragging never resizes it.
- **Shape problems** (an empty or too long name, a too long model or description) are listed with
  the validator's issues and block Save, because the validator assumes a well-shaped graph.
- **Unsaved changes guard:** the browser prompt on reload or close, and a confirm on in-app links
  (sidebar, breadcrumbs, links on the page). Navigation that bypasses links (the ⌘K palette) is not
  caught; "Unsaved changes" next to Save says so.
- **Project defaults** (helper limits, depth, budget, approval mode and Auto's commands) stay on
  the page in their own card, saved through PUT …/setup as before; "Project default" on a block
  uses that mode.
- **Removed with the version 1 page:** `StagePanel.tsx`, `WorkflowGraph.tsx`, `AgentFiles.tsx`, the
  workflow draft in `draft.ts` (the setup draft stays), and their tests. Kept because the ticket
  page's live graph imports them (WG-E): `graph.ts`, `WorkflowNodes.tsx`, `icons.tsx` and the
  `WORKFLOW_COPY` entries they use. `updateWorkflow`, `isWorkflowPath` and `UpdateWorkflowRequest`
  in `lib/api.ts` are now unused; they go with the version 1 endpoints (WG-V).

## Completion report — WG-D

1. **Summary:** the Workflow page is a graph editor on `GET`/`PUT /api/projects/:id/workflow-graph`
   (canvas, palette, block and link panels, live problems, templates and restore, guarded save
   with the server's 422 issues), the project's limits and approvals stay in a Project defaults
   card, and the new-project wizard offers the templates in step 2 and saves the choice on finish.
2. **Files:**
   - created: `packages/web/src/features/workflow/editor/` (`state.ts`, `layout.ts`, `flow.ts`,
     `nodes.tsx`, `GraphEditor.tsx`, `Palette.tsx`, `NodePanel.tsx`, `EdgePanel.tsx`,
     `IssuesList.tsx`, `TemplatePicker.tsx`, `templates.ts`, `issues.ts`, `save.ts`,
     `useUnsavedGuard.ts`), `features/workflow/ProjectDefaults.tsx`,
     `features/project-setup/WorkflowTemplateChoice.tsx`,
     `tests/features/workflow-editor.test.tsx`, `tests/features/workflow-editor-state.test.ts`;
   - modified: `features/workflow/WorkflowPage.tsx` (rewritten), `features/workflow/draft.ts`
     (setup draft only), `features/project-setup/NewProjectWizard.tsx`, `lib/api.ts` (new
     endpoints), `lib/copy.ts` (`WORKFLOW_GRAPH_COPY`), `e2e/workflow.spec.ts` (rewritten),
     `e2e/workflow-fixtures.ts` (graph fixtures added), `tests/features/project-setup.test.tsx`,
     `tests/features/review-loop-workflow.test.tsx`, `tests/features/stage-agent-files.test.tsx`,
     this file;
   - deleted: `features/workflow/StagePanel.tsx`, `WorkflowGraph.tsx`, `AgentFiles.tsx`,
     `tests/features/workflow.test.tsx`.
3. **Commands:** `pnpm check` from the worktree root: format ✓, lint ✓, typecheck ✓, test 2725
   passed (core 399, adapters/demo 12, orchestrator 574, adapters/claude-code 348, db 195, web 716,
   server 481), build ✓. `pnpm --filter @acp/web test:e2e --project=workflow` (ports 7631/7641):
   6/6 passed. The whole e2e suite: 59 passed, 3 failed, 2 did not run; the 3 failures are the
   version 1 Workflow page steps in WG-V's specs (see 7).
4. **Acceptance criteria:**
   - editor (canvas, typed handles, link-kind choice, refused drags, delete, nudging, light and
     dark): met (e2e named-helper and block-panel tests, screenshots);
   - palette with `NODE_CAPABILITIES` limits and reasons: met (vitest, e2e);
   - block panel fields, no mode on read-only blocks, Full auto warning, plan auto switch: met;
   - link panel rounds 0–5: met; problems list live with click to focus: met;
   - templates with review styles and planner toggle, restore, confirmation: met;
   - save disabled with errors, unsaved guard, 422 issues: met;
   - Workflow page on the new endpoints with limits and approvals kept: met;
   - wizard template step with PUT on finish: met (in step 2, see Decisions);
   - plain copy: met; keyboard focus visible and labelled controls: met (e2e focus ring, labels).
5. **Assumptions:** under "Decisions and findings" (422 issues via `…/validate`, wizard step 2 and
   no save for the default, plan step follows Full auto, forced wiring, layout, guard scope).
6. **Contract or shared-file changes:** none made, none required. Optional: a 422 body carrying
   `issues` would need `ErrorDtoSchema` extended (coordinator).
7. **Known gaps / follow-ups:**
   - **Depends on WG-C:** the real `GET`/`PUT /api/projects/:id/workflow-graph` and
     `POST …/validate`. Until then the page shows the load error against a real server; the
     editor is tested on mocked routes only.
   - **WG-V's e2e specs still drive the version 1 page:** `review-loop.spec.ts` ("the Workflow
     page: approvals… and the review stage": `Change Helpers`), `workspace.spec.ts` (`wf-node-plan`
     and the stage panel) and `review-loop-live.spec.ts` (`Change Review & merge`) fail at those
     steps. The approvals now live in the Project defaults card; the stage settings are block
     settings. Their wizard steps still pass.
   - The Skills & Agents page's "Used by" still reads the version 1 workflow; `usedByNodes` (in the
     DTO) is for whoever moves it.
   - ⌘K palette navigation is not caught by the unsaved-changes guard.
8. **Next:** WG-C (serve the endpoints), then WG-V updates the three specs above and runs the
   editor against the real server.
