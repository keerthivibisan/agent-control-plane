# R-A — Shell, navigation, visual system

> Progress file for R-A. Only the agent working on R-A edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
| Owner   | frontend agent |
| Branch  | `wp/r-a-shell` |
| Started | 2026-10-16     |
| Updated | 2026-10-16     |

## Work log (append-only; newest last)

Hashes are from after the last rebase on `main` (59c56c4).

| Date       | What was done                                                                                                    | Commit    | Checks                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------- |
| 2026-10-16 | Claimed R-A on `wp/r-a-shell`                                                                                    | `f7908cc` | docs only                                       |
| 2026-10-16 | WIP: shell, routes, redirects, palette, All projects, visual tokens and shared components (tests partly updated) | `d11eeac` | not run (WIP, not checked)                      |
| 2026-10-16 | Paused by the owner; handoff note                                                                                | `4c50654` | docs only                                       |
| 2026-10-16 | Resumed; suites updated for the new routes; tests for router, redirects, shell, switcher, palette, All projects  | `8870a4a` | format ✓ lint ✓ typecheck ✓ test 1691 ✓ build ✓ |
| 2026-10-16 | Exact `#/control/<run>` redirect from `RunSummaryDto.ticketId` (decision D)                                      | `b5fa392` | format ✓ lint ✓ typecheck ✓ test 1694 ✓ build ✓ |
| 2026-10-16 | DESIGN.md: layout, routes, page plug-in rule, palette, visual system                                             | `855c82c` | format ✓ (docs only)                            |
| 2026-10-16 | e2e for moved routes, new `shell.spec.ts` with screenshots; card and palette polish                              | `e5ba1e4` | check ✓ test 1694 ✓; e2e 20/20 ✓                |
| 2026-10-16 | Rebased on `main` 59c56c4; completion report; status `review`                                                    | (this)    | check ✓ test 1719/1719 ✓; e2e 20/20 ✓           |

## Handoff notes

### Paused (2026-10-16), resolved

The pause note's steps 1 to 7 are all done (see the work log). The decision on ticketless Phase 3
runs (`#/p/:projectId/runs/:runId`) was accepted by the coordinator. The proposed
`RunSummaryDto.ticketId` landed on main as decision D and is used.

### For the page WPs (R-B, R-D, R-E, R-F, R-H)

- **Plug in a project page:**
  1. Set `available: true` for your entry in `src/app/project-pages.ts`.
  2. Replace your `case` in `ProjectScreen` (`src/app/App.tsx`), which returns `NotFound` now.
  3. Start the page with `PageHeader`: the nav label as title, one short line, `tip` for longer
     text, and the primary action in `actions`.

  The sidebar and the palette pick the page up automatically. See `packages/web/DESIGN.md`,
  "Adding a project page".

- **Links:** build them with `href.projectPage(id, page, params)`, `href.ticket({ id, projectId })`,
  `href.run({ id, projectId })` and `href.skill(id, name)`. For Skills, `route.item` holds `:name`.
- **R-H:**
  - The board page still has its own project `<select>` in its header, which duplicates the top-bar
    switcher. Remove it.
  - The old project page `features/project/ProjectPage.tsx` is no longer routed. Delete it (and its
    tests) once nothing needs it.
  - `features/ticket/redirect.tsx` is unused by the app now (its `RedirectTo` moved to
    `src/app/Redirect.tsx`).
  - The Phase 3 run page (`#/p/:id/runs/...`) stays until "Quick ticket" replaces ad-hoc runs.
- **R-F:** Tokens today is `UsageAnalytics` with `projectId` forced from the path. Its default
  "group by project" is pointless inside one project, and that goes away with your page.

## Blockers / proposed contract changes

_None._ (`RunSummaryDto.ticketId` was proposed here and is on main as decision D.)

## Completion report (AGENTS.md §9)

## Completion report — R-A

1. **Summary:** the project-first shell.
   - A top bar with the app mark, a project switcher that remembers the last project, a ⌘K button
     and the theme toggle.
   - A project sidebar driven by `PROJECT_PAGES` with `available` flags. It collapses to icons at
     ≤1280px.
   - `#/p/:projectId/...` routes, and redirects (no history entry) from every old address.
   - An All projects page that also contains the old Overview.
   - The ⌘K command palette.
   - Refreshed design tokens and shared components, documented in DESIGN.md.
