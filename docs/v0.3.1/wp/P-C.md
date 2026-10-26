# P-C

> Progress file for P-C. Only its agent edits it. Plan: [../README.md](../README.md); look:
> [packages/web/DESIGN.md](../../../packages/web/DESIGN.md) ("Linking blocks in the Workflow
> editor"). Owner request (2026-10-26): "when dragging and joining the blocks it is very hard as of
> now, we need it butter smooth flow to link between the blocks. Easy drag and link; if we need new
> libraries we can use." Web only; `elkjs` allowed if needed.

| Field  | Value                                             |
| ------ | ------------------------------------------------- |
| Status | review                                            |
| Branch | `wp/p-c-linking`, on `release/0.3.1` at `a6bafd6` |

## Done

Every way of linking goes through `resolveLink` (core's `canConnect`); the editor adds no rule.

1. **Start anywhere** (`nodes.tsx`): a connector on each side of every block a link can start
   from: a 14px dot in a 28px target (25px and 12.6px on screen at the usual 90% fit), shown on
   hover, focus or selection; the right one faintly always. A thin strip along each edge starts a
   link too. The right connector is a focusable button ("Link from <block>: press Enter, then
   choose a block").
2. **Drop anywhere** (`ConnectionLine.tsx`, `linking.ts` `snapTarget`): a smooth bezier that snaps
   onto the nearest valid block within 80 screen px and meets the side facing it (solid once
   snapped, dashed before); valid blocks glow, the snapped one more, invalid ones fade to 35%,
   other links fade back. A drop on a block or within 8px of its border counts, valid or not (a
   refused drop says why).
3. **One fitting kind links at once** (`linkOutcome`); the chooser opens only when several fit.
4. **Click to connect**: click or Enter on a connector, then click or Enter on a block; a status
   note with Cancel; Escape cancels. **"Link to…"**: the block panel's button (it replaces the
   add-link form) and the block's context menu (right-click, the context-menu key, Shift+F10),
   only the valid ends (`linkChoices`), one item per kind: the block's name and the kind in short.
5. **Reconnect**: `edgesReconnectable`; the drop is resolved in `onReconnectEnd`
   (`resolveReconnect`, on the graph without the link) so a drop anywhere on a block counts; the
   link keeps its kind (and rework rounds) when it fits; an invalid block is refused and the link
   stays; empty canvas snaps it back. The selected link (drawn above the blocks) shows round grips.
6. **Undo and redo** (`history.ts`): ⌘Z / ⇧⌘Z (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y elsewhere) outside
   text fields and dialogs, plus toolbar buttons. Links added, removed and moved; blocks added,
   removed (with their links, one step) and moved; panel edits (typing in one field is one step);
   templates; Tidy layout. At most 50 steps. "Unsaved changes" follows the graph, so undoing back
   to the saved graph clears it.
7. **Tidy layout**: the existing automatic layout (`layout.ts`, `routing.ts`), reached by dropping
   the saved positions (`tidyGraph`); an eased 320ms glide, then a refit. Off while already tidy.
8. **Performance** (below). 9. **Reduced motion and themes**: no glide with reduced motion (and the
   app-wide rule shortens every transition); no pulsing; light and dark checked in screenshots.

## Decisions

- **elkjs was not needed.** The existing layout routes every template with no links crossing or
  running over each other, and the hand-built fixture with at most one unavoidable crossing
  (`countConflicts` in `workflow-editor-state.test.ts`); Tidy puts blocks back in it. No
  dependency added, so there is no `chore(deps)` commit.
- Links end anywhere on a block (snap), so the left `in` handle is no longer drawn; it stays as
  the stored end for routing. Old e2e helpers that drop on `handle-in-*` still work (the slop).
- The link being made lives in a small external store (`link-store.ts`) read by selector, not in
  React state, so a pointer move re-renders only the blocks whose look changes.
- React Flow's own click-to-connect is off (`connectOnClick={false}`); ours resolves through core.
- Every link's ends are grabbable; only the selected link draws its grips (it sits above the
  blocks, so its grips are never covered).
- The WIP commit was squashed into checkpoints; the rest of the previous agent's work was kept.

## Bundle

Built with `vite build`, `release/0.3.1` (`a6bafd6`) against this branch: main JS
2,071.34 → 2,089.42 kB (gzip 608.09 → 614.16 kB, +6.1 kB); CSS 113.12 → 116.09 kB (gzip +0.4 kB).
No new chunk, no new dependency.

## Performance (measured)

A throwaway Playwright probe (not committed) on the built UI, 1440×1240, headless Chromium: 37
blocks and 68 links (30 extra helpers, each assigned by the lead and reviewed), at the fitted 30%
zoom. Frame intervals from `requestAnimationFrame`; "touched" counts blocks whose DOM changed
(apart from the moved block's transform).

| Interaction                     | CPU | Frames | Mean    | p95     | Max     | Blocks touched |
| ------------------------------- | --- | ------ | ------- | ------- | ------- | -------------- |
| Drag a block (90 pointer moves) | 1×  | 98     | 16.8 ms | 16.8 ms | 33.4 ms | 1              |
| Drag a link across 120 moves    | 1×  | 124    | 16.7 ms | 16.7 ms | 16.8 ms | 8 (of 37)      |
| Drag a block                    | 4×  | 293    | 17.2 ms | 16.8 ms | 83.3 ms | 1              |
| Drag a link                     | 4×  | 493    | 17.2 ms | 16.8 ms | 33.4 ms | 1              |

60 fps held; the single long frames are the drop (one graph update). With 37 blocks the fitted
view reaches the 30% minimum zoom and part of the graph is outside the canvas (pan to reach it);
see Known gaps.

## Tests

- vitest: `workflow-editor-linking.test.ts` (23, new); `workflow-editor.test.tsx` (links through
  "Link to…"; a new test for the menu's list, Undo/Redo buttons and keys).
- e2e: `workflow.spec.ts` four new tests (side connector and snap, click-to-connect and the
  keyboard and block menu, moving link ends, undo/redo and Tidy); `workflow-live.spec.ts` links
  through "Link to…".
- Screenshots (1440, light and dark): `.acp-data/p-c-shots/` (git-ignored): `workflow-snapped`,
  `workflow-dragging`, `workflow-link-menu`, `workflow-untidy` / `workflow-tidy`, and the
  chooser, refused, default views.

## Known gaps

- A graph of 30+ blocks does not fit the canvas at the 30% minimum zoom (the canvas keeps its
  height cap); panning works. Raising the cap or lowering the minimum zoom is a separate change.
- Only the right connector is in the tab order (the other three are pointer shortcuts for the same
  action); "Link to…" is the full keyboard way.

## Log

- 2026-10-26: started; side connectors, curved line, history, linking helpers (WIP, paused by
  the owner).
- 2026-10-26: resumed from the WIP commit; finished "Link to…", drop slop, `linkOutcome`, reconnect
  grips, short kind names in the menu; unit and e2e tests; perf measured; rebased onto
  `release/0.3.1`; WIP squashed into checkpoints; status review.
