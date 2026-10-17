# U-A — Foundation: tokens, fonts, icons, primitives, motion

> Progress file for U-A. Only the agent working on U-A edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope, owned paths and rules: `docs/ui-refresh/README.md`.

| Field   | Value               |
| ------- | ------------------- |
| Status  | review              |
| Owner   | U-A agent           |
| Branch  | `wp/u-a-foundation` |
| Started | 2026-10-17          |
| Updated | 2026-10-17          |

## Baseline

`pnpm --filter @acp/web build` on `feature/ui-refresh` (`4cfeb90`):

- `index.css` 81.39 kB (gzip 14.33 kB)
- `index.js` 1,294.48 kB (gzip 376.65 kB)

## Work log (append-only; newest last)

| Date       | What was done                                                                     | Commit    | Checks                          |
| ---------- | --------------------------------------------------------------------------------- | --------- | ------------------------------- |
| 2026-10-17 | Claimed U-A                                                                       | `f2360ec` | —                               |
| 2026-10-17 | Tokens v2, Geist fonts, lucide icons, primitives, motion, test setup, tests       | `33d3083` | web: fmt, lint, tsc, 507, build |
| 2026-10-17 | Removed 7 unused components and their tests                                       | `325b7d6` | web: fmt, lint, tsc, 497, build |
| 2026-10-17 | Design checkpoint: dark elevation retuned, 2 AA pairs fixed, DESIGN.md v2 section | `8e67145` | pnpm check 2119/2119, e2e 49/49 |

## Handoff notes (for U-B…U-F)

- **New shared parts** in `src/components/`: `Dialog`, `Menu`/`MenuItem`/`MenuLabel`/
  `MenuSeparator`, `Popover`, `Tabs`/`TabList`/`Tab`/`TabPanel`, `Segmented`, `Skeleton`/
  `SkeletonText`/`SkeletonCard`/`LoadingBlock`, `BrandMark`, `Badge` (in `Pill.tsx`), `fieldClass`/
  `labelClass`/`hintClass` (in `Input.tsx`), motion presets (`motion.tsx`). None is adopted by a
  feature yet (that is your WP); Radix code is tree-shaken out until you import it.
- **Dialog** has the board dialog's API (`title`, `description`, `onClose`, `testId`, `wide`, plus
  `closeLabel`). Differences in mechanics: a backdrop click is a **pointerdown** outside (tests:
  `fireEvent.pointerDown`), and focus returns to the opener **on the next tick** (tests: `waitFor`).
  Radix hides the rest of the page from assistive tech while it is open (`aria-hidden` siblings).
- **Menu** opens on pointerdown, ArrowDown/Enter/Space, and on a click with `detail === 0` (so
  `fireEvent.click` works); roving focus moves on the next tick (`waitFor`). Not modal by default.
  Radix menu items are `div role="menuitem"`, not buttons.
- **Tabs**: Radix selects on mousedown and keys; a click also selects. Arrow-key focus moves on the
  next tick.
- **Radix `data-state`:** triggers, tabs, panels and contents get Radix's own `data-state`. Never
  put the app's `data-state`/`data-status`/`data-role` on them (README rule 4).
- **Tooltip/InfoTip stay hand-built** (restyled): Radix Tooltip opens on pointer move after a
  delay, never on tap, and renders its text twice, which would change InfoTip's tap behaviour and
  break the tests' exact-text and `aria-describedby` checks.
- **Primary buttons** use `accent-fill` (not `accent`), because the dark `accent` is light. Features
  that hand-roll `bg-accent text-accent-ink` buttons (AgentCanvas send, control `bits.tsx`) should
  switch to `Button`/`buttonClass('primary')`.
- `QueryView` now shows a skeleton; the loading words stay in the DOM, visually hidden.
- `hover` is the new hover token; `hover:bg-sunken` in features still works but in the dark theme
  `sunken` is now _below_ `panel` (darker), so prefer `hover:bg-hover`.

## Blockers / proposed contract changes

_None._ No dependency, contract or shared-file change was needed.

## Completion report (AGENTS.md §9) — U-A

1. **Summary:** v2 design tokens (light/dark, same names plus new ones), bundled Geist fonts,
   lucide icons under the existing names, rebuilt and new shared primitives (Radix Dialog, Menu,
   Popover, Tabs; Segmented, Skeleton, Badge, BrandMark, one field style), MotionConfig and motion
   presets, jsdom stubs, new component tests, 7 dead components removed, DESIGN.md "Visual
   system" v2.
2. **Files changed (packages/web):**
   - modified: `src/index.css`, `src/main.tsx`, `tests/setup.ts`, `DESIGN.md` (Visual system
     section and the v2 note's last sentence), `src/components/`: Button, Card, DataTable, DemoBanner, Details, EmptyState, ErrorNotice,
     InfoTip, Input, PageHeader, Pager, Pill, ProvenanceBadge, QueryView, ShortId, StatCard,
     Tooltip, icons (`.tsx`), `tests/components/usage.test.tsx`;
   - created: `src/components/{BrandMark,Dialog,Menu,Popover,Segmented,Skeleton,Tabs,motion}.tsx`,
     `src/components/fonts.css`, `tests/components/primitives.test.tsx`, this file;
   - deleted: `src/components/`: Panel, SessionTable, EventList, UsageTotals, ParentInfo,
     LegacyEstimatedCost, StatusPill (`.tsx`), `tests/components/status-parent.test.tsx`.
3. **Commands and results:** `pnpm check` (format ✓, lint ✓, typecheck ✓, test 2119/2119 ✓ —
   web 497, server 419, orchestrator 451, adapter-claude-code 323, core 249, db 168,
   adapter-demo 12 — build ✓). `ACP_E2E_PORT=8251 ACP_E2E_CONTROL_PORT=8261 pnpm --filter
@acp/web test:e2e`: 49/49 passed (also 49/49 on the baseline).
4. **Acceptance criteria:**
   - tokens light/dark, names kept, new tokens added → met (`index.css`; charts/graphs unchanged
     and e2e `.recharts-surface`/React Flow checks pass);
   - fonts bundled, latin only, no network → met (two `woff2` in `dist/assets`);
   - icons on lucide with `IconProps`, aria-hidden, 1.75 → met (`primitives.test.tsx` "icons");
   - primitives restyled/rebuilt on tokens, no raw colors in ErrorNotice/ProvenanceBadge → met;
   - Tabs, Dialog, Menu, Popover, Segmented, Skeleton with tests → met (17 tests);
   - MotionConfig reducedMotion user + presets → met (`MotionProvider` in `main.tsx`);
   - setup stubs + `skipAnimations` → met;
   - dead components removed after grep → met;
   - BrandMark from tokens → met;
   - DESIGN.md Visual system v2 → met;
   - no text, role, test id or data-attribute change → met (all unit and e2e tests unchanged and
     passing).
5. **Assumptions:** body stays 14px (principle 4 asks for readable text; the plan allows 13–14);
   the font `@font-face` lives in `src/components/fonts.css` (imported by `main.tsx`) because the
   fontsource CSS would bundle every subset; Tooltip/InfoTip kept hand-built (see handoff notes);
   in dark mode `sunken` sits between canvas and panel (DESIGN.md explains).
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:** `TokenCount` is now unused by app code (only its tests use it; it
   was not on the removal list); the Shell logo gradient (`#ec4899`) and modal hex backdrops are in
   U-B/U-C files; features still carry their own tab/dialog/menu/segmented/field copies until
   U-B…U-F adopt the shared ones.
8. **Next recommended task:** the owner's design checkpoint on the screenshots, then U-B…U-F in
   parallel.
