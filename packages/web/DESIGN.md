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
> - Linear/Vercel style: neutral zinc greys and one indigo-violet accent;
> - near-black dark surfaces, hairline borders, radius 8/6 px, almost no shadows;
> - Geist Sans and Geist Mono (bundled), lucide icons;
> - Radix for dialogs, menus, tabs, popovers and tooltips;
> - subtle motion that respects reduced motion.
>
> The principles below still hold. WP U-A replaces the "Visual system" section with the final
> tokens; until then the current section describes the shipped v0.0.1 look.

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
4. **Calm visuals.** Neutral surfaces, one accent color, soft rounded cards, generous spacing, light
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
  `wide:` Tailwind variant is that breakpoint (1281px). The active entry has a soft accent fill
  and a 3px accent bar on the left.
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

**Tokens.** All colors are CSS variables in `@theme`; `.dark` only redefines values.

| Token                                                              | Light                         | Dark                          | Use                                   |
| ------------------------------------------------------------------ | ----------------------------- | ----------------------------- | ------------------------------------- |
| `canvas` / `panel` / `sunken`                                      | `#f7f7f8` `#ffffff` `#f2f2f4` | `#0d0d10` `#16161a` `#1e1e23` | page, cards, wells and hovers         |
| `ink` / `dim`                                                      | `#18181b` / `#5d5d68`         | `#ededf0` / `#a1a1ad`         | text, secondary text                  |
| `line` / `line-strong`                                             | `#e8e8ec` / `#d4d4da`         | `#27272d` / `#3b3b43`         | borders (soft), hover borders         |
| `accent` / `accent-soft`                                           | `#4f46e5` / `#eef0ff`         | `#8b93ff` / `#23244a`         | the one accent: links, focus, primary |
| `status-*`, `success`, `warning`, `danger`, `token-*`, `estimated` | unchanged                     | unchanged                     | **meaning only**, never decoration    |

- **Type:** body 14px; `text-caption` 12px; `text-title` 17px (card titles); `text-section` 20px
  (a heading that groups cards); `text-page` 28px (page title); `text-stat` 28px (big numbers).
  Tabular numbers for counts.
- **Spacing:** an 8-pt rhythm. 8/16/24/32/48px (`gap-2/4/6/8/12`). Cards pad 24px. Grid gaps are 24px
  between cards and 48px between page sections.
- **Radius:** cards 12px (`rounded-card`), controls 8px (`rounded-control`), pills fully round.
- **Elevation:** `shadow-card` at rest (barely there), `shadow-raised` on hover of clickable cards,
  `shadow-pop` for menus, dialogs and the palette. Borders stay `line`; hover moves to `line-strong`.

**Components.** Use these; don't restyle per page.

- **Page header** (`PageHeader`): title, optional ⓘ `tip`, one-line `description`, primary
  action on the right, optional `eyebrow` (a back link). `SectionHeader` for a heading that groups
  cards inside a page.
- **Card** (`Card`): title (+ `tip`), optional one-line description, actions on the right; `padded`
  false for edge-to-edge tables and graphs. A clickable card is a list item whose title link
  covers the card (`after:absolute after:inset-0`), with `shadow-raised` on hover.
- **Table** (`DataTable`): uppercase caption headers, light row dividers, 24px outer cell padding,
  roomy rows, no zebra stripes; card list below 1024px.
- **Empty state** (`EmptyState`): an illustration (the icon on soft accent rings), a short title,
  one sentence, **at most one action**. `compact` inside a card.
- **Buttons** (`Button`, `ButtonLink`): 36px (`sm`: 32px). `primary` (accent fill, one per page
  area), `secondary` (bordered panel), `quiet` (text), `danger` (soft red, for confirmations).
- **Inputs** (`Input.tsx`: `inputClass`, `TextInput`, `Select`, `TextArea`): 36px, soft border,
  accent focus ring; labels above, hints in caption text below.
- **Pills** (`Pill`): a word with a dot; tones `neutral`, `accent`, `success`, `warning`,
  `danger`, mapped from meaning (for example harness Ready → success).
- **Tooltips** (`Tooltip`, `InfoTip`): dark bubble (`ink` on `canvas`), 12px text, opens on
  hover and focus; InfoTip also on tap.
- **Icons** (`components/icons.tsx`): 24×24 strokes, 1.75px, `currentColor`, decorative. Every
  nav entry has one.

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
