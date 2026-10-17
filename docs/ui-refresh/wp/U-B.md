# U-B — Shell: top bar, sidebar, switcher, palette

> Progress file for U-B. Only the agent working on U-B edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope, owned paths and rules: `docs/ui-refresh/README.md`.

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
| Owner   | U-B agent      |
| Branch  | `wp/u-b-shell` |
| Started | 2026-10-17     |
| Updated | 2026-10-17     |

## Work log (append-only; newest last)

| Date       | What was done                                                                   | Commit    | Checks                          |
| ---------- | ------------------------------------------------------------------------------- | --------- | ------------------------------- |
| 2026-10-17 | Claimed U-B                                                                     | `cdb448a` | —                               |
| 2026-10-17 | Shell refresh: toggleable sidebar rail, top bar, switcher, palette, transitions | `a0bdc44` | pnpm check 2130/2130, e2e 50/50 |
| 2026-10-17 | Rebased on `feature/ui-refresh` (`9912864`, U-D merged); to review              | this      | pnpm check 2130/2130, e2e 50/50 |

## Handoff notes

- **Sidebar state** (`src/app/sidebar-state.ts`): `acp.sidebar` in localStorage (`collapsed` /
  `expanded`); no value means "follow the screen" (rail at 1280px and below). ⌘B on Apple
  keyboards, Ctrl+B elsewhere; a handler that already called `preventDefault` (an editor using the
  keys) wins. The sidebar container carries `data-testid="sidebar"` and `data-collapsed="true"`
  in rail mode.
- **Top bar height** is 48px: the shell sets `--spacing-topbar: 3rem` on its root, so
  `h-topbar`, `top-topbar` (sidebar, DemoBanner) follow without touching `index.css`.
- **Shell tooltips** (`src/app/ShellTooltip.tsx`) are Radix Tooltip, only for the shell's icon
  controls (rail entries, sidebar toggle, theme, live dot): the shared Tooltip always centres above
  or below and clamps away from the screen edge, which puts a rail tip far from its icon. In tests
  they open on focus (`fireEvent.focus`), and in e2e on hover; their text is `role="tooltip"`.
- **Project switcher** composes Radix DropdownMenu directly (with `floatingClass`, `MenuLabel`,
  `MenuSeparator`) because its entries are links in a `navigation`; the shared `Menu` has only
  `menuitem` actions. Focus moves on the next tick (tests: `waitFor`).