2. **Files changed** (all under `packages/web/` unless noted):
   - Created:
     - `src/app/{HealthScreen,ProjectSwitcher,Redirect}.tsx`, `src/app/{last-project,project-pages,redirects}.ts`;
     - `src/features/all-projects/{AllProjectsPage,ProjectCard,project-bits}.tsx`;
     - `src/features/palette/{CommandPalette.tsx,commands.ts}`;
     - `src/components/{Pill,Input}.tsx`;
     - `tests/app/redirects.test.ts`, `tests/features/{palette,all-projects-page}.test.tsx`;
     - `e2e/shell.spec.ts`.
   - Moved with `git mv`: `features/command-center/{CommandCenter→all-projects/AcrossProjects,ActivityFeed,CostBySession,SessionRows}`,
     `features/projects/ProjectsList → all-projects/project-bits`, and
     `tests/features/command-center.test.tsx → all-projects.test.tsx`.
   - Modified, R-A's own files:
     - `src/app/{App,Shell}.tsx`, `src/lib/router.ts`, `src/index.css`;
     - `src/components/{Button,Card,DataTable,DemoBanner,EmptyState,PageHeader,StatCard,Tooltip,icons}.tsx`;
     - `src/lib/copy.ts`: add-only `SHELL_COPY`, `ALL_PROJECTS_COPY` and `PALETTE_COPY`, plus
       `PAGES.setup.title` changed to "Connection";
     - `DESIGN.md`.
   - Modified, link helpers only, in other WPs' files: `features/board/TicketCard.tsx`,
     `features/project-setup/HarnessPanel.tsx`, `features/control/{StartRun,RunList}.tsx` and
     `features/project/ProjectPage.tsx` (import path).
   - Modified tests, for moved routes and nav only:
     - `tests/app/shell.test.tsx` (rewritten), `tests/lib/router.test.ts` (rewritten);
     - `tests/features/{board,board-logic,control,control-logic,explorer,project,project-setup,project-setup-logic,setup,ticket,usage}.test*`;
     - `e2e/{demo,control,ticket}.spec.ts`, `e2e/ticket-fixtures.ts` (adds `fixtureProject()`),
       and `e2e/playwright.config.ts` (adds the `shell` project);
     - `docs/redesign/wp/R-A.md`.
3. **Commands run and actual results** (root, Node 22.21.1, pnpm 10.26.1, after rebasing on 59c56c4):
   - `pnpm check`: format ✓, lint ✓, typecheck ✓, build ✓.
   - Tests: 1719/1719 passed (core 243, demo 12, orchestrator 366, claude-code 268, db 153, web
     354, server 323).
   - `ACP_E2E_PORT=7751 ACP_E2E_CONTROL_PORT=7761 pnpm --filter @acp/web test:e2e`: 20/20 passed
     (demo 7, ticket 4, shell 5, control 4), with `ACP_SCREENSHOT_DIR` set.
   - That e2e run was before the final rebase. The rebase brought only server and db changes.
4. **Acceptance criteria:**
   1. Top bar with mark, switcher (localStorage in try/catch), ⌘K hint and theme toggle: **met**
      (`tests/app/shell.test.tsx`, `e2e/shell.spec.ts`).
   2. Sidebar with the available pages, then All projects and Data health; the old entries
      removed; icons only at ≤1280px: **met** (shell test, and the e2e collapse test that measures
      the width at 1440 and 1280).
   3. `#/p/:projectId/...` routes mapped to today's components:
      - board → BoardPage;
      - tickets → TicketPage;
      - settings → ProjectSettings;
      - sessions → SessionExplorer, and tokens → UsageAnalytics, both with `projectId` forced from
        the path.

      **Met** (router tests; e2e demo and ticket specs).

   4. No placeholder pages; `PROJECT_PAGES` with `available` flags, documented: **met**.
      Workflow, Skills and Harness are hidden and read "Page not found" (shell test).
   5. Redirects from every old route; `#/sessions/:id`, `#/projects/new` and `#/health` kept;
      unit-tested: **met** (`tests/app/redirects.test.ts`, plus App-level tests in the shell,
      board, control and ticket suites).
   6. All projects page:
      - cards with name, folder, harness, running and needs-you counts from the board, and last
        activity;
      - New project;
      - the Overview folded in.

      **Met** (`all-projects-page.test.tsx`, `all-projects.test.tsx`, e2e).

   7. ⌘K palette: projects, pages, tickets by key, New ticket and New project; dialog role, Tab
      kept in the dialog, Esc, focus returned: **met** (`palette.test.tsx`, e2e).
   8. Visual refresh and DESIGN.md: **met**. Tokens and shared components are updated, and feature
      pages are not rewritten.
   9. Screenshots: **met.** Light and dark at 1440 and 1024 for All projects, the board, the ticket
      page and the palette open, plus the collapsed sidebar at 1280. I reviewed them with Read.
      Fixes from the review:
      - project cards label agent runs apart from sessions;
      - the palette uses the Data health icon;
      - the ticket fixtures' project is named in the switcher.
5. **Assumptions** (all recorded in DESIGN.md):
   - `#/` uses only the last project; otherwise it opens All projects.
   - The other legacy addresses with no project (`#/board`, `#/usage`, `#/sessions`, `#/control`
     and `#/control/new`) use the last project, else the first, else All projects.
   - A Phase 3 run without a ticket keeps its ControlPanel view at `#/p/:projectId/runs/:runId`
     (accepted by the coordinator).
   - Setup's page title is now "Connection".
   - The palette's ticket search covers the current project's board only.
6. **Contract or shared-file changes needed:** none.
   - `RunSummaryDto.ticketId` (decision D) is on main and used.
   - `e2e/playwright.config.ts` gained one project, `shell`.
7. **Known gaps and follow-ups:**
   - The board header's own project select is a duplicate (R-H).
   - `features/project/ProjectPage.tsx` and `features/ticket/redirect.tsx` are unused (R-H).
   - Tokens is the old usage page until R-F, and its default "group by project" is redundant
     inside a project.
   - The palette has no "Run checks" action yet; it comes with the Harness page (R-E).
   - In demo mode the server refuses ticket writes, so the shell e2e serves the demo board with
     synthetic tickets through `page.route`.
8. **Next recommended task:** merge R-A. Then R-E and R-F (they plug into `PROJECT_PAGES`) and
   R-D's Skills page, then R-H to simplify the board and ticket pages in the new shell.
