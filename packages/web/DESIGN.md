# Web UI design brief (redesign 2026-10-11, project-first shell 2026-10-16)

Decided by the project owner: **clean and calm** style; **plain language by default**, technical
detail kept behind collapsed "Details" sections and a "Data health" page (nothing is removed). The
reader may not know Claude Code: every screen must make sense to them.

On 2026-10-16 the owner asked for a simpler, **project-first** app: pick a project, then every page
is about that project (docs/redesign/README.md §3, §5). The Layout and Visual system sections
below are the binding rules for every page WP (R-B, R-D, R-E, R-F, R-H).

> **v3 direction (v0.3.0 part 3, the GitHub-like redesign; owner decisions 2026-10-22, WP D-0):**
>
> - **A GitHub-like look:** GitHub's palette (white and canvas-subtle grey in light, GitHub dark
>   in dark), 1px borders, 6px radius, one blue accent, a green primary button, a dark top bar in
>   both themes, "Box" cards with a header row, underline tabs, outlined pill labels;
> - **the system font stack** (no bundled fonts), 14px body (15px since C-S, below), semibold
>   headings;
> - **themes:** Light, Dark and System (follows the computer), remembered per browser, chosen in
>   the top bar's theme menu or Settings → Appearance, with no flash of the wrong theme on load;
> - **clarity first:** the app has everything; v3 makes it easier to read. Behaviour and copy stay
>   as they were;
> - the **Control Core logo stays** (its static files keep their own colors); the app chrome
>   around it is GitHub-like. Lime is no longer an accent.
>
> Radix for dialogs, menus, tabs, popovers and tooltips, lucide icons and subtle motion that
> respects reduced motion carry over from v2 (UI refresh, docs/ui-refresh/). The principles below
> still hold. D-0 replaced the "Visual system" section with the v3 tokens, type and components.
>
> **Shell polish (v0.3.0 part 4, WP C-S, owner request 2026-10-22):** bigger and clearer: body
> 15px with the type scale a step up, a 56px top bar, a 256px sidebar with 36px entries; the
> sidebar toggle is a chevron on the sidebar itself; the top bar reads logo and "ACP" on the left,
> a wide centred search, then the project switcher and the theme menu on the right. "Layout" and
> "Type" below have the details.

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
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ⧉ ACP          [⌕ Search or jump to…            ⌘K]        [■ web-app ⇕] / Board [◐] │  dark top bar, 56px
├──────────────┬───────────────────────────────────────────────────────────────────┤
│          [‹] │  (demo banner)                                                    │
│ Project      │                                                                   │
│▌Board        │  Page title  ⓘ                                   [Primary action] │
│  Workflow    │  One line about the page.                                         │
│  …           │                                                                   │
│  Settings    │  ┌ Card title ─────────────── [action] ┐  (header row on `subtle`)  │
│ ──────────── │  │ body                                │                           │
│ Workspace    │  └─────────────────────────────────────┘                           │
│  All projects│                                                                   │
│  Data health │                                                                   │
│ ● Live       │                                                                   │
│ Server …     │                                                                   │
└──────────────┴───────────────────────────────────────────────────────────────────┘
```

- **Top bar** (`TopBar.tsx`, sticky, **56px**, the `--spacing-topbar` token that the sticky
  sidebar, the demo banner and the pages' sticky parts read), **dark in both themes** like
  GitHub's header (`header` `#1f2328` light / `#010409` dark, `header-ink` text, `header-dim`
  quieter text, `header-line` borders, `header-hover` fills; `[data-topbar]` gives focus rings the
  brighter `header-focus` blue, 3:1 or more on it). Three parts (v0.3.0 C-S, owner request
  2026-10-22); from `md` the left and right parts share the rest of the bar equally
  (`flex-1 basis-0`), so the search stays in the middle:
  - **left:** the Control Core mark (`BrandMark`, 28px, white with the accent centre) and the
    short name **"ACP"** (`SHELL_FRAME_COPY.shortName`, 17px semibold), linking to `#/`. The full
    name "Agent Control Plane" is the tooltip and the link's name ("Agent Control Plane home", as
    before, so it still says where it goes); the visible "ACP" is `aria-hidden`
    (`BrandLogo shortName`). The mark sits over the rail's icons;
  - **centre:** the **⌘K** search, a bordered 36px field "Search or jump to… ⌘K", 320px at `md`,
    448px from `lg`, 544px from `xl` and 640px from 1440px; below `md` a 36px icon button (its
    name stays "Search or jump to…");
  - **right:** the **breadcrumbs**: the project switcher (`ProjectSwitcher.tsx`, 36px: current
    project, a menu of projects with their folders, All projects and New project), a slanted
    hairline, then the page (semibold; on a ticket "Board / WEB-21": Board links to the board and
    the key is the current page, `aria-current`, not a link, once the ticket is read (C-D)); then
    the **theme menu** (`ThemeMenu`, a 36px bordered icon button, "Theme" below). On a narrow
    screen the page crumb gives way first and the switcher truncates, so the bar never scrolls
    sideways.
