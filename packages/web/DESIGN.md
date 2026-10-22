# Web UI design brief (redesign 2026-10-11, project-first shell 2026-10-16)

Decided by the project owner: **clean and calm** style; **plain language by default**, technical
detail kept behind collapsed "Details" sections and a "Data health" page (nothing is removed). The
reader may not know Claude Code: every screen must make sense to them.

On 2026-10-16 the owner asked for a simpler, **project-first** app: pick a project, then every page
is about that project (docs/redesign/README.md §3, §5). The Layout and Visual system sections
below are the binding rules for every page WP (R-B, R-D, R-E, R-F, R-H).

> **v2 direction (UI refresh for v0.1.0, owner decision 2026-10-17; see
> [docs/ui-refresh/README.md](../../docs/ui-refresh/README.md)):**
>
> - Linear/Vercel style with the **Control Core brand** (WP U-G, owner decisions in
>   [brand-brief.md](../../docs/ui-refresh/brand-brief.md)): warm ivory light theme, graphite dark
>   theme, one signal-lime accent;
> - hairline borders, radius 8/6 px for cards and controls, square agent nodes, almost no shadows;
> - Inter and JetBrains Mono (bundled), lucide icons;
> - Radix for dialogs, menus, tabs, popovers and tooltips;
> - subtle motion that respects reduced motion.
>
> The principles below still hold. WP U-A replaced the "Visual system" section with the v2
> tokens and components; every page adopted them in U-B…U-G, and U-V checked the whole app in
> light and dark at 1440, 1024 and 390px, by keyboard and with reduced motion.

## Principles

1. **Say what it is, in words.** Every number has a unit ("1,540 output tokens", not "1,540"). Every
   page starts with a one-line description of what it shows. Every unfamiliar term has an info tip
   (ⓘ) with the glossary text below.
2. **Most useful first.** What is running, what used tokens, what needs attention. Ids, sources,
   provenance and raw events go into "Technical details" (collapsed) or the Data health page.
3. **Honest numbers stay honest** (AGENTS.md rules still apply):
   - missing values read **"Not reported"**, never 0 or blank;
   - cost is always **"Estimated cost"** with the tip "reported by Claude Code, not calculated by
     this app"; never summed across sessions;
   - token types are shown side by side and **never added into one total**;
   - there is no "completed" status;
   - a parent we have no evidence for reads "No known parent".
4. **Calm visuals.** Neutral surfaces, one accent color, softly rounded cards (square agent nodes), generous spacing, light
   and dark themes, readable 14–15px body text, tabular numbers. Color is never the only signal
   (status has a word and an icon/dot).
5. **Fewer words on the page.** One short line under each title. Longer explanations go into an
   ⓘ tip (`PageHeader tip`, `Card tip`, `SectionHeader tip`), not a paragraph.
6. **No placeholder pages** (AGENTS.md rule 10). A page that isn't built has no nav entry, no
   palette entry, and its address reads "Page not found".

## Layout (src/app)

```
┌──────────────┬────────────────────────────────────────────────────────────────┐
│ ⧉ AGENT CON… │ [■ web-app ▾] / Board            [⌕ Search or jump to… ⌘K]  ◐  │  top bar, 48px
├──────────────┼────────────────────────────────────────────────────────────────┤
│ Project      │  (demo banner)                                                 │
│ ▌Board       │  Page title  ⓘ                                [Primary action] │
│  Workflow    │  One line about the page.                                      │
│  …           │                                                                │
│  Settings    │  cards…                                                        │
│ ──────────── │                                                                │
│  All projects│                                                                │
│  Data health │                                                                │
│ ● Live    [⇤]│                                                                │
└──────────────┴────────────────────────────────────────────────────────────────┘
```

- **Top bar** (`TopBar.tsx`, sticky, **48px**; the shell sets `--spacing-topbar: 3rem` for the
  sticky sidebar and demo banner under it):
  - a **brand cell** as wide as the sidebar, so their borders line up: the Control Core mark
    (`BrandMark`) and the wordmark, linking to `#/`; the mark alone over the rail;
  - the **breadcrumbs**: the project switcher (`ProjectSwitcher.tsx`: current project, a menu of
    projects with their folders, All projects and New project), a slanted hairline, then the page;
    on a narrow screen the page crumb gives way first, so the bar never scrolls sideways;
  - the **⌘K** search button (the full "Search or jump to…" field when there is room, the icon
    below that) and the **theme toggle** (System → Light → Dark, with a tooltip).
