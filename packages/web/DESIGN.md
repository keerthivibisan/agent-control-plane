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
> tokens and components; pages adopt the new shared components in U-B…U-F.

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
┌──────────────────────────────────────────────────────────────────────────────┐
│ [AC] Agent Control Plane │ [■ web-app ▾]                 [⌕ Search… ⌘K]  ☾  │  top bar
├───────────────┬──────────────────────────────────────────────────────────────┤
│ PROJECT       │  (demo banner)                                               │
│  Board        │  Page title  ⓘ                              [Primary action] │
│  Tokens       │  One line about the page.                                    │
│  Sessions     │                                                              │
│  Settings     │  cards…                                                      │
│ ───────────── │                                                              │
│  All projects │                                                              │
│  Data health  │                                                              │
│ ● Live        │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

- **Top bar** (`Shell.tsx`, sticky, 56px): the app mark (links to `#/`), the **project switcher**
  (`ProjectSwitcher.tsx`: current project, a menu of projects with their folders, All projects and
  New project; arrow keys, Esc), the **⌘K** button and the theme toggle.
- **Project sidebar**: a "Project" label, the project's pages from `PROJECT_PAGES` (only the
  `available` ones), a divider, then **All projects** and **Data health**. The footer has the
  live-connection dot and the server status. Above 1280px it shows labels (15rem); at **1280px and
  below it collapses to icons** (4.5rem; the label stays as `title` and screen-reader text). The
  `wide:` Tailwind variant is that breakpoint (1281px). The active entry is a raised `panel` step
  with a hairline and a 3px signal-lime marker on its left edge (outlined in `accent-fill-edge`).
- **Which project:** the one in the address (`#/p/:projectId/...`), else the last one used
  (`src/app/last-project.ts`, localStorage, every access in try/catch). On All projects the
  switcher reads "All projects". The project section is hidden when there is no project.
- **Main area:** max 88rem wide, 24px side padding (40px above 1280px), 32px top. Page header, then
  cards in a 24px grid gap.
- **Demo mode:** a slim banner "You're looking at sample data", sticky under the top bar.
- **Data health** has two sections as a segmented control: **Overview** (`#/health`) and
  **Connection** (`#/health/connection`, which was Setup: project folders and hooks).
- Responsive down to ~1024px; tables become card lists below that.

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
  move and select, a click selects; controlled by the owner.
- **Dialog** (`Dialog`; Radix Dialog): open while mounted, `onClose` on Escape, backdrop click or
  the optional × (`closeLabel`); `aria-modal`, focus to `[data-autofocus]` or the first control,
  Tab trapped, focus back to the opener just after it closes.
- **Menu** (`Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator`; Radix DropdownMenu): a menu button;
  ArrowDown/Enter/Space open it on the first item, arrows move, Escape closes to the trigger;
  `tone="danger"` for destructive items. Not modal by default.
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

## Agent views (the logo's vocabulary)

The ticket's agent canvas, its live workflow, the Workflow page, the sessions graph and the legacy
control tree draw agents the way the logo does (owner decision, WP U-G):

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
  near or over its limit.
- Diagrams show only real relationships and states (AGENTS.md rule 1): no decorative nodes or
  lines.

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