- **Sidebar** (`Sidebar.tsx`), neutral (`sidebar`: `#f6f8fa` light / `#010409` dark), like
  GitHub's nav lists: two sections under small muted semibold headings, **Project** (the project's
  pages from `PROJECT_PAGES`, only the `available` ones) and **Workspace** (**All projects**,
  **Data health**), each a labelled `group`, with a divider between them. Entries are **36px**,
  an 18px icon (`dim`, `ink` on hover) plus a body-size (15px) label (`ink`), a `hover` fill
  (v0.3.0 C-S). The bottom keeps only the status, as small text: the live-connection dot and
  word, and the server line.
  - Two widths: the full list (**256px**, `--spacing-sidebar`) or a **60px icon rail**
    (`--spacing-sidebar-collapsed`) whose entries show their label as a tooltip (and keep it as
    screen-reader text); in the rail the section headings are screen-reader text and the divider
    stays.
  - The **sidebar toggle** (`SidebarToggle`, `data-testid="sidebar-toggle"`; v0.3.0 C-S, owner
    request 2026-10-22: on the sidebar itself, not in the top bar) is a 32px bordered chevron
    button at the sidebar's top right, above the scrolling list so it never scrolls away: **‹**
    when open (hides it), **›** in the rail, centred over the icons (shows it). Its tooltip (to
    the right) is "Hide sidebar ⌘B" / "Show sidebar ⌘B" (Ctrl+B elsewhere), its name "Hide
    sidebar" / "Show sidebar", with `aria-controls`, `aria-expanded` and `aria-keyshortcuts`.
    (D-0 had put it first in the top bar; before that it was in the sidebar's bottom corner,
    which new users missed.)
  - The toggle or **⌘B** (Ctrl+B elsewhere) switches between them; the choice is remembered in
    this browser (`acp.sidebar` in localStorage, `sidebar-state.ts`). With no choice stored, the
    rail is used at 1280px and below (`wide:` is the 1281px breakpoint) and the full list
    above.
  - The active entry: semibold on the `hover` fill, with a 4px rounded `accent` bar at the
    sidebar's left edge.
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

| Route                                      | Page                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `#/p/:projectId/board`                     | Board                                                                 |
| `#/p/:projectId/workflow`                  | Workflow (stages, agents, limits; R-B)                                |
| `#/p/:projectId/skills`, `…/skills/:name`  | Skills & Agents (`?tab=agents` for the Agents tab; R-D)               |
| `#/p/:projectId/harness`                   | Harness (R-E)                                                         |
| `#/p/:projectId/tokens`                    | Tokens (R-F: new work vs cache reuse, by session/ticket/role/model)   |
| `#/p/:projectId/sessions`                  | Sessions (the sessions list filtered to the project)                  |
| `#/p/:projectId/settings`                  | Settings                                                              |
| `#/p/:projectId/tickets/:ticketId`         | Ticket (`?tab=`, `?run=` an earlier run, `?change=` on Files changed) |
| `…/tickets/:ticketId/files`                | Old link (D-A): redirects to `?tab=files` (keeps `?run=`)             |
| `…/tickets/:ticketId/changes/:agentRunId`  | Old link (D-A): redirects to `?tab=files&change=:agentRunId`          |
| `#/p/:projectId/runs/:runId`, `…/runs/new` | A Phase 3 run without a ticket, and its start page                    |
| `#/projects`                               | All projects (project cards + "Across your projects")                 |
| `#/projects/new`                           | New project                                                           |
| `#/health`, `#/health/connection`          | Data health: Overview, Connection                                     |
| `#/sessions/:id`                           | One session                                                           |

Every older address redirects without a history entry (`src/app/redirects.ts`): `#/` → the last
project's board, else All projects; `#/board[/:id]`, `#/projects/:id` → board;
`#/projects/:id/settings` → settings; `#/usage`, `#/sessions` → the project's Tokens/Sessions
(the `projectId` query moves into the path; without one, the last or first project);
`#/tickets/:id` → its project's ticket page; `#/setup` → Connection; `#/control` → board;
`#/control/new` → `runs/new`; `#/control/:runId` → its ticket, or its run page.

Build links with `href` (`src/lib/router.ts`): `href.projectPage(id, page, params)`,
`href.ticket({ id, projectId })`, `href.run({ id, projectId })`, `href.skill(id, name)`,
`href.ticketFiles({ projectId, ticketId, runId? })` and
`href.ticketChange({ projectId, ticketId, agentRunId, runId? })` (the ticket's Files changed tab,
all changes or one change, since C-D). Never write hashes by hand.

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

v3 (v0.3.0 D-0): GitHub's look (Primer's colors, borders, radius and components), around the
Control Core logo. Replaces v2's ivory, graphite and signal-lime palette and its bundled fonts.

**Tokens.** All colors are CSS variables in `@theme` (`src/index.css`); `.dark` only redefines
values, and every name is also a Tailwind utility (`bg-panel`, `text-dim`). Charts, graphs and
React Flow read the same names. v3 kept every v2 name that still means what it says (pages
restyled without edits), removed the brand tokens (`brand-graphite`, `brand-ivory`, `brand-lime`),
`accent-ink` (unused) and `accent-fill-hover` (the primary button has its own tokens now), and
added the ones below marked _new_. `tests/design/contrast.test.ts` reads `index.css`, pins the
GitHub values and checks every pair in both themes: text 4.5:1 (AA), lines, dots, rings and chart
series 3:1.

