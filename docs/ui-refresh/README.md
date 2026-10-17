# UI refresh (v0.1.0)

> Status and progress: [STATUS.md](STATUS.md). Progress files: `wp/U-*.md`, one per work package, edited only by its agent.

## 1. Context

v0.0.1 has shipped (tag `v0.0.1`, CI green). The owner finds the UI dated and wants a modern,
professional dashboard that attracts people. Owner decisions (2026-10-17):

- **Look:** Linear/Vercel style: crisp neutral greys, one vivid accent, subtle borders, dense but
  airy, a strong dark mode.
- **New dependencies approved:** `lucide-react` icons, Inter/Geist fonts bundled with fontsource,
  Radix UI primitives, Framer Motion.
- **Branches:** `release/0.1.0` (integration for the next version, already created from `main` at
  `ba280d9`) and `feature/ui-refresh` (made from it). Work-package branches come off
  `feature/ui-refresh`.

**Behaviour, data and text stay the same.** This is a visual refresh: no API, contract or
engine change, and copy stays in `lib/copy.ts`. All AGENTS.md rules still apply: honest numbers,
no placeholder UIs, and local only.

**What exploration found** (packages/web):

- Tailwind 4 with design tokens in `src/index.css` `@theme`: colors, type scale, radius, shadows,
  layout sizes. Dark mode is a `.dark` class (`src/lib/theme.ts`). Charts and graphs already take
  their colors from tokens, so a token change reaches most of the UI.
- The fonts say `'Inter'` but nothing loads it, so the system font is used.
- Icons are 34 hand-drawn SVGs in `src/components/icons.tsx` and `src/features/board/icons.tsx`,
  shaped like lucide (24px, 1.75 stroke), behind an `IconProps` type that we can keep.
- **Shared components:** Button, Card, PageHeader, InfoTip, EmptyState, DataTable, Tooltip, Pill
  and others in `src/components/**`.
- **Duplicated per feature:**
  - 4 tab implementations: SkillsPage, SidePanel, HowSessionsRelate, HealthScreen;
  - 6 copies of the form-field style;
  - Dialog and MoveMenu in `features/board`;
  - Segmented in `features/tokens`;
  - about 25 inline card surfaces.
- **Not reached by tokens:** raw Tailwind colors in `ErrorNotice` and `ProvenanceBadge`, the
  `#ec4899` logo gradient in `Shell.tsx`, hex modal backdrops, and `text-[11px]` sizes.
- **Unused components:** `Panel`, `SessionTable`, `EventList`, `UsageTotals`, `ParentInfo`,
  `LegacyEstimatedCost`, `StatusPill`.
- **How tests depend on the UI:** they select by role and name, `data-testid` and many `data-*`
  attributes (`data-state`, `data-status`, `data-role`…). They almost never check styling.

## What can break, and the rules every WP follows

1. **Keep roles, accessible names, `data-testid` and the app's `data-*` attributes.**
   - Keep the class hooks tests use: `.react-flow__*`, `edge-subagent`/`edge-continuation`,
     `.recharts-surface`, and `.overflow-x-auto` inside `agent-canvas`.
   - Text stays identical: 87 tests assert exact `textContent`. Icons are `aria-hidden` and add
     no text.
2. **Keep native `<select>`, `<details>`, checkboxes and radios**, restyled with Tailwind (tests use
   `selectOption`, `.value`, `.checked`, `details.open`). No Radix Select, Checkbox or Collapsible.
3. **Radix only where it adds value and fits:**
   - Dialog: the palette, New ticket, confirms;
   - DropdownMenu: the project switcher and Move menu;
   - Tabs: one shared Tabs to replace the 4 copies;
   - Popover;
   - Tooltip: the shared Tooltip/InfoTip keep their API, and the tests are adapted where Radix
     changes the mechanics (pointer events, delay 0).
   - Tests are changed only for interaction mechanics with the same user-visible behaviour, never
     for text or meaning.
4. **No Radix part on an element that carries the app's `data-state`/`data-status`/`data-role`**,
   because Radix writes its own `data-state`.
5. **Motion:**
   - wrap the app in `<MotionConfig reducedMotion="user">`;
   - keep motion subtle: page fade/slide 150–200 ms, menus, dialogs, panel slide-in, list items;
   - tests set `MotionGlobalConfig.skipAnimations = true`, so exits are synchronous, as tests
     expect.
6. **jsdom setup** (`tests/setup.ts`): add `matchMedia`, pointer-capture and `scrollIntoView`
   stubs for Radix and Motion.
7. **Local only:** fonts and icons are bundled, with no CDN or Google Fonts. Fonts load only the
   latin subset (`woff2`).

## Design direction (DESIGN.md v2; the owner approves at the design checkpoint)

- **Type:** Geist Sans for the UI and Geist Mono for ids, numbers and code, via
  `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. Body 13–14 px,
  tabular numbers, tighter headings.
- **Color:** a neutral zinc-like scale with near-black dark surfaces (about `#0a0a0b` canvas,
  `#111113` panel), hairline borders, and one accent. The default is an blue (Jira/YouTrack-like; owner changed it from blue on 2026-10-17) (about
  `#0c66e4`, adjustable at the checkpoint). Status colors are semantic and always paired with a
  word or icon. Light and dark both meet WCAG AA contrast for text.
- **Shape:** radius 8 px (cards) and 6 px (controls), 1 px borders, almost no shadow except on
  popovers, and a 2 px accent focus ring.
- **Layout:**
  - a slim sidebar with grouped navigation and lucide icons;
  - a top bar with breadcrumbs (project / page), the ⌘K search and the theme toggle;
  - content up to 88 rem;
  - denser tables and boards;
  - skeleton loading states instead of spinners.
