# R-A — Shell, navigation, visual system

> Progress file for R-A. Only the agent working on R-A edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value                |
| ------- | -------------------- |
| Status  | in-progress (paused) |
| Owner   | frontend agent       |
| Branch  | `wp/r-a-shell`       |
| Started | 2026-10-16           |
| Updated | 2026-10-16           |

## Work log (append-only; newest last)

| Date       | What was done                                                                                                    | Commit    | Checks                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | --------- | -------------------------- |
| 2026-10-16 | Claimed R-A on `wp/r-a-shell`                                                                                    | `70842ec` | docs only                  |
| 2026-10-16 | WIP: shell, routes, redirects, palette, All projects, visual tokens and shared components (tests partly updated) | `5dae320` | not run (WIP, not checked) |
| 2026-10-16 | Paused by the owner; handoff note below                                                                          | (this)    | docs only                  |

## Handoff notes

### Paused (2026-10-16)

**Done (in `5dae320`, WIP, `pnpm check` not run):**

- `src/lib/router.ts`: new `Route` union. `#/p/:projectId/{board,workflow,skills,harness,tokens,sessions,settings}`,
  `…/skills/:name`, `…/tickets/:ticketId`, `…/runs/:runId` (Phase 3 runs without a ticket keep the
  ControlPanel view; `runs/new` is the old start page), `#/projects`, `#/projects/new`, `#/health`,
  `#/health/connection` (old Setup), `#/sessions/:id`. Every old address parses to `{ name: 'legacy' }`.
  `href` helpers keep their names but point to the new routes; `href.ticket(ticket)` and
  `href.run(run)` now take `{ id, projectId }` (call sites in board/TicketCard, project-setup/HarnessPanel,
  control/StartRun, control/RunList updated). `href.sessions`/`href.usage` move `projectId` into the path.
- `src/app/redirects.ts` (pure `planRedirect`, `runTarget`) and `src/app/Redirect.tsx` (fetches the
  ticket or run when needed, then `replaceHash`). `#/` → last project's board, else All projects.