| Token                                                      | Light                                   | Dark                                    | Use                                                                    |
| ---------------------------------------------------------- | --------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `canvas` / `panel`                                         | `#ffffff` / `#ffffff`                   | `#0d1117` / `#0d1117`                   | the page; a box on it (the border draws the box, as on GitHub)         |
| `subtle` _new_                                             | `#f6f8fa`                               | `#151b23`                               | canvas subtle: a card's header row, a table's header band              |
| `sunken`                                                   | `#f6f8fa`                               | `#010409`                               | inset wells: board columns, tracks, skeletons, `kbd`                   |
| `panel-raised`                                             | `#ffffff`                               | `#151b23`                               | menus, popovers, dialogs                                               |
| `hover`                                                    | `#eaeef2`                               | `#212830`                               | row, item, nav and quiet-button hover; the selected nav entry          |
| `sidebar`                                                  | `#f6f8fa`                               | `#010409`                               | the side navigation                                                    |
| `ink` / `dim`                                              | `#1f2328` / `#59636e`                   | `#f0f6fc` / `#9198a1`                   | text (fg default); secondary text (fg muted)                           |
| `line` / `line-muted` _new_ / `line-strong`                | `#d1d9e0` / `#d1d9e0b3` / `#afb8c1`     | `#3d444d` / `#3d444db3` / `#59636e`     | box borders and dividers; quiet row dividers; fields and hover borders |
| `overlay`                                                  | `#c8d1da66`                             | `#01040999`                             | modal backdrop                                                         |
| `accent` / `accent-soft`                                   | `#0969da` / `#ddf4ff`                   | `#4493f8` / `#121d2f`                   | links, focus ring, selected text and borders; quiet selected fills     |
| `accent-fill` / `accent-fill-ink`                          | `#0969da` / `#ffffff`                   | `#1f6feb` / `#ffffff`                   | the accent as a fill: markers, the working edge, the logo's centre     |
| `accent-fill-edge`                                         | `#0969da`                               | `#4493f8`                               | the border of a selected or working shape                              |
| `control` / `control-hover` _new_                          | `#f6f8fa` / `#eff2f5`                   | `#212830` / `#262c36`                   | the default (bordered grey) button                                     |
| `primary` / `-hover` / `-ink` / `-edge` _new_              | `#1f883d` / `#1c8139` / white           | `#238636` / `#207c33` / white           | the green primary button                                               |
| `success` / `success-soft` _new_                           | `#1a7f37` / `#dafbe1`                   | `#3fb950` / `#12261e`                   | success text and fills                                                 |
| `warning` / `warning-soft`                                 | `#9a6700` / `#fff8c5`                   | `#d29922` / `#272215`                   | GitHub's "attention"                                                   |
| `danger` / `danger-soft`                                   | `#d1242f` / `#ffebe9`                   | `#fa5b53` / `#301b1f`                   | danger text and fills (dark a step lighter than `#f85149`, see below)  |
| `danger-emphasis` / `on-emphasis` _new_                    | `#a40e26` / `#ffffff`                   | `#b62324` / `#ffffff`                   | the danger button's hover fill and its text                            |
| `done` / `done-soft` _new_                                 | `#8250df` / `#fbefff`                   | `#ab7df8` / `#252139`                   | GitHub's "done" purple (`Pill tone="done"`)                            |
| `header` / `-ink` / `-dim` _new_                           | `#1f2328` / white / `#d1d9e0`           | `#010409` / `#f0f6fc` / `#9198a1`       | the dark top bar and its text                                          |
| `header-line` / `-hover` / `-focus` _new_                  | `#3d444d` / `#32383f` / `#4493f8`       | `#3d444d` / `#212830` / `#4493f8`       | its borders, hover fills and focus ring                                |
| `tooltip` / `tooltip-ink` _new_                            | `#25292e` / white                       | `#3d444d` / white                       | the tooltip bubble                                                     |
| `observed` / `derived`                                     | `#1a7f37` / `#0969da`                   | `#3fb950` / `#4493f8`                   | `ProvenanceBadge`                                                      |
| `estimated` / `estimated-bg` / `unavailable`               | `#9a6700` / `#fff8c5` / `#59636e`       | `#d29922` / `#272215` / `#9198a1`       | provider-reported and missing values                                   |
| `status-*`                                                 | `#1a7f37` `#9a6700` `#818b98` …         | `#3fb950` `#d29922` `#6e7681` …         | **meaning only**, never decoration (see `index.css`)                   |
| `token-input` / `-output` / `-cache-write` / `-cache-read` | `#0969da` `#bc4c00` `#8250df` `#1b7c83` | `#4493f8` `#db6d28` `#ab7df8` `#39c5cf` | one hue per token type, everywhere                                     |

GitHub's dark soft fills are translucent (`#2ea04326`, `#bb800926`, `#f8514926`, `#388bfd1a`,
`#ab7df826`); the tokens hold them blended over the dark canvas, as one opaque color, so the
contrast test can measure text on them. The dark `danger` is `#fa5b53` instead of GitHub's
`#f85149`, which is 4.4:1 on the default button (`control`); every other value is GitHub's.

In the dark theme the inset wells are the darkest step (`sunken` < `canvas` = `panel` <
`subtle` = `panel-raised`), as on GitHub, so board columns sit below the cards on them.

**One accent, blue.** Links, selection, focus, the selected nav entry's bar, the selected tab's
bar, a selected node's border and ring, a working agent's top edge: all `accent` (or
`accent-fill`, the same blue as a fill). Green is the primary button and success; it is never
used for selection. Lime is gone from the app (the static logo files keep it, see "Brand").