- **Sidebar** (`Sidebar.tsx`): a "Project" label, the project's pages from `PROJECT_PAGES` (only
  the `available` ones), a divider, then **All projects** and **Data health**. The footer has the
  live-connection dot, the server status and the **sidebar toggle**.
  - Two widths: the full list (15rem, `--spacing-sidebar`) or a **56px icon rail** whose entries
    show their label as a tooltip (and keep it as screen-reader text).
  - The toggle button or **⌘B** (Ctrl+B elsewhere) switches between them; the choice is remembered
    in this browser (`acp.sidebar` in localStorage, `sidebar-state.ts`). With no choice stored, the
    rail is used at 1280px and below (`wide:` is the 1281px breakpoint) and the full list above.
  - The active entry is a raised `panel` step with a hairline and a 3px signal-lime marker on its
    left edge (outlined in `accent-fill-edge`).
- **Which project:** the one in the address (`#/p/:projectId/...`), else the last one used
  (`src/app/last-project.ts`, localStorage, every access in try/catch). On All projects the
  switcher reads "All projects". The project section is hidden when there is no project.
- **Main area:** max 88rem wide; side padding 16px on a phone, 24px from `sm`, 40px above 1280px;
  32px top (24px on a phone). Page header, then cards in a 24px grid gap.
- **Page header** (`PageHeader`): the title, one line and an ⓘ; the actions on the right, wrapping
  under the title before the title gets narrower than 18rem, and **under the title below `sm`**.
- **Page change:** the page fades in with a 4px rise (200ms, `PageTransition.tsx`); the page is
  never remounted, and nothing moves with reduced motion.
- **Demo mode:** a slim banner "You're looking at sample data", sticky under the top bar.
- **Data health** has two sections as link tabs (`LinkTabList`/`LinkTab`, a navigation with
  `aria-current`): **Overview** (`#/health`) and **Connection** (`#/health/connection`, which was
  Setup: project folders and hooks).
- **Responsive down to a 390px phone** (e2e `pages.spec` checks every page there): the rail is the
  default below 1280px, tables become card lists below `lg`, wide content (the board's columns, the
  agent tree, graphs) scrolls inside its own frame, and the page itself never scrolls sideways.

### Routes

| Route                                      | Page                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `#/p/:projectId/board`                     | Board                                                               |
| `#/p/:projectId/workflow`                  | Workflow (stages, agents, limits; R-B)                              |
| `#/p/:projectId/skills`, `…/skills/:name`  | Skills & Agents (`?tab=agents` for the Agents tab; R-D)             |
| `#/p/:projectId/harness`                   | Harness (R-E)                                                       |
| `#/p/:projectId/tokens`                    | Tokens (R-F: new work vs cache reuse, by session/ticket/role/model) |
| `#/p/:projectId/sessions`                  | Sessions (the sessions list filtered to the project)                |
| `#/p/:projectId/settings`                  | Settings                                                            |
| `#/p/:projectId/tickets/:ticketId`         | Ticket                                                              |
| `#/p/:projectId/runs/:runId`, `…/runs/new` | A Phase 3 run without a ticket, and its start page                  |
| `#/projects`                               | All projects (project cards + "Across your projects")               |
| `#/projects/new`                           | New project                                                         |
| `#/health`, `#/health/connection`          | Data health: Overview, Connection                                   |
| `#/sessions/:id`                           | One session                                                         |

Every older address redirects without a history entry (`src/app/redirects.ts`): `#/` → the last
project's board, else All projects; `#/board[/:id]`, `#/projects/:id` → board;
`#/projects/:id/settings` → settings; `#/usage`, `#/sessions` → the project's Tokens/Sessions
(the `projectId` query moves into the path; without one, the last or first project);
`#/tickets/:id` → its project's ticket page; `#/setup` → Connection; `#/control` → board;
`#/control/new` → `runs/new`; `#/control/:runId` → its ticket, or its run page.

Build links with `href` (`src/lib/router.ts`): `href.projectPage(id, page, params)`,
`href.ticket({ id, projectId })`, `href.run({ id, projectId })`, `href.skill(id, name)`. Never
write hashes by hand.

### Adding a project page (R-B, R-D, R-E, R-F)

1. Build the page in your `features/<name>/` folder. Start it with `PageHeader` (title = the nav
   label, one short line, `tip` for the longer explanation, the primary action in `actions`).
2. In `src/app/project-pages.ts`, set your entry's `available: true`.
3. In `src/app/App.tsx` `ProjectScreen`, replace your `case` (which returns `NotFound`) with your
   screen, keyed by `projectId`. `route.params` has the query; `route.item` is the `:name` of
   `skills/:name`.
4. Add your copy in your own section of `src/lib/copy.ts`. The nav label is in `SHELL_COPY.nav.pages`.

The sidebar and the ⌘K palette pick the page up from `PROJECT_PAGES`; nothing else changes.

### Command palette (`features/palette`)