- `src/app/project-pages.ts`: `PROJECT_PAGES` with `available` flags (workflow/skills/harness false).
- `src/app/Shell.tsx` (top bar: mark, `ProjectSwitcher`, ⌘K button, theme toggle; sidebar from
  `PROJECT_PAGES`, then All projects / Data health; collapses to icons at ≤1280px via the new `wide:`
  breakpoint = 1281px; connection + server status in the sidebar footer), `ProjectSwitcher.tsx`,
  `HealthScreen.tsx` (Overview | Connection tabs), `last-project.ts` (key `acp.lastProject`, falls
  back to the board's `acp.board.lastProject`; try/catch).
- `src/features/palette/{commands.ts,CommandPalette.tsx}`: ⌘K/Ctrl+K, combobox + listbox, Esc,
  focus kept on the input, focus returned; New ticket opens the board's `NewTicketDialog` and then
  navigates to the new ticket; New project; pages; projects; tickets by key from `GET /api/board`.
- `src/features/all-projects/**`: `AllProjectsPage` (cards: name, folder, harness pill, running /
  needs-you from the board, active sessions, last activity) + `AcrossProjects` (the former Overview,
  moved from `features/command-center` with `git mv`; `features/projects/ProjectsList` became
  `project-bits.tsx`).
- `src/index.css` tokens refreshed (neutral surfaces, softer shadows incl. `shadow-raised`,
  `text-section`, `topbar` spacing, `wide` breakpoint); shared components restyled: Button (sizes,
  `danger`), PageHeader (optional description, `tip`) + new `SectionHeader`, Card (24px padding),
  EmptyState (illustration), DataTable, StatCard, Tooltip, DemoBanner (sticky under the top bar);
  new `Pill.tsx`, `Input.tsx`; new icons in `components/icons.tsx`.
- `copy.ts`: add-only `SHELL_COPY`, `ALL_PROJECTS_COPY`, `PALETTE_COPY`; `PAGES.setup.title` is now
  "Connection".
- Tests: new `tests/lib/router.test.ts`, `tests/app/redirects.test.ts`; `tests/features/all-projects.test.tsx`
  (moved from command-center) adapted; board-logic and project tests fixed for the new helpers.

**Left (exact next steps):**

1. Run `pnpm --filter @acp/web test` and fix the suites still asserting old routes/nav:
   `tests/app/shell.test.tsx` (rewrite for the new top bar/sidebar, All projects at `#/projects`,
   Connection at `#/health/connection`, not-found links to `#/projects`), `features/board.test.tsx`
   (`#/board` redirect, sidebar order), `features/ticket.test.tsx` (route parse + `#/control`
   redirects now in redirects.test), `features/control-logic.test.ts` / `control.test.tsx`
   (`#/control/:id` → `href.run`), `features/project-setup*.test*` (`#/board/:id` →
   `#/p/:id/board`, `#/projects/:id/settings` → `#/p/:id/settings`, ticket link), `usage.test.tsx`,
   `explorer.test.tsx`, `session-detail.test.tsx`, `setup.test.tsx` (heading "Connection"),
   `components/foundation.test.tsx` if PageHeader/EmptyState markup assertions changed.
2. Add tests: `ProjectSwitcher` (remembers last project, keeps the page when switching, Esc),
   `CommandPalette` (filter, ticket by key, arrows/Enter, Esc, Tab stays, New ticket), All projects
   page (cards from board stats, empty state).
3. Run `pnpm check` (format, lint — watch react-hooks `set-state-in-effect` on
   `ProjectSwitcher`'s close-on-route effect — typecheck incl. e2e tsconfig, build). Commit.
4. Update `packages/web/DESIGN.md` (Layout, Visual system tokens, page header / card / table /
   empty state / buttons / inputs / pills / tooltips, `PROJECT_PAGES` plug-in rule for page WPs).
5. Update e2e for moved routes only: `demo.spec.ts` (Overview → `#/projects` "Across your
   projects"; Sessions/Tokens via `#/p/<demo-api>/sessions|tokens` and project-scoped API
   comparisons; project-page test → All projects card + Tokens/Sessions pages), `control.spec.ts`
   (`startRun` expects `#/p/[^/]+/runs/<id>`), `ticket.spec.ts` (open `#/p/p-web/tickets/t-12`, plus
   a legacy `#/tickets/t-12` redirect check). Add an R-A screenshot spec (All projects, board,
   ticket, palette open, collapsed sidebar; light/dark at 1440/1024; `ACP_SCREENSHOT_DIR`). Run
   with `ACP_E2E_PORT=7751 ACP_E2E_CONTROL_PORT=7761`; look at the screenshots.
6. Rebase on main (coordinator: main is at `d2377c2`; keep main's `registerProject` in `api.ts`).
7. Completion report; set `review`.

**Open problems / decisions to confirm:**

- `#/control/:runId` for a run without a ticket goes to `#/p/:projectId/runs/:runId` (the existing
  ControlPanel run view), not the board: otherwise Phase 3 runs (approvals, review, unmerged
  worktrees) would become unreachable and `control.spec.ts` could not keep its behaviour.
- A run's ticket is found through the board (`ticket.currentRunId`); an older run of a ticket opens
  its run page. Proposed contract change (not made): add `ticketId: string | null` to
  `RunSummaryDto` (`packages/core/src/api/orchestration.ts`) so the redirect is exact; affects
  server `control` routes and the web.
- `features/project/ProjectPage.tsx` (old `#/projects/:id`) is no longer routed; left for R-H to
  delete. `features/ticket/redirect.tsx` is now unused by App (its `RedirectTo` moved to
  `src/app/Redirect.tsx`).
- The board page still has its own project select in its header (R-H to remove).

## Blockers / proposed contract changes

- Proposed (optional): `RunSummaryDto.ticketId` (see above). Not blocking.

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