Measured ratios (light / dark, the lowest over the surfaces each is used on): `ink` ≥ 13.5 /
12.9; `dim` ≥ 5.2 / 4.8; `accent` ≥ 4.6 / 5.5; white on `accent-fill` 5.2 / 4.6; white on the
primary button 4.5 / 4.6 (hover too); `header-ink` 11.8 / 13.7, `header-dim` 8.3 / 5.1 and the
`header-focus` ring 5.1 / 6.6 on the top bar; tooltip text 14.6 / 9.8; `success` 4.6 / 6.3;
`warning` 4.5 / 6.3; `danger` 4.6 / 4.7 (also on the default button); `done` 4.5 / 5.2;
`observed` 5.1 / 7.4; `derived` 5.2 / 6.1; `estimated` on its band 4.5 / 6.3; `unavailable`
6.1 / 6.5; status dots ≥ 3.5 / ≥ 4.1; chart series (`token-*`) ≥ 4.9 / ≥ 5.6.

- **Type:** the system font stack, as GitHub sets it (`-apple-system, BlinkMacSystemFont,
"Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`), and the system monospace stack
  (`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`) for
  ids, keys, numbers in code and paths. Nothing is bundled (v2's Inter and JetBrains Mono
  `@font-face` rules are gone). One step larger since v0.3.0 C-S (owner request 2026-10-22,
  "bigger and clearer"), set in the `--text-*` tokens so every page follows: body **15/22px**;
  `text-caption` 13/20px (small text); `text-micro` 12/16px (tiny badges and technical lines
  only); `text-title` 17/24px (card and dialog titles, sub-headings); `text-section` 22/30px;
  `text-page` 26/36px; `text-stat` 26/36px (D-0 had 14, 12, 11, 16, 20, 24 and 24px). Controls
  keep their heights (buttons and fields 32px, pills 20px). Headings are semibold with normal
  tracking. The wordmark is semibold, uppercase, tracked 0.1em (the top bar shows the short name
  "ACP" instead). Tables and `<time>` use tabular numbers; add `tabular-nums` wherever numbers
  line up.
- **Spacing:** a 4/8-pt rhythm. Card bodies and header rows pad 16px; page header to content
  24px; grid gaps 16–24px between cards.
- **Shape:** boxes and controls 6px (`rounded-card`, `rounded-control`), overlays (menus,
  popovers, dialogs) 12px (`rounded-overlay`), pills and labels fully round. Borders are 1px
  `line`; hover moves to `line-strong`.
- **Elevation:** flat. `shadow-card` is a 1px hint (none in dark), `shadow-raised` a soft shadow
  on hover of clickable cards, `shadow-pop` only for menus, popovers, dialogs and tooltips.
- **Focus:** GitHub's 2px `accent` outline with a 2px offset on every interactive element (base
  layer), `header-focus` on the top bar; fields instead turn their border `accent` with a 1px
  inner accent ring (2px of accent in all).
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
- **Card** (`Card`), GitHub's **Box**: a 6px-radius `line` border on `panel`. With a `title` (+
  `tip`, a one-line description) or `actions`, a **header row** on `subtle` with a divider under
  it, 16px padding; the body pads 16px. `padded` false for edge-to-edge tables and graphs (the
  content then starts right under the header's divider: don't add a top border or gap of its own).
  A clickable card is a list item whose title link covers the card (`after:absolute
after:inset-0`), with `line-strong` and `shadow-raised` on hover. `StatCard`: one headline
  number, 16px padding.
- **Table** (`DataTable`): semibold caption-size headers on a `subtle` band (sentence case), a
  `line-muted` border between rows, no zebra stripes, dense rows, `hover` on rows; a card list
  below 1024px.
- **Empty state** (`EmptyState`): the icon on a small bordered tile, a short title, one sentence,
  **at most one action**. `compact` inside a card.
- **Loading** (`Skeleton`, `SkeletonText`, `SkeletonCard`, `LoadingBlock`): soft `sunken` blocks
  instead of spinners; the loading words stay in the page, visually hidden. `QueryView` uses
  `LoadingBlock`.
- **Buttons** (`Button`, `ButtonLink`, `buttonClass`), GitHub's: 32px (`sm`: 28px), 6px radius,
  medium weight. `primary` green (`primary`, white text, a faint dark edge; one per page area),
  `secondary` the default bordered grey (`control` with a `line` border, `control-hover`),
  `quiet` (text or icon, `hover` fill), `danger` red text on the default button that fills
  `danger-emphasis` with white text on hover (for confirmations and destructive actions).
- **Inputs** (`Input.tsx`): **native** `<input>`, `<select>`, `<textarea>`, checkboxes and radios,
  restyled. One field style, `fieldClass` (GitHub's: 32px tall, 6px radius, `line-strong` border,
  on focus the `accent` border plus a 1px inner accent ring, danger border and ring with
  `aria-invalid`, a `sunken` fill when disabled, no width), `inputClass(extra)` (full width),
  wrappers `TextInput`, `Select`, `TextArea`, and `labelClass`/`hintClass` (labels above, hints
  below in caption text). Checkboxes, radios and ranges take `accent`.
