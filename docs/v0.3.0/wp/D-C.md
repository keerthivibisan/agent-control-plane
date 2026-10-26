# D-C

> Progress file for D-C. Only its agent edits it. Plan: [../README.md](../README.md) (part 3, the
> GitHub-like redesign); binding look: [packages/web/DESIGN.md](../../../packages/web/DESIGN.md) v3.
> Owner feedback: the Workflow editor is one of the two least clear pages. Same capabilities, much
> clearer; no change to the graph format, the validation rules or the save behaviour.

| Field  | Value                                                |
| ------ | ---------------------------------------------------- |
| Status | review                                               |
| Branch | `wp/d-c-workflow`, from `release/0.3.0` at `e71a5b4` |

## Done

- **Page structure** (`WorkflowPage.tsx`): a sticky header (title, ⓘ, one line; Problems with a
  count, Templates…, Discard changes, Save; the unsaved / saved / "Fix the problems to save" line
  under the buttons). It sits under the demo banner when there is one (measured). The canvas is a
  bordered Box; beside it (from 1200px, under it below) the selected block's or link's settings,
  or the Problems list when nothing is selected. Project defaults stay below (footer padding fixed
  to the v3 Box's 16px).
- **Canvas Box** (`GraphEditor.tsx`): a toolbar row on `subtle` with **Add block ▾** (a menu in two
  groups, Agents / Reviewers and testers; every item says what it adds, a full one stays listed and
  disabled with the reason in plain text), **Legend** (toggle, remembered in `acp.workflow.legend`),
  **How this works** (popover, three sentences) and the zoom controls (−, the level, which resets to
  100%, +, Fit). No minimap: with at most a few dozen blocks it adds nothing.
- **Blocks** (`nodes.tsx`, sizes in `layout.ts`): agents are square cards of one size per kind
  (216×108 read-only, 216×132 for helpers, the pool and the tester): role icon and kind, the name in
  bold, the model, a skills count and the agent file as small outlined labels, the mode badge on
  blocks that edit (×n for a named helper). The lead is framed in `ink` (1.5px). Steps are light
  pills (172×40; Ticket and Done 112×40), yours with the accent "you" icon. Problems are a small
  icon (circle for errors, triangle for warnings) whose tooltip lists what is wrong.
- **Links** (`routing.ts`, `edges.tsx`): a custom orthogonal edge. Rows by kind (plan path, work,
  merge chain); forward links side to side, links between rows in lanes in the gap between the
  rows, back links as loops (findings and reviews over the top, rework underneath), each loop at
  its own height; hidden handles at 15/30/50/70/85% keep links apart where they meet a block. Lanes
  are chosen per group by trying every order and keeping the one with the fewest crossings. Calm,
  neutral styles per kind (DESIGN: dashes and weight, never the accent); "Rework ×n" as a small
  pill; the selected link in the accent over a soft halo; while a block or link is selected, the
  other links fade. Templates draw with no crossings (tested); the dense fixture with one.
- **Layout**: the merge chain starts under the lead (its merge line is straight) and runs at the
  steps' width; Done hangs under your merge only when the row would sprawl.
- **Adding and connecting**: while a link is dragged the blocks `canConnect` allows are lit (accent
  border, tint, a larger in-handle) and the others fade; a drop anywhere on a block (not only on
  its handle) links it; when several kinds fit, a small chooser opens at the drop point (Radix
  popover: focus on the first kind, Escape or a click away closes it, focus back to the block).
- **Problems**: grouped "Fix these to save" then "Warnings (you can still save)", a count on the
  Box header and on the page header's Problems button; a click selects and shows the block or link,
  whose panel lists its own problems at the top. A refused save with server issues shows the list.
- **Keyboard**: as before (Delete, arrows), plus Escape clears the selection.
- **Words**: the new strings are in `features/workflow/editor/copy.ts` (`EDITOR_COPY`) because D-C
  owns only `features/workflow/**`; they can move into `WORKFLOW_GRAPH_COPY` at merge.

## Not changed

The graph format, `canConnect` and the validator, the reducer and save, the live run graph
(`features/ticket/*`: its own layout and blocks; left alone to avoid D-B's paths).

## Tests

- vitest: `workflow-editor.test.tsx` (menu, panel issues, header counts, skills count),
  `workflow-editor-state.test.ts` (new handles; valid targets match `allowedEdgeTypes`; fading;
  no crossings in templates).
- e2e `workflow.spec.ts`: new tests for the lit targets and drop on a block body, the chooser by
  the drop point (focus, Escape), the selected link in the accent, legend/how/zoom. Other specs
  (`workflow-live`, `workspace`, `review-loop-live`) switched to the Add block menu and the
  Problems button where a selection hides the list.
- Screenshots: `.acp-data/d-c-shots/` (git-ignored), 1440 light and dark.

## Log

- 2026-10-22: done; status review.
