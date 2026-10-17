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
- [x] 8. e2e (`workflow.spec.ts`, mocked routes) with the light and dark screenshot hooks
- [ ] 9. Status `review` and the completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                      | Commit  | Checks                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| 2026-10-17 | Claimed WG-D                                                                                                                                                                       | 650fd18 | format ✓ lint ✓ typecheck ✓ test 2717/2717 ✓ build ✓                     |
| 2026-10-17 | Graph editor (reducer, layout, canvas, palette, panels, problems, templates), the Workflow page on `/workflow-graph`, project defaults card, wizard template choice; vitest        | ec34efa | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓                     |
| 2026-10-17 | Three-row layout, Done under your merge, warnings word and icon-only workspace marker on blocks; e2e `workflow.spec.ts` rewritten for the editor (6 tests, light/dark screenshots) | (this)  | format ✓ lint ✓ typecheck ✓ test 2725/2725 ✓ build ✓; e2e workflow 6/6 ✓ |

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