- **Pills and tags** (`Pill`, `Badge`), GitHub's labels: rounded pills, 20px, 12px medium text,
  with a border in the tone (at half strength) and text in the tone. `Pill` is a state word with a
  dot and the tone's soft fill; `Badge` a tag or count, outline only, without a dot (`mono` for
  keys). Tones `neutral`, `accent`, `success`, `warning`, `danger` and (v3) `done` (purple),
  mapped from meaning (for example harness Ready → success).
- **Status** (`StatusBadge`): dot (color plus shape) + word + ⓘ. `ProvenanceBadge`: tiny
  uppercase tag, `observed`/`derived` tokens; estimated is dashed and italic.
- **Tabs** (`Tabs`, `TabList`, `Tab`, `TabPanel`; Radix Tabs), GitHub's UnderlineNav: 40px tabs
  with a rounded `hover` fill behind the label; the selected tab is `ink` over a 2px `accent` bar
  on the list's bottom border (same weight, so tabs never shift). Arrow keys move and select, a
  click selects; controlled by the owner. **Link tabs** (`LinkTabList`, `LinkTab`) draw the same
  bar for sections that are addresses: a `navigation` of links with `aria-current="page"` (Data
  health).
- **Dialog** (`Dialog`; Radix Dialog), Primer's overlay: 12px radius, `panel-raised`, a `line`
  border, `shadow-pop`, 16px padding, the title 16px semibold, a 32px × button. Open while mounted,
  `onClose` on Escape, backdrop click or the optional × (`closeLabel`); `aria-modal`, focus to
  `[data-autofocus]` or the first control, Tab trapped, focus back to the opener just after it
  closes, but only while focus is still in the dialog or nowhere. A dialog opened in the same
  render that closed another (the palette's New ticket) keeps focus and takes over the closed
  one's opener.
- **Menu** (`Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator`; Radix DropdownMenu), Primer's
  ActionMenu: a 12px-radius overlay with 8px padding, 6px-radius items, semibold muted group
  labels, full-width separators. A menu button; ArrowDown/Enter/Space open it on the first item,
  arrows move (`loop` wraps at the ends), Escape closes to the trigger; `tone="danger"` for
  destructive items. Not modal by default. The highlighted item has the `hover` fill, and with the
  keyboard the 2px accent ring, inset.
- **Focus:** every interactive element shows a 2px `accent` outline on `:focus-visible` (3:1 or
  more against its surface in both themes, `header-focus` on the top bar; e2e `focus-ring.ts`
  measures it). Never remove it without an equal replacement.
- **Popover** (`Popover`; Radix Popover): a small floating panel (`role="dialog"`, named by
  `label`) toggled by its trigger, in the menu's overlay look.
- **Segmented** (`Segmented`), Primer's SegmentedControl: a labelled group of `aria-pressed`
  buttons on a `hover` track; the chosen one is a `panel` knob with a `line-strong` edge.
- **Tooltips** (`Tooltip`, `InfoTip`, and the shell's `ShellTooltip`): kept hand-built where they
  were (they open at once on hover and focus, InfoTip also on tap, and the text exists only while
  open). Primer's bubble in both themes: `tooltip` (dark grey) with `tooltip-ink` (white) 12px
  text, 6px radius.
- **Toast:** the app has none; a saved form says so in place (a `role="status"` line).
- **Errors** (`ErrorNotice`): an alert on `warning-soft` (server unreachable) or `danger-soft`,
  with an icon; tokens only.
- **Theme** (`components/ThemeSwitch.tsx`, `lib/theme.ts`, v0.3.0 D-0): **Light**, **Dark** or
  **System** (follows the computer's `prefers-color-scheme`, live: the page switches when the
  computer does).
  - `ThemeMenu`, in the top bar: an icon button showing the current choice's icon (sun, moon,
    monitor) named "Theme: Dark. Change theme" (System says what it shows now, "System (dark)"),
    with a "Theme" tooltip, opening a small menu of the three as `menuitemradio`s with the chosen
    one checked and "Follows your computer" under System; like GitHub's appearance setting.
  - `ThemeChoice`, in Settings → **Appearance** ("How the app looks in this browser."): the same
    three as a `Segmented`.
  - One store (`useTheme`, `setThemePreference`): both controls always agree; a choice made in
    another tab follows through the `storage` event. Remembered in this browser as `acp.theme`
    (`light` or `dark`; System is the absence of a choice), every access guarded (no storage means
    the choice lasts for the page).
  - **No flash:** `index.html` has a small inline script in `<head>` that reads `acp.theme` and
    the media query and sets `.dark` and `color-scheme` on `<html>` before anything paints; the app
    repeats it on start. Keep the two in step (`tests/lib/theme.test.tsx` runs the page's script).
- **Brand** (`BrandMark`, `BrandLogo`): the Control Core drawn with `currentColor` (white on the
  dark top bar) and an `accent-fill` (blue) centre framed in the mark's own color; `tone="mono"`
  for one color. From 20px it uses the master geometry (48 grid), below it the 16-grid one (the
  favicon's). Decorative (`aria-hidden`) unless given a `label`, which makes it `role="img"`.
  `BrandLogo` adds the wordmark: the app name as text, uppercase in CSS only, or screen-reader-only
  with `hideName`; with `shortName` (the top bar's "ACP", C-S) the short name shows, hidden from
  screen readers, and the full name stays as screen-reader text. The static files (`public/brand`, `docs/brand`) keep their own
  fixed colors, lime centre included; their rules are in the README, "Brand". The app chrome
  around the logo is GitHub-like since v3. The logo is identity, never decoration: one in the top
  bar, one in the tab.
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
  - Each file: a header row on `subtle` with a button (`aria-expanded`), status word, similarity,
    `Binary` and `Cut` tags and +/−; then a table with line numbers before and after, a decorative
    +/− sign and the screen-reader words "Added line" / "Removed line"; changed words in a
    stronger tint of the line's color. Unchanged runs keep 3 lines next to a change; longer runs
    fold behind "Show N hidden lines". Side by side needs 36rem; where the viewer is narrower (the
    side panel beside the agents, a phone; followed with a ResizeObserver) it shows unified, with
    Side by side off (`aria-disabled`, tooltip "Not enough room here") and the saved choice kept
    for wider places (G-D). Unified wraps long lines.
  - **Diff colors** (`diff.css`, GitHub's, v3): added lines `#dafbe1` / `#2ea04326` (light /
    dark), removed `#ffebe9` / `#f8514926`, changed words `#aceebb` / `#2ea04366` and `#ffcecb` /
    `#f8514966` laid over the line, hunk headers `#ddf4ff` / `#388bfd26`, the empty side of a split
    row `#f6f8fa` / `#151b23`, +/− signs `#116329` / `#3fb950` and `#a40e26` / `#ff7b72`. Dark
    values stay translucent in the CSS; the contrast test blends them as they are painted (line on
    `--diff-bg`, word on its line).
  - Syntax colors from Shiki, loaded with dynamic imports only for a known language
    (`language.ts`) when a file is drawn; the CSS-variables theme, so `diff.css` sets the colors
    for both themes: GitHub's "prettylights", a step darker (light) or lighter (dark) where a color
    fell under 4.5:1 on a changed-word tint (keywords, functions, constants, comments, parameters;
    `tests/components/diff/contrast.test.ts` checks every syntax and gutter color on every line
    background). Plain text while loading, on failure, for other languages and above 3,000 lines.
  - Large diffs: a file over 400 lines, and every file after the first 1,500 lines, waits for
    "Show this file". A diff the server cut says so, marks the cut file, and names the listed
    files after the cut.
  - **For Files changed (D-A, C-D)**, `DiffFileView` takes optional, additive props; without them
    it draws exactly as before: `slots` (`gutter` a control at a line's start per side, `below`
    rows under a line per side, one cell per side in split view, `selected` an accent bar on a
    range, `pinned` lines whose fold opens by itself), `headerEnd` (controls at the end of the
    header row) and `stickyHeader` (the header sticks at `--diff-sticky-top`; the file box is
    `overflow-clip` so it can).

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
- **The accent means working or selected, nothing else** (blue since v3; it was lime): a working
  agent has an `accent-fill` top edge; the selected node an `accent-fill-edge` border with a soft
  `accent` ring (25%); the live workflow's working stage an accent outline with a soft accent
  halo. Idle and finished agents are neutral, and the budget bar is neutral within budget.
- **Warning and danger only for real states:** a request waiting for you, a failed stage, a budget
  near or over its limit. A passed check is `success` green (its own `passed` tone), not the grey
  of finished work.
- **Conversations stay neutral:** in the chat and the ticket's comments your messages are an
  outlined bubble (`line-strong` on `panel`) and the agents' a filled one (`hover`); no accent
  tint, since the accent means working or selected.
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
  approval's line) and an **owner-merge gate** ("You · Finish", v0.3.1) with Done under it.
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

## Files changed: one GitHub review UI (v0.3.0 D-A, C-D)

Owner decisions 2026-10-22: "The code review should be like a code review in GitHub, side by
side" (D-A), then "we have two different UI for code review and view after; we need a single UI"
(C-D). The ticket page's **Files changed tab is the review UI** (`features/ticket/FilesTab.tsx`
over D-A's `features/review/` parts); there is no separate summary table, second diff viewer or
review page. The shell drops its 88rem limit while the tab is open (`nav.ts` `fullWidth`), like
GitHub's. D-A's addresses `…/tickets/:ticketId/files` and `…/changes/:agentRunId` redirect
(replace) to `?tab=files` and `?tab=files&change=:agentRunId`, keeping `?run=`.

- **Head** (`files-head`): **Changes from** (`ChangePicker.tsx`, a Radix menu of
  `menuitemradio`s like the theme menu: arrows, Enter or Space, Escape back to the button; the
  chosen one checked): **All changes** (the ticket branch from base to tip,
  `GET /runs/:id/ticket-branch`; the default when the run has one) or one helper's change, each
  with its state word, checks and file count (`GET /runs/:id/review`). The choice is `?change=`
  (replaced, not a history entry; another tab drops it; another run resets it). A run without a
  ticket branch has no "All changes" and opens its first change. Then the **state label**, GitHub's
  filled pill with an icon and the word: **Open** (green), **Merged** (purple, `done`), **Closed**
  (red, a discarded branch); then `branch into target` (or `merged into target` with the merge
  commit, or `was discarded`), the tip and its checks and the changes merged; for one change its
  state chip, "Round N", checks, rework badges and commit, and **Open in Agents** (the change card
  in the side panel, where the owner merges, reworks or discards).
- **Open work:** everything below is interactive. **Merged or closed work:** the same layout read
  only (ADR-0026 §5): the tree, the files, Unified / Side by side and **Viewed** (kept in this
  browser) stay; no "+" on lines, no comment boxes, no `c` key, no Review changes ("Read only" in
  its place); a pending review kept from before stays in the browser, unseen and unsent. When the
  server answers 410 (or a refusal naming missing commits, or an empty answer for settled work),
  an empty state "Files no longer available" fills the body under the same head. A change the
  server no longer lists says so, with "Show all changes".
- **Sticky bar** (sticks under the top bar and the demo banner, both measured): the file-tree
  toggle, "N files changed +A −D", Unified / Side by side (the shared `acp.diff.view` choice;
  **side by side until the owner chooses** here; unified with the reason where there is no
  room), "X of N viewed", Collapse all / Expand all, the keys (a popover), and **Review changes**
  (green, with the pending count).
- **File tree** (left, sticky, 17–19rem; stacked above the files below `lg`, hidden by default
  there): a filter box (every word, ignoring case, old names too), folders first and single-folder
  chains folded ("src/search"), each file with its status icon, a comment count, a check once
  viewed and +/−. A click scrolls to the file and focuses its header. The files on the right
  follow the tree's order.
- **Files:** the shared `DiffFileView` boxes with a sticky header and a **Viewed** checkbox, which
  collapses the file (its header still opens it). Viewed files are kept per change and commit in
  this browser (`acp.review.viewed.<run>:<agent|branch>@<commit>`; a new commit starts afresh and
  drops older lists).
- **Line comments:** a blue "+" at the start of a line (on hover, and always on focus; faintly on
  touch screens) opens a comment box under it; shift-click a second "+" on the same side for a
  range (the range gets an accent bar). Comments join the **pending review**: "You · Pending ·
  line 42 (after)", Edit and Delete. Kept per change in this browser
  (`acp.review.pending.<run>:<agent|branch>`, every access guarded; read back as data, junk
  dropped) until sent. A comment whose line is folded opens its fold; one whose line or file is
  no longer in the diff is listed above the files.
- **Review changes** (a popover): an overall comment, then the choices, the ones that don't apply
  disabled with the reason:
  - a change: **Request changes** sends the comments back to the helper as rework
    (`POST /runs/:id/review` `rework`, at most 4,000 characters), only when it is the owner's turn
    on the change (as the change card's buttons);
  - the ticket branch: **Request changes** to the lead (`POST /runs/:id/ticket-branch`
    `request-changes`, 8,000), only while the branch waits for the final step;
  - **Comment**: an owner ticket comment (`POST /tickets/:id/comments`, 8,000), always.

  The text is compiled as `Review comments:` then `- path:42 (new): text` per comment (ranges
  `10–14`, the old side `(old)`, later lines indented, "written on <sha7>" for an earlier commit),
  then the overall comment; a preview shows it. Over the limit, the popover says how long it is and
  waits: nothing is cut. Sent, the pending review is cleared and the page says where it went.

- **Keys** (not while typing or in a dialog): `j` / `k` next and previous file, `v` viewed, `c`
  comment on the focused line (on a file, it goes to its first changed line). A file's "+"
  buttons are one tab stop (the first changed line); ↑/↓/Home/End move between lines.
- **Entry points:** the tab itself; "Review files" on the change card (once the change is saved),
  "Files changed" on the ticket branch card (while it is open) and Conversation's links all go to
  the tab with the matching "Changes from" (`href.ticketChange`, `href.ticketFiles`).
- Copy lives in `features/review/copy.ts`; the rules (selection, state, "no longer available") in
  `features/review/files-state.ts`; no server change and no new storage.

## Ticket page: Comments, Conversation, attachments (v0.3.0 C-B, ADR-0026)

The ticket page's tabs are **Comments · Agents · Files changed · Checks · Conversation**
(`ticket-tabs.ts`). Comments is the default (no `?tab=`); `?tab=conversation` opens the last one.
Old words still land: `comments` and `plan` on Comments, `workflow` on Agents, `changes` on Files
changed, `activity` and `timeline` on Conversation. A comment's tab follows its `kind`
(`features/activity/comment-kind.ts`); a comment without one gets it as ADR-0026 says (owner →
comment, reviewer → review, the app → run facts or a one-line system note, the lead → note).

- **Comments** (`features/ticket/CommentsTab.tsx`), the home: what waits for you (approvals,
  changes that need you, the legacy review list) and the plan under review stay first, then a
  thread on GitHub's vertical line: the description box (the key, Description, Created, **Attach
  files** and Edit; the ticket's own attachments under the text), the lead's **ticket summary**
  (one card with an accent edge and a "Ticket summary" label, the newest version, "Updated" once a
  later run rewrote it, earlier versions folded under "N earlier summaries"), people's comments
  (with "on plan version N" and their attachments), the final-step box and the comment box. A line
  under the thread points to Conversation. The sidebar stays beside it.
- **Safe formatting** (`features/activity/RichText.tsx`) for every text written on the ticket:
  paragraphs keep their line breaks; lists, quotes, fenced and inline code, bold and italic; links
  only for `http(s):` and `mailto:`, in a new tab without a referrer; HTML shows as text; headings
  read as bold lines (a comment never adds to the page outline).
- **Attachments** (`features/attachments`): images as 10rem thumbnails that open the file in a new
  tab, other files as chips (type icon, name, size, download). The owner's own have a Delete that
  asks once, in place ("Delete name? Agents can no longer read it."), focus on its Delete. Attach
  with the button (a hidden file input, several files) or by dropping files on the box (a dashed
  accent overlay says "Drop files to attach them"). The browser checks the core limits first (10
  MB, 50 per ticket, 10 per comment, the allowlist by type or extension, never HTML or SVG, a plain
  name) and lists a refused file with the reason; an allowed one uploads at once (raw bytes,
  `X-Attachment-Name`), shows "Uploading…" then "Attached", and its id goes with the comment.
- **Conversation** (`features/activity/ActivityTimeline.tsx`): `GET /api/tickets/:id/activity`
  oldest first, full width. **Filter chips** above it ("Show": Everyone, then each actor with a
  count; `aria-pressed` buttons, one at a time). Each item on the line with an icon marker: runs
  starting (with "Show this run"), plan versions (folded steps), agents starting and ending as event
  lines; agents' notes, the reviewer's findings (an accent edge and the "Reviewer" label), the
  lead's notes and decisions as boxes; the run facts as the run summary card (ADR-0024's card,
  moved here); merges and pull requests as the small merge line. Links per item: Files changed
  with that change or all changes chosen (C-D), the pull request (opens on GitHub), the plan. A
  server without the route gets the same timeline from the ticket's own runs, plans and comments.
- **Files changed after a merge:** the same review UI read only, with the purple "Merged" label
  (see "Files changed: one GitHub review UI"); "Files no longer available" when the commits are
  gone.
- Copy lives in `features/activity/copy.ts`.

## The harness in the workflow (ADR-0027, WP H-D)

- **Checks blocks on the canvas** are steps as wide as an agent card (216×52, since v0.3.1): their
  place in plain words over their name ("Checks before merge", "Checks on a change", "Checks on
  the branch"), and a small outlined chip saying what they run ("Required", "2 checks", "fast ·
  full"; read out as "Runs: …"). On a change they sit in the work row next to the helpers; on the
  branch on the merge chain before the Finish block. No new link kinds or styles: a change block is reached by a "Next step" link
  and sends work back with a "Rework" link.
- **Add block** has a third group, **Checks**: "Checks on a change" (linked from the selected
  helper or tester when it has none, else the first without one), "Checks before merge" (one,
  between the lead and the ticket branch) and "Checks on the branch" (one, just before the Finish
  block). A full item stays listed with its reason, like the others.
- **The Checks block panel** (`editor/CheckBlockFields.tsx`): Name; **Where it runs** (the block
  before the lead's merge stays in its place; since ADR-0028 it can be removed like any other);
  **Which checks** as choice cards (all required / pick checks / by label) with a checklist of
  the harness's checks (name, id, Required, labels) or label chips (`aria-pressed`), a picked
  name the harness no longer has flagged in the warning tone with a remove button, and a
  "Runs: …" line; **When a check fails** offers only the place's routes in plain words, and
  "Back to the helper" shows the rounds (0–5) of its rework link; a last line says the block is
  optional and what happens without it. Missing picks are warnings in Problems (code
  `check-missing`, `check-label-missing`).
- **Harness page:** a **Setup** card (steps table: name with a warning-tone "Uses the network"
  badge, command, time limit, "Creates" folders) with the **"Setup may use the network"** switch
  (`role="switch"`, its On/Off word next to it, saved at once; the line under it says how many
  network steps won't run while it is off) and the latest setup runs on main. The Checks table
  gains **Labels** (mono badges) and **Where it runs** (the Checks blocks that pick the check).
  The header button reads "Run setup and checks now" once there is setup.
- **Ticket, Checks tab:** Setup (per agent copy, then "For the checks"), then On each change, Before
  the lead's merge (rows without a place land here), On the ticket branch, Run now on the main
  branch. Setup and check outputs are native disclosures, open when the step or check did not
  pass; the chevron's turn honours reduced motion.

## Effort, optional checks and the Finish block (ADR-0028, v0.3.1 P-B)

- **Effort:** an agent block's panel has an **Effort** select under Model: "Default (the model
  decides)", Low, Medium, High, with one hint line ("How much the agent thinks before acting: more
  effort is slower and uses more tokens."). Default leaves the field out of the graph. A block
  that sets one shows a neutral outlined chip ("High effort") next to its skills on the canvas
  and on the live graph, and the agent's Details tab has an **Effort** row (from the run's own
  graph; left out while it is not known).
- **Checks blocks are optional:** every one has Remove. With none, Problems lists core's warning
  (under "Warnings (you can still save)"); Save stays enabled.
- **The Finish block** (`features/workflow/finish.ts`): the editor and the live run graph draw the
  end of every flow (ticket merge → your merge → Done) as one fixed block on the `subtle` well
  (editor 320×64, live 300×76): the accent "you" icon, **Finish**, "Merge into <target> or open
  a pull request" (the project's default target in the editor, the run's target on the ticket
  page, "your target branch" when unknown; never "main" unless the target is main) and a Done
  tick on the right ("then Done" in `dim`; "Done" in `success` with the success ring once the
  ticket is done). It is the `owner-merge` node: links end on it, none starts from it, it has no
  Remove, and its panel explains the final step in one sentence and three numbered lines.
  Presentation only: the stored graph keeps the three nodes and their links, a link around a
  hidden step keeps its own id, and a problem with a hidden step shows on the Finish block.

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
