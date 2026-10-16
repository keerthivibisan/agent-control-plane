# R-H — Board, ticket and settings simplification

> Progress file for R-H. Only the agent working on R-H edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value           |
| ------- | --------------- |
| Status  | in-progress     |
| Owner   | frontend agent  |
| Branch  | `wp/r-h-polish` |
| Started | 2026-10-16      |
| Updated | 2026-10-16      |

## Tasks

- [x] 1. Board: no own project select; header = project name, live line, New ticket; tokens and
      harness moved off (links)
- [ ] 2. Ticket page: live workflow graph, Continue, reviewer comments, new role labels, planner
      chat label, one plan-review word
- [x] 3. Settings: harness card → link; limits and allowlist → one line linking to Workflow
- [x] 4. Harness RunsCard on `GET /api/projects/:id/harness/checks`, grouped into runs
- [x] 5. Workflow Helpers panel: one description
- [x] 6. Remove `features/usage/**`, `features/project/ProjectPage.tsx`, `features/ticket/redirect.tsx`
- [ ] 7. Visual consistency (R-A page header, cards, empty states)
- [ ] 8. Screenshots (board, ticket states, settings; light/dark; 1440/1024)

## Work log (append-only; newest last)

| Date       | What was done                                                                                  | Commit    | Checks                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| 2026-10-16 | Claimed R-H on `wp/r-h-polish`                                                                 | `ac7deb9` | docs only                                                    |
| 2026-10-16 | Board header, settings simplified, unused usage/project/redirect code removed                  | `c34d344` | web only: format ✓ lint ✓ typecheck ✓ test 414/414 ✓ build ✓ |
| 2026-10-16 | Harness RunsCard on the history route (grouped into runs); Workflow Helpers panel one sentence | (this)    | pnpm check ✓: test 1,935/1,935 (web 419)                     |

## Handoff notes

### Decisions made (within the spec)

- **Board header:** the R-A `PageHeader` with "Board" as the eyebrow, the project name as the title
  (README §4.1) and the live line as its one line. Tokens and Harness are quiet links in the
  actions, next to New ticket. `BoardPage` now takes the project id from the address only; the
  board's own `acp.board.lastProject` memory is removed (the shell remembers the project, and
  still reads that old key as a fallback).
- **Settings keeps the default model.** §4.7 moves limits and the allowlist to Workflow, but the
  Workflow page only uses the project's default model as a placeholder, so the field stays in
  Settings next to the board key. Settings saves the setup as saved now with only its own fields
  changed (board key, model, context files), so it never overwrites limits saved on Workflow.
- **Harness history grouping:** the history rows have no run id, so `groupMainRuns` starts a new
  run when a check repeats or after a pause of more than a minute after the previous check ended
  (checks of one run run back to back). A display grouping only. A run started on this page shows
  from the session store while it runs, when it is refused, and until the history is read again.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