- **Brand:** a new "AC" mark using tokens, with no hard-coded hex.

## Work packages

The protocol is the same as the redesign:

- `docs/ui-refresh/README.md` (this plan), `STATUS.md` (coordinator only), one progress file each
  in `docs/ui-refresh/wp/U-*.md`;
- branches `wp/u-<id>-<slug>` from `feature/ui-refresh`;
- the coordinator reviews (scope, screenshots, pnpm check, e2e) and merges with `--ff-only` into
  `feature/ui-refresh`.

| WP      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Owned paths (packages/web)                                                                                                             | After   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **U-0** | Coordinator: these docs, DESIGN.md v2, the **dependency commit** (exact pinned versions of `lucide-react`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, the Radix packages used: dialog, dropdown-menu, tabs, tooltip, popover, and `motion`; plus the lockfile), and the `0.1.0` target in `[Unreleased]` notes                                                                                                                                                                                                                                                                                                                        | `docs/ui-refresh/**`, `packages/web/package.json` deps, `pnpm-lock.yaml`, `packages/web/DESIGN.md`                                     | —       |
| **U-A** | Foundation:<br>• new tokens (light/dark) and fonts in `index.css`;<br>• `icons.tsx` re-exporting lucide icons under the current names and `IconProps`;<br>• rebuilt shared primitives: Button, Card, Pill/Badge, StatusBadge, Input/Select/TextArea (one field style replacing the 6 copies), Tabs, Dialog, Menu, Popover, Tooltip/InfoTip, Segmented, Skeleton, EmptyState, PageHeader, StatCard, DataTable, ErrorNotice;<br>• `MotionConfig`;<br>• test setup stubs;<br>• the unused components and their tests removed.<br>**Design checkpoint:** screenshots of Board and Ticket on the new tokens and primitives go to the owner before U-B…U-F start. | `src/index.css`, `src/components/**`, `src/main.tsx`, `tests/setup.ts`, `tests/components/**`                                          | U-0     |
| **U-B** | Shell: top bar with breadcrumbs, sidebar, project switcher (Radix DropdownMenu), command palette (Radix Dialog), theme toggle, footer, page transitions, brand mark                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/app/**`, `src/features/palette/**`, shell/palette tests and e2e                                                                   | U-A     |
| **U-C** | Board: columns and rails, ticket card, New ticket dialog, Move menu onto the shared Dialog/Menu, header                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/features/board/**` + tests                                                                                                        | U-A     |
| **U-D** | Ticket page: header, live workflow card, agent canvas, side panel (shared Tabs), chat, plan review, ticket info                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `src/features/ticket/**`, `src/features/control/Chat.tsx` styling + tests                                                              | U-A     |
| **U-E** | Workflow page (graph nodes, stage panel) and Skills & Agents (lists, editors, shared Tabs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/features/workflow/**`, `src/features/skills/**` + tests                                                                           | U-A     |
| **U-F** | Tokens, Harness, Sessions, Session detail, All projects, New project wizard, Settings, Data health/Connection, the legacy Control panel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/features/{tokens,harness,sessions,session-detail,all-projects,project-setup,health,setup,control}/**` (except `Chat.tsx`) + tests | U-A     |
| **U-V** | Verification:<br>• full e2e and screenshots of every page (light/dark at 1440 and 1024), reviewed;<br>• a contrast test over the token pairs;<br>• a bundle-size check (record before and after);<br>• keyboard and reduced-motion pass;<br>• DESIGN.md final;<br>• CHANGELOG `[Unreleased]` "Changed: a new look…" written for users.                                                                                                                                                                                                                                                                                                                      | `e2e/**`, a small `tests/design/contrast.test.ts`                                                                                      | U-B…U-F |

- **Parallelism:** U-B to U-F run in parallel after the design checkpoint, each in its own
  worktree. `lib/copy.ts` and the Playwright config are add-only, with marked sections.
- **Release:** after U-V, `feature/ui-refresh` → `release/0.1.0`. The owner merges
  `release/0.1.0` → `main`, tags `v0.1.0` and pushes.
- **CI:** runs automatically only on `main`. On these branches the owner can run it by hand; each
  merge is gated locally by pnpm check and e2e.

## Critical files to reuse

- **Reuse:**
  - `src/index.css` `@theme` tokens: extend them, keep the names so charts and graphs follow;
  - `src/lib/theme.ts` (system/light/dark);
  - `IconProps` in `src/components/icons.tsx`;
  - `buttonClass` in `src/components/Button.tsx`;
  - `PROJECT_PAGES` in `src/app/project-pages.ts`;
  - `EDGE_STYLE` in `features/{sessions,workflow}/graph.ts`;
  - `TOKEN_TYPE_COLOR` in `src/lib/tokens.ts`.
- **Replace with the shared versions:**
  - `features/board/Dialog.tsx` and `MoveMenu.tsx`;
  - `features/tokens/Segmented.tsx`;
  - the 4 tab implementations;
  - the 6 copies of the field style.

## Verification

- Each WP:
  - `pnpm check` from the root;
  - `ACP_E2E_PORT/CONTROL_PORT` e2e on free ports (never 7420/5173);
  - screenshots (light/dark, 1440 and 1024) the coordinator looks at;
  - no text changes (copy diffs reviewed);
  - fake data only, and no real Claude runs needed.
- **Design checkpoint (after U-A):** the owner approves the look on Board and Ticket screenshots.
- **U-V:**
  - all 49+ e2e pass;
  - contrast AA for the token pairs;
  - the bundle-size delta is recorded;
  - keyboard navigation through menus, dialogs and tabs;
  - with `prefers-reduced-motion`, no motion.
- **Live check:** the coordinator runs `pnpm dev` on `feature/ui-refresh` for the owner to click
  through before the release merge.
