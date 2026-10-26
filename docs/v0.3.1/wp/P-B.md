# P-B

> Progress file for P-B. Only its agent edits it. Plan: [../README.md](../README.md); binding:
> [ADR-0028](../../decisions/0028-agent-effort-optional-checks-finish-block.md); look:
> [packages/web/DESIGN.md](../../../packages/web/DESIGN.md) ("Effort, optional checks and the
> Finish block"). Web only: the effort select, removable Checks blocks with plain words and the
> warning, the Finish block in the editor and the live graph.

| Field  | Value                                           |
| ------ | ----------------------------------------------- |
| Status | review                                          |
| Branch | `wp/p-b-web`, from `release/0.3.1` at `5994a8d` |

## Done

- **Effort** (ADR-0028 §1): the agent block panel's **Effort** select under Model (Default (the
  model decides), Low, Medium, High) with its hint; saved as `effort`, dropped for Default
  (`NodePatch.effort`, `patchNode`). A "High effort" chip on the canvas block and on the live
  graph's block; an **Effort** row in the agent's Details (`SidePanel.tsx`, from the run's own
  graph, the live graph's query). New blocks and templates leave it out.
- **Optional Checks blocks** (§2): `isRemovable` is true for every Checks block. Removing the merge
  block adds `lead → ticket-merge` (`merge`) when core's `canConnect` allows it; Add block →
  Checks offers **Checks before merge** while there is none (`insertMergeBlock`: `lead → block →
ticket-merge`, only when both links are allowed). Plain names and texts per place on the block
  (its place over its name) and in the panel, with an "Optional. Without it, …" line. The
  Problems list shows whatever warning core gives (no web-side rule).
- **Finish block** (§3, `features/workflow/finish.ts`, pure): `finishView` draws the graph with
  `owner-merge` as the Finish block and `ticket-merge`/`done` hidden; links around them keep their
  stored ids (into the ticket merge → onto Finish when it goes straight to your merge; out of the
  ticket merge → from the block that feeds it); `finishIssues` moves problems of hidden steps and
  undrawn links onto the block. The editor (`flow.ts`, `layout.ts`, `nodes.tsx`
  `FinishBlockView`, `GraphEditor.tsx`, `NodePanel.tsx` `FinishPanel`, `WorkflowPage.tsx`) and
  the live graph (`live-graph.ts` `finishState`, `LiveGraphNodes.tsx` `LiveFinishBlock`) use it.
  A link drawn to Finish resolves through `resolveLink` (state.ts) to the ticket merge or your
  merge, whichever `canConnect` allows. Save writes the reducer's graph: the three nodes and
  every link unchanged (tested).
- **Copy** (`lib/copy.ts`): `EFFORT_COPY`, `FINISH_COPY` (new); the gate label "Merge into main"
  is "Finish" (editor, live graph, version 1 graph); texts say "its target" / the real target,
  never "main" for it; `HARNESS_BLOCKS_COPY` names, hints, `optional`, palette `merge`.

## Decisions

- The Finish block is the `owner-merge` node (its id, position and selection), so test ids stay
  `block-owner-merge` / `live-block-owner-merge`; `block-done`, `block-ticket-merge`,
  `live-block-done` no longer exist (e2e specs updated: workflow, workspace, review-loop-live).
- Editor target: `setup.branching.defaultTargetBranch`; live target:
  `run.ticketBranch.baseBranch`; else "your target branch".
- Live Finish state: Done once `done` is done; else your merge's state when not waiting/off; else
  failed when the ticket merge failed; else waiting.

## Waiting on P-A

- Under the current core rules removing the merge block is an error (`missing-node`), so the e2e
  editor test `effort-finish.spec.ts` › "the editor: …" fails at "data-errors 0" until P-A's
  validation lands. It passed against a local, uncommitted emulation of the planned rules (checks
  `minPerGraph` 0, a `no-checks` warning, `merge` lead → ticket-merge). Its "lead → Finish is
  invalid" check in `workflow.spec.ts` assumes P-A allows `lead → ticket-merge` only without a
  merge block.
- If P-A wires "no merge block" differently from a `merge` edge lead → ticket-merge, only
  `rejoinLeadMerge`/`insertMergeBlock` in `editor/state.ts` need to follow.

## Tests

- vitest: `effort-finish.test.tsx` (9), `live-finish.test.tsx` (5); updated
  `workflow-editor-state`, `harness-blocks-state`, `harness-blocks-panel`, `live-graph`.
- e2e: `effort-finish.spec.ts` (2, new project `effort-finish`); updated `workflow.spec.ts`,
  `harness-blocks.spec.ts`, `workspace.spec.ts`, `review-loop-live.spec.ts`.
- Screenshots (1440, light and dark): `.acp-data/p-b-shots/` (git-ignored): agent panel with
  Effort, a workflow without checks (warning), the Finish panel, the live graph's Finish block.

## Log

- 2026-10-26: claimed; effort, optional Checks blocks and the Finish block in the editor and the
  live graph (checkpoint 1).
- 2026-10-26: unit tests; e2e spec and fixes to existing specs; DESIGN.md; status review.
