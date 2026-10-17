# WG-E: Web live run graph

> Progress file for WG-E. Only the agent working on WG-E edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-E row and the "WG-0 refinements".

| Field   | Value                                          |
| ------- | ---------------------------------------------- |
| Status  | paused                                         |
| Owner   | WG-E agent (Claude Code)                       |
| Branch  | `wp/wg-e-live` (from `feature/workflow-graph`) |
| Started | 2026-10-18                                     |
| Updated | 2026-10-18                                     |

## Tasks

- [x] 1. Client for `GET /api/runs/:id/workflow-graph` (lib/api.ts, additive) and the project
      graph read for the run-option ceilings
- [x] 2. Live run graph on the ticket page: the run's snapshot graph, read-only, square blocks
      (positions or a layered layout), node states, agents per node (click selects), editing
      blocks' mode for this run and the sandbox marker, review counts, rework counts per rework
      link (the review agent's direct rework shown as such), held final stage
- [x] 3. Fallback: the version 1 view when the endpoint answers 404 or 409
- [x] 4. Run options read as a ceiling ("at most"): Start dialog, the ticket's run options, the
      New ticket dialog; the no-effect note; reviewer and rework-round hints
- [x] 5. Change cards: the review agent as the decider of a direct rework, route (c)'s rounds
- [x] 6. Skills & Agents "Used by": `usedByNodes` labels, else the version 1 stages
- [x] 7. Copy in plain words (own section in `lib/copy.ts`)
- [x] 8. vitest and e2e (mocked routes; scenario (c) fixture; screenshots)
- [ ] 9. Status `review`, `pnpm check`, full e2e, completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                             | Commit  | Checks                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 2026-10-18 | Claimed WG-E                                                                                                              | 8bacf4e | format ✓ lint ✓ typecheck ✓ test 3909/3909 ✓ build ✓ |
| 2026-10-18 | Live run graph with the version 1 fallback, run options as a limit, direct rework on change cards, Used by blocks; vitest | (this)  | see commit                                           |

| 2026-10-18 | e2e for the live graph and the run limit; wider live blocks; DESIGN.md | 1fa20b1 | format ✓ lint ✓ typecheck ✓ test 3937/3937 ✓ build ✓; e2e 65/65 |
| 2026-10-18 | Paused by the owner; resume notes | (this) | format ✓ |

## Resume here (paused 2026-10-18)

- **Half-done:** nothing in code. Tasks 1–8 are committed (`56b2619`, `1fa20b1`), `pnpm check`
  passes (3,937 tests), and the full e2e suite passed 65/65 (ticket project 14/14 after the last
  width change).
- **Uncommitted files:** none.
- **Next concrete step (task 9):** set status `review`, add the AGENTS.md §9 completion report to
  this file (numbers above; screenshots in the worktree's `.acp-data/screens/`,
  `ticket-live-graph-*`, `ticket-live-graph-page-*`, `ticket-start-limit-*`), rerun `pnpm check`,
  and hand back to the coordinator.
- **Open questions for the coordinator / WG-C:** (1) the run's limits must be only the ticket's
  and run's modes when set, never the project's mode, so "No limit" means each block's own mode;
  (2) whether both the ticket's and the run's limits apply (then a run limit looser than the
  ticket's changes nothing); (3) the CHANGELOG line for refinement 14 is left to the release.
- **Depends on WG-C:** `GET /api/runs/:id/workflow-graph`, `GET /api/projects/:id/workflow-graph`,
  `SkillSummaryDto.usedByNodes`; until served, the ticket page shows the version 1 view.

## Decisions and findings

### The live run graph

- **Where:** `features/ticket/LiveWorkflow.tsx` asks `GET /api/runs/:id/workflow-graph` first.
  An answer draws `LiveRunGraph` (new files next to it: `live-graph.ts` pure model and layout,
  `LiveGraphNodes.tsx` block views, `live-frame.tsx` the state ring shared with version 1,
  `live-parts.tsx` the held notice and findings link). A **404 or 409** keeps the version 1 view
  (`LiveWorkflowV1`, unchanged); any other error hides the card, as the version 1 view did, rather
  than drawing the wrong graph. TicketPage is not changed: `onSelectAgent(id, stage)` gets the
  nearest version 1 stage of the block (`review` for a change reviewer, so its agent opens on the
  Changes tab).
- **Look:** the editor's block vocabulary (WG-D's `nodes.tsx` mirrored, not imported, since it
  is unmerged): square agent blocks with kind, name, model, skills and agent file; the lead in
  `ink`; steps on `sunken`; Ticket and Done pills. Blocks are 240×156 (the editor's are 208×132–148)
  to hold the mode, the sandbox marker and the agents. **Layout:** the owner's `position` when set,
  else the editor's three rows (stack gap 40 so a rework label fits between stacked helpers).
- **States:** every block has the version 1 ring and word; small steps (checks, ticket branch,
  plan approval, your merge) say their word only when working, waiting for you or failed, and
  your merge turns green once done. A block the server does not list is `waiting`.
- **Agents:** up to two chips per block (working first, then the newest) and "+N"; a chip shows
  its role, or its state when the role repeats the block's name or another agent's (review
  agents). A click on a chip shows that agent; a click elsewhere on the block shows its working,
  else newest, agent (as the version 1 view).
- **Modes:** "Mode: <mode>" from the node's `approvalMode` (the run's mode after tightening, as the
  server sends it) and "Sandboxed" when `sandbox` is true; nothing on read-only blocks or when
  the server sends no mode (a run without an approval policy).
- **Review:** the counts (`review`) on a "Changes" line above the canvas. Rework counts per
  rework link come from the run's change rounds (`RunDetailDto.changes[].reviews`): a change
  reviewer's link counts distinct rounds `decidedBy: 'reviewer'` with `decision: 'rework'` for its
  helper's changes and reads "Direct rework ×n"; the lead's link counts the lead's own rounds
  ("Rework ×n"). The owner's extra rounds are on the change cards, not on a link. A change
  reviewer with a rework link also says "Sends changes back to the helper itself".
- **Held final stage:** in REVIEW, a final reviewer or tester block waiting for you with nobody
  working on it offers Continue, named by its block label (the version 1 rule).
- **Not shown any more on the graph view:** "The workflow settings changed after this run
  started", since the graph is the run's own snapshot.

### Run options as a limit

- **"No limit" is a choice of its own.** With nothing sent, each block keeps its own mode, so
  a pre-selected project mode would have claimed a limit that is not applied. The Start dialog
  offers "No limit" first (when the ticket has no mode of its own), then the four modes; any mode
  the owner picks is sent as the run's limit, the project's mode included. The ticket's select
  starts with "No limit: each block's own mode" (stored as before: no ticket mode). The summary
  sentence under the choice uses the coordinator's wording.
- **No-effect note:** from the project's graph (`GET /api/projects/:id/workflow-graph`, the
  editor's path, read here for the blocks' modes only): a limit strictly looser than the loosest
  editing block (its own mode, else the project's) shows a neutral note. Unknown blocks (loading,
  or a server without graphs) never show it.
