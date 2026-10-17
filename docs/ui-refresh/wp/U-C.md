# U-C — Board

> Progress file for U-C. Only the agent working on U-C edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope, owned paths and rules: `docs/ui-refresh/README.md`.

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
| Owner   | U-C agent      |
| Branch  | `wp/u-c-board` |
| Started | 2026-10-17     |
| Updated | 2026-10-17     |

## Work log (append-only; newest last)

| Date       | What was done                                                               | Commit    | Checks                                   |
| ---------- | --------------------------------------------------------------------------- | --------- | ---------------------------------------- |
| 2026-10-17 | Claimed U-C                                                                 | `136e1b3` | —                                        |
| 2026-10-17 | Board on v2 tokens, shared Dialog/Menu, lucide icons, motion, skeleton      | `c3136d2` | fmt, lint, tsc, 2119 tests, build        |
| 2026-10-17 | e2e: Move menu and New ticket dialog with the keyboard (marked U-C section) | `82473eb` | e2e 50/50                                |
| 2026-10-17 | Rebased on `feature/ui-refresh` (`9912864`, U-D merged); re-checked         | —         | fmt, lint, tsc, 2121 tests, build, 50/50 |

## Notes for the coordinator and other WPs

- `features/board/Dialog.tsx` is **kept**: `features/skills/editor-parts.tsx` (U-E) still imports
  it. The board itself no longer uses it; delete it once U-E moves to `components/Dialog`.
- The shared `Menu` (Radix) does not loop arrow keys. The board's menu always wrapped (and its test
  says so), so `MoveMenu` adds the wrap in a small keydown handler around its items. A `loop` prop on
  the shared `Menu` (passed to `RadixMenu.Content`) would make that handler unnecessary.
- The comment above `MoveIcon`…`ChoreIcon` in `components/icons.tsx` ("the board keeps its
  hand-drawn set until then") is now stale; the board uses them.
- Column dimming during a drag goes through Motion's `animate.opacity` (Motion owns the inline
  opacity of the column, so an `opacity-*` class would be overridden).

## Blockers / proposed contract changes

_None._ No dependency, contract or shared-file change was made.

## Completion report (AGENTS.md §9) — U-C

1. **Summary:** the Board in the Linear/Vercel style on the U-A tokens and shared parts: refined
   header and live line, quiet column wells with stage glyphs and count badges, cleaner rails,
   a denser ticket card with lucide type/priority icons, the shared Dialog (New ticket, cancel
   confirm) and Menu (Move), a board-shaped skeleton, the shared EmptyState in a dashed frame, and
   subtle motion (columns slide when a neighbour folds, a card glides to its new column).
2. **Files changed (packages/web):**
   - modified: `src/features/board/{BoardColumns,BoardPage,MoveMenu,NewTicketDialog,TicketCard,
icons}.tsx`, `tests/features/board.test.tsx`, `e2e/shell.spec.ts` (add-only U-C section at the
     end);
   - created: `docs/ui-refresh/wp/U-C.md`;
   - deleted: none (`features/board/Dialog.tsx` is still imported by U-E's skills editor).
3. **Commands and results** (after the rebase on `9912864`):
   - `pnpm format:check` ✓, `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm build` ✓;
   - tests 2121/2121 ✓ (core 249, adapter-claude-code 323, adapter-demo 12, db 168, orchestrator
     451, web 499, server 419), run with `pnpm -r --workspace-concurrency=1 run test`. Plain
     `pnpm check` ran its tests in parallel under a load average of 22–38 (parallel agents): every
     package passed except one git-heavy server test that hit the 5 s timeout (a different test each
     run); those tests pass when rerun, and server passes 419/419 on its own;
   - `ACP_E2E_PORT=8451 ACP_E2E_CONTROL_PORT=8461 pnpm --filter @acp/web test:e2e`: 50/50 ✓
     (an earlier run had the legacy control spec's two-helper test time out under load; it also
     did on the baseline before U-C, and passed 4/4 when rerun).
4. **Acceptance criteria:**
   - header refined (name, counts line, Tokens/Harness links, New ticket) → met;
   - columns and rails: R-R behaviour kept (empty columns fold, scroll hint, "N more tickets",
     drag and drop incl. a drop on a rail), cleaner headers with count badges, subtle surfaces,
     smooth open/fold → met (unit tests and `shell.spec.ts` board test unchanged and passing);
   - ticket card: denser hierarchy, mono key, label chips, lucide priority icon with its word,
     needs-you badge, footer meta, hover/focus states, motion on move with reduced motion
     respected (MotionConfig `reducedMotion="user"`) → met;
   - board icons on lucide → met (`features/board/icons.tsx` re-exports `components/icons` and
     adds lucide stage/priority glyphs);
   - New ticket on the shared Dialog with native fields and `fieldClass` → met; Move on the shared
     Menu with menu/menuitem roles and ArrowDown behaviour → met (unit test and new e2e);
   - remove `features/board/Dialog.tsx`/`MoveMenu.tsx` once unused → partly: `MoveMenu.tsx` is now
     the board's thin wrapper on the shared Menu; `Dialog.tsx` stays for U-E (reported above);
   - empty board with the shared EmptyState → met;
   - text, roles, accessible names, `data-testid`, `draggable`, `data-collapsed` unchanged → met
     (copy untouched; tests changed only for Radix mechanics: portal → `screen`, `waitFor` focus).
5. **Assumptions:** priority uses lucide chevrons (down, equals, up, double up), which read better
   at 14 px than lucide's signal bars; Working uses `CirclePlay`; the Hide button on an unfolded
   column shows on hover/focus (always on touch screens).
6. **Contract or shared-file changes needed:** none required. Optional: a `loop` prop on
   `components/Menu.tsx` (U-A's file) would replace MoveMenu's wrap handler.
7. **Known gaps / follow-ups:** delete `features/board/Dialog.tsx` after U-E migrates; refresh the
   stale comment in `components/icons.tsx`; the shared EmptyState's text column is narrow
   (`max-w-md`) in the wide board frame.
8. **Next recommended task:** coordinator review of `wp/u-c-board` (screenshots in the report),
   then merge; U-V's keyboard pass should include the Move menu and the column Hide/Show buttons.
