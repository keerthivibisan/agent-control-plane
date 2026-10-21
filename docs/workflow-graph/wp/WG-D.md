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
| Updated | 2026-10-20                                       |

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

| Date       | What was done                                                                                                                                                                                                                      | Commit  | Checks                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| 2026-10-17 | Claimed WG-D                                                                                                                                                                                                                       | fbf668f | format ✓ lint ✓ typecheck ✓ test 2717/2717 ✓ build ✓                                |
| 2026-10-17 | Graph editor (reducer, layout, canvas, palette, panels, problems, templates), the Workflow page on `/workflow-graph`, project defaults card, wizard template choice; vitest                                                        | a177028 | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓                                |
| 2026-10-17 | Three-row layout, Done under your merge, warnings word and icon-only workspace marker on blocks; e2e `workflow.spec.ts` rewritten for the editor (6 tests, light/dark screenshots)                                                 | 3d44c22 | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓; e2e workflow 6/6 ✓            |
| 2026-10-17 | Status `review`, completion report                                                                                                                                                                                                 | 71583cb | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓; e2e workflow 6/6 ✓            |
| 2026-10-20 | Resumed: rebased on `feature/workflow-graph` (`e94e962`, WG-C and WG-E merged); the three WG-V specs drive the editor; `workflow-live.spec.ts` against the real routes; dead v1 client code removed; one cache entry for the graph | (this)  | format ✓ lint ✓ typecheck ✓ test 4009/4009 ✓ build ✓; e2e 71/71 ✓ (ports 7631/7641) |

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

- **Resumed 2026-10-20 (after WG-C and WG-E merged):**
  - the rebase had no conflicts; `lib/copy.ts` and `lib/api.ts` keep both sides' sections;
  - WG-E's `blockModesPaths.graph`/`blockModesSchemas.graph` now point at the editor's
    `workflowGraphPaths.graph`/`workflowGraphSchemas.graph` (the same path and schema, so one
    cache entry), instead of a second definition with an aliased import;
  - removed `updateWorkflow`, `isWorkflowPath` and `UpdateWorkflowRequest` from `lib/api.ts`
    (grep: no users); `workflowPaths`/`workflowSchemas` stay (the ticket page's version 1 view and
    Skills & Agents read `GET …/workflow`); the core DTOs stay for WG-V;
  - WG-C's 422 body is a plain summary: `refusalMessage` now shows it, and the page shows it when
    `…/validate` gives no list.
- **e2e against the real server:** a new project `workflow-live` (`e2e/workflow-live.spec.ts`, on
  the workspace server) loads a default, a version 1 (stored with the version 1 PUT) and a
  version 2 project, saves a graph (`stored: v2`; the version 1 GET then answers 409
  `workflow_is_graph`; a reload shows nothing unsaved), sees a real 422 with the server's issues
  (the PUT and validate bodies lose a review link on their way, since the editor never sends an
  invalid graph), and saves the wizard's template choice. `workspace.spec.ts` and
  `review-loop-live.spec.ts` drive the editor (Add Planner / Add Final reviewer, the block panel,
  Save) and check `stored: v2`; "Used by" now names the block ("Code reviewer").
  `review-loop.spec.ts`'s Workflow test stays on fixtures like the rest of that file (its project
  `p-web` exists only in them), now on the graph routes: approvals in the Project defaults card,
  the change reviewer's block panel.

## Completion report — WG-D

1. **Summary:** the Workflow page is a graph editor on the real `GET`/`PUT
/api/projects/:id/workflow-graph` and `POST …/validate` (canvas, palette, block and link panels,
   live problems, templates and restore, guarded save with the server's 422 issues); the limits
   and approvals stay in a Project defaults card; the new-project wizard offers the templates in
   step 2 and saves the choice on finish. Checked end to end against WG-C's server.
2. **Files:**
   - created: `packages/web/src/features/workflow/editor/` (`state.ts`, `layout.ts`, `flow.ts`,
     `nodes.tsx`, `GraphEditor.tsx`, `Palette.tsx`, `NodePanel.tsx`, `EdgePanel.tsx`,
     `IssuesList.tsx`, `TemplatePicker.tsx`, `templates.ts`, `issues.ts`, `save.ts`,
     `useUnsavedGuard.ts`), `features/workflow/ProjectDefaults.tsx`,
     `features/project-setup/WorkflowTemplateChoice.tsx`, `e2e/workflow-live.spec.ts`,
     `tests/features/workflow-editor.test.tsx`, `tests/features/workflow-editor-state.test.ts`;
   - modified: `features/workflow/WorkflowPage.tsx` (rewritten), `features/workflow/draft.ts`
     (setup draft only; the 422 summary), `features/project-setup/NewProjectWizard.tsx`,
     `lib/api.ts` (graph client; v1 PUT client removed; WG-E's graph path shared), `lib/copy.ts`
     (`WORKFLOW_GRAPH_COPY`), `e2e/workflow.spec.ts` (rewritten), `e2e/workflow-fixtures.ts`,
     `e2e/workspace.spec.ts`, `e2e/review-loop-live.spec.ts`, `e2e/review-loop.spec.ts`,
     `e2e/playwright.config.ts` (the `workflow-live` project), `tests/features/project-setup.test.tsx`,
     `tests/features/review-loop-workflow.test.tsx`, `tests/features/stage-agent-files.test.tsx`,
     this file;
   - deleted: `features/workflow/StagePanel.tsx`, `WorkflowGraph.tsx`, `AgentFiles.tsx`,
     `tests/features/workflow.test.tsx`.
3. **Commands:** `pnpm check` from the worktree root: format ✓, lint ✓, typecheck ✓, test 4009
   passed (core 403, adapters/demo 12, adapters/claude-code 363, db 203, orchestrator 1763,
   web 746, server 519), build ✓. Full e2e (`pnpm --filter @acp/web test:e2e`,
   `ACP_E2E_PORT=7631 ACP_E2E_CONTROL_PORT=7641`): **71 passed, 0 failed** (5.6 min), including
   `workflow` 6/6 and `workflow-live` 4/4.
4. **Acceptance criteria:** all met — editor (handles, link-kind choice, refused drags, delete,
   nudging, both themes), palette limits with reasons, block panel (no mode on read-only blocks,
   Full auto warning, plan auto switch), link rounds, live problems with focus, templates with
   review styles and planner, restore, confirmation, save disabled with errors, unsaved guard,
   422 issues, limits and approvals kept, wizard template step, plain copy, keyboard focus and
   labelled controls; against the real server: default, v1 and v2 projects load, a graph saves as
   `stored: v2`, a 422 lists the server's issues, the wizard's choice saves.
5. **Assumptions:** under "Decisions and findings".
6. **Contract or shared-file changes:** none.
7. **Known gaps / follow-ups:** ⌘K palette navigation is not caught by the unsaved-changes guard;
   the version 1 core DTOs and routes are WG-V's to remove.
8. **Screenshots** (git-ignored) in `.acp-data/wg-d-shots/`: the real server's editor as
   `workflow-live-{default,v1,saved-v2,refused,wizard-template}-{1440,1024}-{light,dark}.png` and
   `workspace-workflow-saved-*`; the mocked editor as `workflow-*`.
9. **Next:** WG-V.
