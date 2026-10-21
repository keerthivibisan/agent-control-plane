# WG-F: Fixes found in verification

> Progress file for WG-F. Only the agent working on WG-F edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: three findings from verifying v0.2.0 (WG-E's review notes and the coordinator's
> checks).

| Field   | Value                                  |
| ------- | -------------------------------------- |
| Status  | review                                 |
| Owner   | WG-F agent (Claude Code)               |
| Branch  | `wp/wg-f-fixes` (from `release/0.2.0`) |
| Started | 2026-10-21                             |
| Updated | 2026-10-21                             |

## Tasks

- [x] 1. Bug 1: the run options lose the project's defaults for a project saved as a graph
- [x] 2. Bug 2: the Start dialog's blank band (check, fix if real)
- [x] 3. Bug 3: 404s in demo mode (check against v0.1.0)
- [x] 4. `pnpm check`, full web e2e, status `review`, completion report

## Work log (append-only; newest last)

| Date       | What was done                                                     | Commit  | Checks                                                                                        |
| ---------- | ----------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| 2026-10-21 | Bug 1: `graphRunDefaults` in core; server and web read it         | 8d8d12b | format ✓ lint ✓ typecheck ✓ test 4034/4034 ✓ build ✓; e2e 6 projects 31/31, workflow-live 5/5 |
| 2026-10-21 | Bug 2: a tall dialog opens at its title (focus without scrolling) | 46f7319 | format ✓ lint ✓ typecheck ✓ test 4035/4035 ✓ build ✓; e2e ticket 14/14                        |
| 2026-10-21 | Bug 3 checked: old behaviour, left as is; progress file, `review` | (this)  | see the completion report                                                                     |

## Decisions and findings

### Bug 1: run defaults from the graph

- **Cause:** since WG-C, `GET /api/projects/:id/workflow` (version 1) answers 409
  `workflow_is_graph` once a project stores a graph. The Start dialog, the ticket's Run options,
  the New ticket dialog, the board badge and the Agents tab still read the reviewer and rework
  rounds from it. For a graph project they showed "couldn't be loaded" or "Project default" with
  no value, and the 409 came back on every stream notice.
- **One rule:** `graphRunDefaults(graph)` (`packages/core/src/workspace/graph/run-defaults.ts`,
  exported from `@acp/core`):
  - the reviewer is `agent` with a change reviewer, else `lead`;
  - the rounds are the most rounds on any `rework` edge, capped at `MAX_REWORK_ROUNDS`.

  The server's `projectRunDefaults` (moved from `board/service.ts` to `workflow/graph.ts`) and the
  web's `projectRunDefaults` both call it on the same graph, so they cannot disagree.

- **`legacyV1` is not read (decided).** `GET /workflow-graph` serves the migrated graph for
  `stored: 'v1'` and `'default'`, and that graph carries `legacyV1` (`effectiveWorkflow` uses
  `migrateWorkflowV1`). But the editor also keeps `legacyV1` on a stored graph after a template or
  an edit, for "Restore my earlier setup". There it can describe another workflow: "Lead only"
  with a stale agent reviewer, for example. So the function reads the graph only. For a migrated
  graph the answer equals `reviewStageOf(v1)`, which is tested for every version 1 combination
  (168 × 4 project modes in core). The server parity test compares the old rule for every
  combination, the default, every template and a stale `legacyV1`, so behaviour is unchanged.
- **Web:** `useProjectGraph` (the editor's cached `GET /workflow-graph`) feeds the Start dialog,
  `useProjectRunDefaults`, `RunOptionsBadge` and the Agents tab. Their "Used by" stages now come
  from the graph's nodes (`stagesOfNodes`), as the server's `stagesUsing` does.
  - `LiveWorkflowV1` (the fallback for a server without run graphs) asks the project's version 1
    workflow only after the run's version 1 route answers. On a server with graphs that route
    404s whenever the run graph does, so the 409 is never asked.
  - `isWorkflowGraphPath` no longer lists the version 1 path, and `blockModesPaths`/`Schemas`
    (an alias of `workflowGraphPaths`) are removed.
- **Dead warnings removed:** the Start dialog's and Run options' "wider than the project" warning
  (`AutoRunWarning`), and the Start dialog's Full auto warning. They showed only while the
  defaults were known and the blocks were not. Both now come from the same graph, so that can't
  happen any more. With the graph read, a looser limit shows the no-effect note, as it already did
  on a server with graphs. The Run options keep Full auto's warning while the graph can't be read.
- **Tests:** vitest specs that served the version 1 route now serve the graph. Two plain-JSON
  fixtures were added: `projectGraph(o)` in `e2e/ticket-fixtures.ts`, checked equal to core's
  migration, and `PROJECT_GRAPH_PATH`. New tests:
  - stored v2 in the Start dialog, Run options, New ticket dialog and badge, with no version 1
    request;
  - the `LiveWorkflow` fallback;
  - the e2e `workflow-live` test "run options read the defaults of a graph saved in the editor":
    Lead only with 4 rounds saved in the editor, then New ticket, Start with options… (Cancel,
    never Start) and the ticket page, with no version 1 request and no run created.

### Bug 2: the Start dialog's blank band (a real bug, fixed)

- **Reproduced** in `ticket.spec.ts` at Playwright's 1280×720 window. The Start dialog is 883 px
  tall and focuses Start/Re-run (`data-autofocus`) at its foot. The plain `focus()` scrolled the
  overlay, which is the dialog's scroll container, down 278 px on open: the title sat at y = −199,
  and the description and "No limit" were hidden above the window. WG-E's element screenshot drew
  the part scrolled out of the overlay as blank, which made the band.
- **Fix:** `Dialog` focuses the target with `{ preventScroll: true }`. The dialog opens at its top
  (title at y = 79), and Enter still starts.
- **Checks:**
  - the e2e asserts Re-run is focused, the title is in view, and the first choice is between 0 and
    260 px from the top;
  - a vitest checks `preventScroll`.

  Both fail with the old code. The whole-dialog pictures are now taken in a window as tall as the
  dialog, scrolled to its top.

- **Screenshots** (git-ignored, in this worktree):
  - before: `.acp-data/wg-f/before/ticket-start-open-light.png` (the window on open) and
    `ticket-start-limit-{light,dark}.png`;
  - after: `.acp-data/wg-f/after/ticket-start-open-light.png` and
    `ticket-start-limit-{light,dark}.png`;
  - Bug 1: `.acp-data/wg-f/workflow-live-start-defaults.png`.

### Bug 3: 404s in demo mode (old behaviour, left as is)

- **Observed** on the demo server (a temporary e2e probe, not committed):
  - Board: no 4xx;
  - Workflow: `GET /api/projects/:id/agents` → 404;
  - `GET /api/control/token` is not asked on load. `csrfToken()` asks it only before a mutation,
    such as saving the graph or moving a ticket.
- **At v0.1.0 (`b6a1f27`, read with `git show`):**
  - `WorkflowPage.tsx` asked `workflowPaths.agents(projectId)` in the same way (line 95);
  - `csrfToken()` was the same;
  - the route gating was the same. Demo mode has no managed adapter, so no control, skills or
    agents routes: `bootstrap.ts` and `app.ts` mount them identically, and `git diff b6a1f27`
    shows no gating change.
- **Not new in v0.2.0**, so it is left unchanged, as the task asked.