- **Warnings:** a limit can only tighten, so it never adds risk; the Full auto and widening
  warnings are kept only while the blocks are unknown (a server without graphs, where the old
  replacing behaviour still applies).
- **Reviewer and rounds:** kept, with hints that "Lead reviews" sends every change to the lead for
  this run or ticket, that "Review agent" follows the workflow, and that rework rounds replace
  every rework link's limit (unchanged, each link keeps its own).
- **New ticket dialog:** gets the note without a change to `features/board/**`:
  `useProjectRunDefaults` now also returns the blocks' modes.

### Change cards and Used by

- A round with `decidedBy: 'reviewer'` reads as one sentence, "Review agent sent it back to the
  helper for rework" (the copy's `decider.reviewer`, 'Review agent', for other decisions). The
  card shows "Review agent: n direct rework rounds · lead: m" and the overview row a "Direct
  rework ×n" badge apart from the lead's "Rework ×m".
- "Used by" names the blocks from `usedByNodes` when the server sends it, else the version 1
  stages; Delete names the blocks. Agent files have no `usedByNodes` in the contract, so they are
  read from the project's graph (`node.agent`), which needs no contract change.

### Depends on WG-C

- `GET /api/runs/:id/workflow-graph` (until it is served, every ticket page shows the version 1
  view), `GET /api/projects/:id/workflow-graph` (the no-effect note and agent "Used by"), and
  `SkillSummaryDto.usedByNodes`. Everything is tested on mocked responses only.
- **Assumption to confirm with WG-C:** the run's limits are the ticket's and the run's modes only
  when set (refinement 5), never the project's mode, so that "No limit" means each block's own
  mode. If WG-C applies both the ticket's and the run's limits, a run limit looser than the
  ticket's changes nothing too; the dialog then still says only what the blocks allow.

### Proposals (not made)

- None required. Optional: `AgentDefinitionSummaryDto.usedByNodes?` (core, coordinator) so the
  server answers agent files' blocks as it does for skills; the page reads the graph meanwhile.
- After WG-D merges, the live graph's block views and layout could share WG-D's `editor/nodes.tsx`
  and `layout.ts` (both are mirrored here because WG-D was unmerged).
- CHANGELOG (refinement 14, release): "a ticket or run mode is now a limit; it can't loosen a
  block". Not edited here (release notes).