- **Palette** is the shared `Dialog` (visible title "Command palette"); focus returns on the next
  tick. "New ticket" opens its dialog two ticks later so the palette's focus return doesn't pull
  focus out of it (needed while the board's own Dialog has no focus-in trap).

## Blockers / proposed contract changes

_None blocking._ Proposals (not made):

- **Data health tabs**: the plan asks for the shared Tabs. The two sections are addresses
  (`#/health`, `#/health/connection`) and the unit and e2e tests check `navigation` + `link` +
  `aria-current`; the shared `Tab` is a Radix button (`role="tab"`) that can't be a link. I kept
  the links and drew them exactly like the shared underline tab bar. To adopt the component itself,
  either accept the role change (tests move to `tablist`/`tab`/`aria-selected`) or give the shared
  Tabs a link variant (`TabLink`) in `src/components/Tabs.tsx` (U-A/coordinator file).
- **Shared Dialog focus return** (`src/components/Dialog.tsx`): restore the opener only when focus
  is still on `<body>` or inside the closed dialog, so a dialog opened right after another keeps
  focus without the palette's two-tick deferral.
- **Shared Menu**: a link item (`MenuLinkItem` or `asChild`) and a `role` option would let the
  switcher use `Menu` directly.
- **DESIGN.md "Layout"** (coordinator/U-V file) is now out of date; suggested wording: "Top bar
  (`TopBar.tsx`, sticky, 48px): the brand cell over the sidebar (BrandMark + app name), the trail
  (project switcher / page), ⌘K and the theme toggle. Sidebar (`Sidebar.tsx`): the full list
  (15rem) or a 56px icon rail with label tooltips, toggled by its footer button or ⌘B/Ctrl+B and
  remembered per browser (`acp.sidebar`); with no choice stored, the rail at 1280px and below. The
  active entry has an `accent-soft` fill and `accent` text. Pages fade in (200ms, 4px rise) on a
  page change." Also `--spacing-topbar` could become 3rem and `--spacing-sidebar-collapsed`
  3.5rem in `index.css`, after which the shell's override can go.

## Completion report (AGENTS.md §9) — U-B

1. **Summary:** the app frame refreshed in the Linear/Vercel style on the U-A tokens: a toggleable
   sidebar (full list or a 56px icon rail with label tooltips; button and ⌘B/Ctrl+B; remembered
   per browser; auto-rail at ≤1280px when nothing is stored), a 48px top bar with the BrandMark,
   a project / page trail, ⌘K and theme; the project switcher on Radix DropdownMenu; the palette on
   the shared Dialog; restyled Data health section tabs; subtle page transitions.
2. **Files changed (packages/web):**
   - created: `src/app/{Sidebar,TopBar,ShellTooltip,PageTransition}.tsx`,
     `src/app/{nav,sidebar-state}.ts`, `tests/app/sidebar.test.tsx`;
   - modified: `src/app/{Shell,ProjectSwitcher,HealthScreen}.tsx`,
     `src/features/palette/CommandPalette.tsx`, `src/lib/copy.ts` (add-only `SHELL_FRAME_COPY`
     at the end), `tests/app/shell.test.tsx`, `tests/features/palette.test.tsx`,
     `e2e/shell.spec.ts`; this file.
3. **Commands and results:** `pnpm check` after the rebase: format ✓, lint ✓, typecheck ✓,
   test 2130/2130 ✓ (web 508, server 419, orchestrator 451, adapter-claude-code 323, core 249,
   db 168, adapter-demo 12), build ✓. `ACP_E2E_PORT=8351 ACP_E2E_CONTROL_PORT=8361 pnpm --filter
@acp/web test:e2e`: 50/50 passed. (Before the rebase one run had control.spec "two helper
   agents" time out under load from parallel agents; it passed 4/4 alone and in the full rerun.)
4. **Acceptance criteria:**
   - toggleable sidebar: button + ⌘B/Ctrl+B (in the tooltip and `aria-keyshortcuts`), 56px rail
     with label tooltips, localStorage in try/catch, auto-collapse default, width transition off
     with reduced motion, `data-collapsed` → met (`sidebar.test.tsx`, e2e toggle test);
   - grouped nav from `PROJECT_PAGES`, lucide icons, accent active state, footer for the rail →
     met (screenshots `shell-board-*`, `shell-rail-*`);
   - top bar: slimmer, breadcrumbs, ⌘K, theme toggle, BrandMark, no `#ec4899` → met;
   - switcher on Radix DropdownMenu keeping roles, names, keys → met (shell tests, e2e);
   - palette on the shared Dialog keeping combobox/listbox/option, `aria-modal`, focus, Esc →
     met (palette tests, e2e);
   - Data health tab switcher → shared Tabs → **met in look, not in component** (see proposals:
     it stays links in a navigation to keep roles and tests);
   - page transitions with reduced motion respected, no remount → met (`PageTransition.tsx`,
     `pageKey` tests);
   - text unchanged; new strings only for new UI → met (only `SHELL_FRAME_COPY` added; the rail
     link `title` became a tooltip, the theme `title` became the same tip as a tooltip).
5. **Assumptions:** the rail is 56px (`w-14`) and the bar 48px, set in the shell rather than in
   `index.css` (U-A file); on global pages (All projects, Data health, New project) the trail shows
   only the switcher, since those pages don't belong to the project; a skill's name shows as the
   last crumb on `skills/:name`.
6. **Contract or shared-file changes needed:** none required; optional proposals above (Tabs link
   variant, Dialog focus return, Menu link item, DESIGN.md Layout, two layout tokens).
7. **Known gaps / follow-ups:** the Data health tabs use the shared look but not the component;
   the palette's two-tick deferral can go once the shared Dialog's focus return is changed (or
   once U-C moves New ticket onto the shared Dialog, whose focus trap also keeps focus).
8. **Next recommended task:** coordinator review and merge; then U-V (screenshots of every page,
   contrast, bundle size, DESIGN.md Layout update).

Screenshots (scratchpad `u-b-shots/`): `shell-board-1440-{light,dark}`,
`shell-rail-1440-{light,dark}`, `shell-rail-tooltip-1440-dark`, `shell-collapsed-1280-*`,
`shell-switcher-1440-*`, `shell-palette-*`, `shell-expanded-1024-light`, `pages-health-*`.