⌘K (Ctrl+K elsewhere) or the top-bar button opens a modal dialog with one search field
(`role="combobox"`) over a listbox, grouped as **Actions** (New ticket in the current project, New
project), **Pages** (the project's available pages, All projects, Data health, Connection),
**Projects** and **Tickets** (the current project's board; type a key such as `WEB-12`). ↑/↓ move,
Enter opens, Esc closes, Tab stays in the field, and focus returns to the opener.

## Visual system (src/index.css, src/components)

v2 (UI refresh, WP U-A), branded in WP U-G: Linear/Vercel structure (hairline borders, almost
no shadows) on the Control Core palette: **graphite `#171717`**, **warm ivory `#F4F0E8`** and
**signal lime `#D8FF64`** (README, "Brand").

**Tokens.** All colors are CSS variables in `@theme` (`src/index.css`); `.dark` only redefines
values, and every name is also a Tailwind utility (`bg-panel`, `text-dim`). Charts, graphs and
React Flow read the same names, so never rename one; add a new one instead. The three brand colors
are tokens of their own (`brand-graphite`, `brand-ivory`, `brand-lime`) and the UI tokens derive
from them. `tests/design/contrast.test.ts` reads `index.css` and checks every pair below in both
themes: text 4.5:1 (AA), lines, dots, rings and chart series 3:1.

| Token                                                     | Light                         | Dark                          | Use                                                       |
| --------------------------------------------------------- | ----------------------------- | ----------------------------- | --------------------------------------------------------- |
| `brand-graphite` / `brand-ivory` / `brand-lime`           | `#171717` `#f4f0e8` `#d8ff64` | same                          | the identity; the tokens below derive from them           |
| `canvas` / `panel` / `sunken`                             | `#f4f0e8` `#fbf9f5` `#ebe6dc` | `#171717` `#1d1d1d` `#121212` | page (ivory / graphite); cards; wells, tracks, segmented  |
| `panel-raised`                                            | `#fefdfb`                     | `#252525`                     | menus, popovers, dialogs (above a panel)                  |
| `hover`                                                   | `#efebe3`                     | `#282828`                     | row, item and quiet-button hover                          |
| `sidebar`                                                 | `#efeae1`                     | `#131313`                     | the sidebar and top bar surface                           |
| `ink` / `dim`                                             | `#171717` / `#5c5850`         | `#f4f0e8` / `#a6a29a`         | text (graphite / ivory); secondary text                   |
| `line` / `line-strong`                                    | `#e2dcd0` / `#cdc6b8`         | `#2c2c2c` / `#3b3b3b`         | warm-neutral hairlines; field and hover borders           |
| `overlay`                                                 | graphite at 40%               | black at 60%                  | modal backdrop                                            |
| `accent`                                                  | `#4b5e00` (dark olive)        | `#d8ff64` (lime)              | the text-safe accent: links, focus ring, selected text    |
| `accent-soft`                                             | `#e9ecd2`                     | `#2a2f1a`                     | quiet selected fills (table row, accent pill, chips)      |
| `accent-ink`                                              | `#fbf9f5`                     | `#171717`                     | text on an `accent` fill                                  |
| `accent-fill` (`-hover`) / `accent-fill-ink`              | lime (`#cdf54f`) / graphite   | lime (`#e3ff8a`) / graphite   | the primary button, active and selected markers, the logo |
| `accent-fill-edge`                                        | `#6f8a12`                     | lime                          | outlines a lime fill or selection where it sits on ivory  |
| `observed` / `derived`                                    | `#11704f` / `#1f5f8f`         | `#78dcb4` / `#8cc4ee`         | `ProvenanceBadge`                                         |
| `status-*`, `success`, `warning(-soft)`, `danger(-soft)`, | see `index.css`               | see `index.css`               | **meaning only**, never decoration                        |
| `token-*`, `estimated(-bg)`, `unavailable`                |                               |                               |                                                           |

In the dark theme elevation goes lighter (canvas < `sunken` < `panel` < `panel-raised`), so board
columns and wells sit below the cards on them, as `sunken` does in the light theme.

**Lime is a fill, not text, on ivory** (1.0:1 against the canvas). In the light theme,
anything that must be read in the accent (links, selected text, the focus ring) uses `accent`, the
dark olive; in the dark theme `accent` is the lime itself. Lime fills carry graphite text
(`accent-fill-ink`, 15.7:1). On ivory a lime fill or selection ring gets an `accent-fill-edge`
outline so it stays a shape. Lime is never a large background (the demo banner is a neutral
`sunken` band).

Measured ratios (light / dark): `ink` on every surface ≥ 14.4 / ≥ 12.9; `dim` ≥ 5.6 / ≥ 5.8;
`accent` ≥ 5.8 / ≥ 12.1; graphite on lime 15.7 (hover 14.3 / 16.2); `success` 5.4 / 9.2;
`warning` 5.3 / 8.7; `danger` 5.6 / 6.4; `observed` 5.8 / 10.2; `derived` 6.5 / 9.0;
`estimated` on its band 6.5 / 10.2; `unavailable` 5.3 / 6.1; `accent-fill-edge` 3.5 / 14.8;
status dots ≥ 3.7 / ≥ 4.7; chart series (`token-*`) ≥ 3.8 / ≥ 6.9.

- **Type:** Inter for the UI, JetBrains Mono for ids, keys, numbers in code and paths (both
  bundled, latin `woff2` only: `src/components/fonts.css`). The wordmark is Inter semibold,
  uppercase, tracked 0.1em. Body 14/20px; `text-micro` 11px (tiny
  badges and technical lines only); `text-caption` 12px; `text-title` 15px (card titles);
  `text-section` 18px; `text-page` 24px; `text-stat` 26px. Headings carry their own tighter
  tracking in the token (don't add `tracking-tight`). Tables and `<time>` use tabular numbers;
  add `tabular-nums` wherever numbers line up.
- **Spacing:** a 4/8-pt rhythm, denser than v1. Cards pad 20px; page header to content 24px; grid
  gaps 16–24px between cards.
- **Shape:** cards 8px (`rounded-card`), controls 6px (`rounded-control`), status pills fully
  round, tags (`Badge`) 5px. Borders are 1px `line`; hover moves to `line-strong`.
- **Elevation:** flat. `shadow-card` is almost nothing (none in dark), `shadow-raised` a hint on
  hover of clickable cards, `shadow-pop` only for menus, popovers, dialogs and tooltips.
- **Focus:** a 2px `accent` outline (olive on ivory, lime on graphite) with a 2px offset on every
  interactive element (base layer); fields instead turn their border `accent` with a soft 3px
  accent ring.
- **Motion** (`src/components/motion.tsx`, keyframes in `index.css`): 150–200ms, ease-out
  (`--ease-out-soft`). Menus and popovers `animate-pop-in`, dialogs `animate-dialog-in`, tooltips
  and backdrops `animate-fade-in`; Motion presets `fade`, `fadeUp`, `slideInRight`, `list` /
  `listItem` with `enter(variants)`. The app root is `MotionProvider`
  (`MotionConfig reducedMotion="user"`), and `prefers-reduced-motion` stops CSS animations and
  transitions. Tests skip animations (`MotionGlobalConfig.skipAnimations`).

**Components.** Use these; don't restyle per page. New shared parts are Radix-based where Radix
adds real behaviour. Radix writes `data-state` on its parts, so **never put the app's own
`data-state`/`data-status`/`data-role` on a Radix part** (a trigger, tab, panel or content);
put it on an inner element.

- **Page header** (`PageHeader`): title, optional ⓘ `tip`, one-line `description`, primary
  action on the right, optional `eyebrow` (a back link). `SectionHeader` for a heading that groups
  cards inside a page.
- **Card** (`Card`): title (+ `tip`), optional one-line description, actions on the right; `padded`
  false for edge-to-edge tables and graphs. A clickable card is a list item whose title link
  covers the card (`after:absolute after:inset-0`), with `line-strong` and `shadow-raised` on
  hover. `StatCard`: one headline number, 16px padding.
- **Table** (`DataTable`): caption-size headers on a faint `sunken` band (sentence case), hairline
  row dividers, 20px outer cell padding, dense rows, `hover` on rows, no zebra stripes; a card list
  below 1024px.
- **Empty state** (`EmptyState`): the icon on a small bordered tile, a short title, one sentence,
  **at most one action**. `compact` inside a card.
- **Loading** (`Skeleton`, `SkeletonText`, `SkeletonCard`, `LoadingBlock`): soft `sunken` blocks
  instead of spinners; the loading words stay in the page, visually hidden. `QueryView` uses
  `LoadingBlock`.
- **Buttons** (`Button`, `ButtonLink`, `buttonClass`): 32px (`sm`: 28px). `primary`
  (signal lime with graphite text and an `accent-fill-edge` hairline, one per page area), `secondary` (bordered panel), `quiet` (text, `hover` fill),
  `danger` (soft red, for confirmations).
- **Inputs** (`Input.tsx`): **native** `<input>`, `<select>`, `<textarea>`, checkboxes and radios,
  restyled. One field style, `fieldClass` (34px, `line-strong` border, accent focus, danger border
  with `aria-invalid`, no width), `inputClass(extra)` (full width), wrappers `TextInput`, `Select`,
  `TextArea`, and `labelClass`/`hintClass` (labels above, hints below in caption text).
- **Pills and tags** (`Pill`, `Badge`): `Pill` is a state word with a dot; `Badge` a quiet tag or
  count without a dot (`mono` for keys). Tones `neutral`, `accent`, `success`, `warning`,
  `danger`, mapped from meaning (for example harness Ready → success).
- **Status** (`StatusBadge`): dot (color plus shape) + word + ⓘ. `ProvenanceBadge`: tiny
  uppercase tag, `observed`/`derived` tokens; estimated is dashed and italic.
- **Tabs** (`Tabs`, `TabList`, `Tab`, `TabPanel`; Radix Tabs): an underline tab bar; arrow keys
  move and select, a click selects; controlled by the owner. **Link tabs** (`LinkTabList`,
  `LinkTab`) draw the same bar for sections that are addresses: a `navigation` of links with
  `aria-current="page"` (Data health).
- **Dialog** (`Dialog`; Radix Dialog): open while mounted, `onClose` on Escape, backdrop click or
  the optional × (`closeLabel`); `aria-modal`, focus to `[data-autofocus]` or the first control,
  Tab trapped, focus back to the opener just after it closes, but only while focus is still in
  the dialog or nowhere. A dialog opened in the same render that closed another (the palette's
  New ticket) keeps focus and takes over the closed one's opener.
- **Menu** (`Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator`; Radix DropdownMenu): a menu button;
  ArrowDown/Enter/Space open it on the first item, arrows move (`loop` wraps at the ends), Escape
  closes to the trigger; `tone="danger"` for destructive items. Not modal by default. The
  highlighted item has the `hover` fill, and with the keyboard the 2px accent ring, inset.
- **Focus:** every interactive element shows a 2px `accent` outline on `:focus-visible` (3:1 or
  more against its surface on ivory and graphite; e2e `focus-ring.ts` measures it). Never remove
  it without an equal replacement.
- **Popover** (`Popover`; Radix Popover): a small floating panel (`role="dialog"`, named by
  `label`) toggled by its trigger.
- **Segmented** (`Segmented`): a labelled group of `aria-pressed` buttons on a `sunken` track.
- **Tooltips** (`Tooltip`, `InfoTip`): kept hand-built (they open at once on hover and focus,
  InfoTip also on tap, and the text exists only while open). Light theme: an `ink` bubble with
  `canvas` text; dark theme: `panel-raised` with a `line-strong` border. 12px text.
- **Errors** (`ErrorNotice`): an alert on `warning-soft` (server unreachable) or `danger-soft`,
  with an icon; tokens only.
- **Brand** (`BrandMark`, `BrandLogo`): the Control Core drawn with `currentColor` (graphite on
  ivory, ivory on graphite) and an `accent-fill` centre framed in the mark's own color; `tone="mono"`
  for one color. From 20px it uses the master geometry (48 grid), below it the 16-grid one (the
  favicon's). Decorative (`aria-hidden`) unless given a `label`, which makes it `role="img"`.
  `BrandLogo` adds the wordmark: the app name as text, uppercase in CSS only, or screen-reader-only
  with `hideName` (the icon rail). The static files and their rules are in the README, "Brand".
  The logo is identity, never decoration: one in the top bar, one in the tab.
- **Icons** (`components/icons.tsx`): lucide icons under the app's names (`BoardNavIcon`,
  `TokensIcon`, …), `IconProps` (`size`, SVG props), 1.75px strokes, `currentColor`,
  `aria-hidden`, so an icon never adds text. Every nav entry has one. `MoveIcon`, `AlertIcon`,
  `FeatureIcon`, `BugIcon`, `ChoreIcon` and `CloseIcon` are there for the board and dialogs.
- **Diff viewer** (`components/diff`, v0.3.0 G-C, ADR-0025 §6): `DiffSection` (a `Details`-style
  disclosure that draws the viewer only once opened) around `DiffViewer`, used by the change card,
  the ticket branch card and, since G-D, the control panel's review and the ticket side panel's
  Changes tab (the old plain `DiffView` is gone).
  - A summary line; **Unified / Side by side** (`Segmented`, remembered in `acp.diff.view` in
    localStorage, every access guarded, shared by every viewer on the page); **Collapse all /
    Expand all**.
  - A file list (status icon, path with the folder dimmed, +/−; one tab stop, ↑/↓/Home/End,
    Enter jumps to the file and opens it).
  - Each file: a header button (`aria-expanded`) with status word, similarity, `Binary` and `Cut`
    tags and +/−; then a table with line numbers before and after, a decorative +/− sign and the
    screen-reader words "Added line" / "Removed line"; changed words in a stronger tint of the
    line's color. Unchanged runs keep 3 lines next to a change; longer runs fold behind "Show N
    hidden lines". Side by side needs 36rem; where the viewer is narrower (the side panel beside
    the agents, a phone; followed with a ResizeObserver) it shows unified, with Side by side off
    (`aria-disabled`, tooltip "Not enough room here") and the saved choice kept for wider places
    (G-D). Unified wraps long lines.
  - Syntax colors from Shiki, loaded with dynamic imports only for a known language
    (`language.ts`) when a file is drawn; the CSS-variables theme, so `diff.css` sets the colors
    for both themes (4.5:1 on every line background, `tests/components/diff/contrast.test.ts`).
    Plain text while loading, on failure, for other languages and above 3,000 lines.
  - Large diffs: a file over 400 lines, and every file after the first 1,500 lines, waits for
    "Show this file". A diff the server cut says so, marks the cut file, and names the listed
    files after the cut.

## Agent views (the logo's vocabulary)

The ticket's agent canvas, its live workflow, the Workflow page, the sessions graph, the sessions
family tree and the legacy control tree draw agents the way the logo does (owner decision, WP
U-G; the family tree in U-V):

- **Square nodes:** agent and stage nodes have a 2px radius (React Flow's
  `--xy-node-border-radius` too); tags on them are square as well. Start and Done stay pills: they
  are not agents.
- **The controller stands out:** the lead (and the root of a sessions graph) is framed in `ink`;
  other agents in `line`.
- **Straight connectors:** React Flow edges are `step` (straight segments, square corners); the CSS
  trees draw straight elbows in `line-strong`. Lines are neutral (`dim`, `ink`); kinds differ by
  dashes, never by the accent.
- **Lime means working or selected, nothing else:** a working agent has a lime top edge; the
  selected node a lime ring (with an `accent-fill-edge` border on ivory); the live workflow's
  working stage an outline with a lime halo. Idle and finished agents are neutral, and the budget
  bar is neutral within budget.
- **Warning and danger only for real states:** a request waiting for you, a failed stage, a budget
  near or over its limit. A passed check is `success` green (its own `passed` tone), not the grey
  of finished work.
- **Conversations stay neutral:** in the chat and the ticket's comments your messages are an
  outlined bubble (`line-strong` on `panel`) and the agents' a filled one (`hover`); no accent
  tint, since lime means working or selected.
- Diagrams show only real relationships and states (AGENTS.md rule 1): no decorative nodes or
  lines.

### Review loop (ADR-0021, WP RL-D)

Only a run with the loop (`RunDetailDto.changes` or `.ticketBranch` present) gets these; a run
from before it renders as it always did (`features/review-loop/logic.ts` `isReviewLoopRun`).

- **Workflow page:** Helpers → **Approvals** (Manual / Auto edits (recommended) / Auto as native
  radios with one sentence each, a `warning-soft` note for the two auto modes, Auto's command list
  checked with core's `CommandPatternSchema` as it is typed); Review & merge → reviewer, rework
  rounds 0–5 and the review agent's agent file, model and skill. The graph adds a "Rework" loop
  from Review back to Helpers (it leaves Review off-centre, `out-top-loop`, clear of the plan
  approval's line) and an **owner-merge gate** ("You · Merge into main") with Done under it.
- **Start dialog** (`StartDialog`, shared `Dialog`): from the board's "Start with options…" and
  the ticket page's "Options" button; each choice starts at the project's setting (marked
  "Project setting") and only the changes are sent. Plain Start/Re-run stay one click.
- **Ticket page:** "N changes need your decision" (warning band) above the agents; the
  **ticket-branch card** (branch, base, tip; at REVIEW the actions first, then the tip's checks,
  files and the collapsed diff); "Changes in this run" under the agents; the side panel's Changes
  tab holds the **change card** (state pill, checks on its commit, conflict files, decisions with
  the reviewer's findings, files and diff, and the owner's buttons only when it is their turn).
  The live graph's review node shows the run's counts, the gate is ringed `needs-you` at REVIEW
  and `success` once merged, and the helpers row says how many are in review.

### Live run graph and run options as a limit (ADR-0023, WP WG-E)

- **Ticket page:** the live workflow draws the run's own graph (`GET /api/runs/:id/workflow-graph`,
  `features/ticket/LiveRunGraph.tsx`), read-only, in the editor's block look: square agent blocks
  (the lead framed in `ink`), steps on the `sunken` well, Ticket and Done as pills; the owner's
  positions or the editor's three rows. Each block has the state ring and word of the version 1
  stages, its agents as small square chips (a click shows that agent; a click on the block its
  working agent), and on editing blocks the mode it runs with in this run ("Mode: Auto edits")
  plus "Sandboxed" for a block set to Full auto. Rework links carry their counts; the review
  agent's own link reads "Direct rework ×n". A server without run graphs (404 or 409) keeps the
  version 1 stages above.
- **Run options:** "Approval mode: at most …" in the Start dialog, the ticket's Run options and
  the New ticket dialog. "No limit" (nothing sent) leaves every block as set; a limit looser than
  every editing block shows a neutral note that it changes nothing. The old widening warnings
  stay only for a server without graphs.

## Session names and run summaries (ADR-0024, WP S-B)

- **One naming rule** (`src/lib/session-name.ts` `nameSession`, pure, tested per case), used by
  every view that lists or draws sessions: the Sessions list, a session's page, the family tree
  (and so the agent trees' helper lists), the relationships diagram, the timeline, the
  relationships picker, related sessions and All projects. In order:
  1. **started by the app** (`SessionSummaryDto.managed`): `WEB-12 · Frontend helper`, or the label
     alone for a run without a ticket, with a quiet "Started by Agent Control Plane" tag (`Badge`);
     on the session's page the tag is followed by "Open WEB-12" (or "Open the run"), a link to
     `#/control/:runId`, which opens the run's ticket or run page;
  2. **Claude Code's title**;
  3. **a helper agent** (agent type or agent id): "Helper agent: Explore", with its description as
     a quieter second line (also under a title);
  4. **otherwise** "Session on main · Oct 21, 9:00 AM", or "Session started Oct 21, 9:00 AM"
     without a branch. Never "Untitled".

  The short id stays where it was. In the diagram the tag or the helper's task shares the id's
  line, so a node keeps its height. Lists that know only an id and a title (Tokens by session, the
  cost list) read "Session 1a2b3c4d" without a title.

- **Run summary** (ticket comments by author `app`): a card of its own in the comments (`sunken`
  header with the "Run summary" title, the run number and an "Agent Control Plane" tag; the body on
  `panel`). Since v0.3.0 S-C it reads like a teammate's comment: a summary with a `Details:` line
  shows the lead's note (or the app's one plain sentence when the lead left none) as normal comment
  text, the header says "Lead · Run summary" when the words are the lead's (just "Run summary"
  otherwise, "(updated)" on a later handover), and the facts sit behind a collapsed "Details"
  disclosure (the shared native `Details`, so the keyboard opens it). An older summary, with no
  `Details:` line, and the facts once opened are read loosely (`features/ticket/run-summary.ts`): a
  short line ending with a colon is a heading, `- ` lines are a list (two spaces of indent per
  level), anything else is shown as written with its line breaks. The note after your merge ("Merged
  acp/WEB-12 into main at 4f2a9c1") is a small line with a merge icon instead of a card. Your, the
  lead's and the reviewer's comments are unchanged.

## Branching and GitHub (ADR-0025, WP G-B)

- **Settings → Branches** (`features/branching/BranchingFields.tsx`, rules in `strategy-form.ts`):
  the strategy as choice cards (GitHub flow, Git flow, Custom, "None, keep acp/<KEY>"); the base
  and default target branches; the ticket branch name with its tokens (`{key}` required, `{slug}`,
  `{type}`) and a word per ticket type; a live preview of two example names (`renderTicketBranchName`
  on a feature and a bug of the project's key). GitHub flow and Git flow fill every field and keep
  the name and words read-only (Custom frees them); the branches stay editable. Each field says what
  is wrong in a sentence as it is typed, and Save waits for a fix. It saves with the rest of the
  page: `branching` is sent only when it changed, `null` for None. The new-project wizard has the
  same fields in a collapsed "Branching strategy (optional)" section of step 2.
- **Settings → GitHub** (`CodeHostCard.tsx`): "Connected to GitHub: owner/repo" with a success pill,
  or the first thing to fix in plain words (no GitHub remote, no GitHub CLI, not signed in) on a
  `warning-soft` band, and "Check again". The status (`GET /projects/:id/code-host`) is read when a
  screen that shows it opens and on Check again only: stream notices never refetch it
  (`lib/invalidation.ts`), so the app never asks GitHub on a timer.
- **A ticket's branch** (`TicketBranchFields.tsx`, `ticket-branch.ts`): in New ticket under "More
  options" and as a "Branch" section on the ticket card. Placeholders show what an empty field
  follows (the name the strategy gives, e.g. `fix/WEB-N-login-fails-on-safari`, and the default
  target); empty fields read "Project default (…)". A change sends the PATCH's `branch` (each field
  or `null`; `null` for both). Once the run has created its branch, the section shows the actual
  branch and target read-only.
- **The ticket branch card's final step** (`review-loop/BranchFinalStep.tsx`, kept apart from the
  card's evidence so the diff section and the actions never share lines): "Merge into <target>"
  (primary, as before) beside "Push & open PR" (secondary), which is disabled with its reason
  underneath while GitHub isn't ready. Push & open PR asks first, in the shared confirmation look:
  the sentence of what will happen, the title (`<KEY>: <title>`) and "Open it as a draft". After
  it, the pull request sits above the actions on a `sunken` band: "Pull request #42" linking to
  GitHub in a new tab (https links only), its state pill (Open accent, Merged success, Closed
  neutral), "Checked <time>" and Refresh (until merged), and one line on what happens next. While
  it is open the local merge is hidden (Request changes and Discard stay); closed brings both final
  steps back; merged reads "Merged into <target> on GitHub" and the ticket is Done. Each server
  error code (`gh-not-installed`, `gh-not-logged-in`, `no-github-remote`, `push-rejected`,
  `pr-exists-elsewhere`, `timeout`, `gh-failed`) reads as a sentence with what to do; the raw error
  stays under Details.
- **G-D follow-ups:**
  - **Read on opening** (`branching/pull-request-check.tsx`): when the ticket page opens and its
    current branch has an open pull request, the page asks the server to read it once
    (`POST …/pull-request/refresh`), decided on the page's first render: a pull request opened
    later in the visit, stream notices, refetches and the answer itself never ask again. A new
    visit (another ticket, a reload) asks again. While it runs, Refresh reads "Refreshing…"; a
    failure shows on the pull request until the owner presses Refresh.
  - **Push new commits:** while the pull request is open and the branch's tip differs from the
    commit the app last pushed (`pullRequest.pushedCommit`; unknown never counts as new), the
    primary action is "Push new commits", asking first ("Push the new commits on <branch> to the
    open pull request #N."). It sends the same `POST …/pull-request` with `{}`. A refused push
    reads "The branch on GitHub has commits the app doesn’t have; it won’t overwrite them."
  - **The pull request lines** among the comments, small like the merge line (`data-kind`):
    "Merged via pull request #N into <target> at <sha7>; <tip checks>" and "Pushed <branch> and
    opened pull request #N into <target>" (or "…; pull request #N into <target> was already
    open"). Branches and the commit are code; the number is plain text, not a link.

## Glossary (single source: `src/lib/copy.ts`)

| Term in UI            | Tip text                                                                                              | Was                        |
| --------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| Session               | One Claude Code conversation, from when it starts until it exits.                                     | session                    |
| Helper agent          | A sub-agent that a session started to work on part of the task.                                       | subagent                   |
| Project               | A folder you added. Sessions that ran inside it are shown here.                                       | project / root             |
| Unadded folder        | A folder where Claude Code ran but that you haven't added as a project yet. Its sessions aren't read. | candidate root             |
| Input tokens          | Text sent to the model (your messages, files, tool results).                                          | input                      |
| Output tokens         | Text the model wrote back.                                                                            | output                     |
| Cache write tokens    | Input saved to the prompt cache so later turns can reuse it.                                          | cache creation             |
| Cache read tokens     | Input reused from the prompt cache; much cheaper than normal input.                                   | cache read                 |
| Tokens (this session) | Tokens used by this session itself.                                                                   | direct usage               |
| Tokens (with helpers) | This session plus all its helper agents.                                                              | aggregate usage            |
| Estimated cost        | Cost reported by Claude Code itself. An estimate; this app doesn't calculate prices.                  | provider-reported snapshot |
| Continued from / as   | This session was resumed or forked from another one and shares its earlier messages.                  | continuation edge / fork   |
| Shared messages       | N messages were copied between sessions (resume/fork); each is counted only once.                     | attribution ambiguous      |

Status words (dot + word + tip):

| Status    | Word     | Tip                                                                                            |
| --------- | -------- | ---------------------------------------------------------------------------------------------- |
| `active`  | Running  | Activity in the last 2 minutes.                                                                |
| `idle`    | Paused   | No activity for 2–30 minutes.                                                                  |
| `stale`   | Inactive | No activity for over 30 minutes. Claude Code doesn't report finishing unless hooks are set up. |
| `ended`   | Ended    | Claude Code reported that the session ended.                                                   |
| `unknown` | Unknown  | Not enough information yet.                                                                    |

Activity feed (plain sentences instead of event types; raw view under "Technical details"):
`message.user` → "You sent a message" (isMeta → "Claude Code added a message") · `message.assistant` →
"Claude replied" (+ model) · `usage.reported` → "Used N input · N output tokens" · `tool.called` →
"Used tool: {name}" · `tool.result` → "Tool finished" (error → "Tool failed") · `subagent.spawned` →
"Started a helper agent: {type}" · `subagent.stopped` → "Helper agent finished" · `session.started` →
"Session started" · `session.ended` → "Session ended" · `session.titled` → "Named: {title}" ·
`session.attention` → "Waiting for you" · `session.turn_ended` → "Finished its turn" ·
`session.cwd_changed` → "Moved to another folder" · `usage.snapshot` → "Claude Code reported a running
total" · `provider.error` → "The model returned an error ({kind})" · `record.unrecognized` → "Unknown
record (skipped)".

## Formatting

Numbers with thousands separators and a compact form in cards (12.4K) with the exact value in a
tooltip; dates as relative time ("3 min ago") with the exact local time in a tooltip; short ids
(8 chars) with a copy button, full ids only in Technical details.
