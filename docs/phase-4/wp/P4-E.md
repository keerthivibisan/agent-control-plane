# P4-E — Board UI

> Progress file for P4-E. Only the agent working on P4-E edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Status  | review                                                 |
| Owner   | frontend agent                                         |
| Branch  | `wp/p4-e-board` (create from `main` when you claim it) |
| Started | 2026-10-13                                             |
| Updated | 2026-10-15                                             |

## Tasks

- [x] Route #/board and #/board/:projectId; nav entry 'Board' first
- [x] Project switcher and header stats (token types never summed; estimated cost never summed)
- [x] Columns by stage(); cards (key, title, type, priority, labels, helpers, budget tokens, needs-you badge)
- [x] Native HTML5 drag and drop + keyboard Move menu; only owner-settable moves
- [x] New ticket dialog; empty states
- [x] Fixture-DTO tests; screenshots light/dark at 1440 and 1024; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                | Commit        | Checks                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-13 | Claimed; branch `wp/p4-e-board` created from `main`                                                                                                                                          | (this commit) | —                                                                                                                          |
| 2026-10-13 | WIP checkpoint after a usage-limit interruption: board routes, client functions (api.ts), board copy, move rules, dialog, new-ticket dialog, move menu, icons. Board page not wired yet      | (this commit) | WIP: pnpm check not run yet                                                                                                |
| 2026-10-15 | Board wired (App/Shell, Board first in nav); board page, columns, stats, cards, Move menu, DnD, dialogs; fixture-DTO tests (board.test.tsx, board-logic.test.ts)                             | (this commit) | format ✓ lint ✓ typecheck ✓ test 1396/1396 (web 255) ✓ build ✓                                                             |
| 2026-10-15 | Screenshot polish (page no longer scrolls sideways; cost on its own card line); rebased on `main`; fixture-backed screenshots light/dark at 1440 and 1024 (temporary harness, not committed) | (this commit) | format ✓ lint ✓ typecheck ✓ test 1411/1411 (web 255) ✓ build ✓; e2e 11/11 ✓ (ACP_E2E_PORT=7501, ACP_E2E_CONTROL_PORT=7511) |

## Handoff notes

- **Client functions** (add-only section "Board" in `packages/web/src/lib/api.ts`): `boardPaths`
  (`board(projectId)` → `GET /api/board?projectId=`, `tickets(projectId)` →
  `/api/projects/:id/tickets`, `move(id)`, `start(id)`), `boardSchemas` (`board: BoardDtoSchema`,
  `tickets: TicketCardDto[]`), `createTicket` (POST tickets → `TicketDto`), `moveTicket` (POST move,
  body checked with `MoveTicketRequestSchema` → `TicketDto`), `startTicket` (POST start →
  `TicketDetailDto`), `isBoardPath`. Every mutation goes through `controlPost` (CSRF header, one
  retry on 403) and request bodies are checked with the core request schema first.
- **P4-D:** the board expects the §6.3 shapes exactly. A `404` from `GET /api/board` shows "Project
  not found". Live updates already work: any `tickets-changed`/`runs-changed` notice refetches the
  board (`affectedBy` treats unknown kinds as "refetch all but health").
- **P4-F / coordinator:** the board links to `#/projects/:id/settings` (Setup button) and
  `#/projects/new` (New project, and the no-projects empty state) as plain hashes in
  `features/board/BoardPage.tsx`; switch them to P4-F's `href` helpers after both merge.
- **P4-G:** cards link to `href.ticket(id)` = `#/tickets/:id`, added to `router.ts` `href` by this WP
  (the route itself is P4-G's). If P4-G adds its own `href.ticket`, keep one.
- `lib/copy.ts` Board section has its own `import type` from `@acp/core` (hoisted) so the section
  stays append-only; the coordinator may merge it into the top import.
- The "Control panel" nav entry is still there; P4-G folds it into the ticket page.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

1. **Summary:** the board (`#/board`, `#/board/:projectId`) is built against the P4-0 DTOs and
   fixture data: project switcher, header stats, columns by stage, cards, drag and drop plus a
   keyboard Move menu, the New ticket dialog and empty states. Board is first in the sidebar.
2. **Files:**
   - created `packages/web/src/features/board/{BoardPage,BoardColumns,BoardStats,TicketCard,MoveMenu,NewTicketDialog,Dialog,icons}.tsx`,
     `{moves,last-project,actions}.ts`; `packages/web/tests/features/{board.test.tsx,board-logic.test.ts}`,
     `packages/web/tests/fixtures/board.ts`;
   - modified (add-only) `packages/web/src/lib/{api,copy,router}.ts`, `packages/web/src/app/{App,Shell}.tsx`;
     this progress file.
3. **Checks (2026-10-15, after rebasing on `main`):** `pnpm check`: format ✓ lint ✓ typecheck ✓
   test 1411/1411 ✓ (core 233, orchestrator 308, demo 12, claude-code 267, db 117, web 255, server 219) build ✓. `pnpm --filter @acp/web test:e2e` with `ACP_E2E_PORT=7501 ACP_E2E_CONTROL_PORT=7511`:
   11/11 ✓. Earlier vitest runs hit worker-start timeouts under heavy machine load (Defender and
   other agents); reruns passed with no code change.
4. **Acceptance (README §8, P4-E):**
   - project switcher: met (select, `#/board` opens the last used project, else the first; tests);
   - header stats: met (harness badge, running and needs-you counts, the 4 token types side by side,
     no summed total and no board-wide cost; a test checks the sum never appears);
   - columns by stage: met (all 9 stages in order; Cancelled folded by default and still a drop
     target; each empty column explains itself);
   - cards: met (key, type icon and word, priority bars and word, labels, helpers, budget tokens,
     needs-you badge, the latest run's estimated cost or "Cost not reported", last-run outcome, last
     activity; title links to `#/tickets/:id`);
   - native drag and drop + keyboard Move menu, owner-settable moves only: met (Backlog ↔ Ready,
     Ready → Planning starts a run, open → Cancelled with a confirmation; Done/Cancelled have no
     moves; refused columns dim and don't accept drops; arrow keys, Home/End, Escape; tests);
   - New ticket dialog: met (validation in sentences, labels parsed, CSRF header; focus trap, Escape,
     focus returns; tests);
   - empty states: met (no projects, no tickets, project not found);
   - fixture-DTO tests: met (29 tests across the two files; fixtures parse with the core schemas);
   - screenshots light/dark at 1440 and 1024: met, reviewed; fixes made from them (sideways page
     scroll, truncated card footer, stray divider).
5. **Assumptions:** Done tickets cannot be cancelled from the board ("any → Cancelled" read as any
   open ticket); starting from Ready needs no confirmation (only cancel asks); the header shows no
   cost number because `BoardDto.stats` has none and summing per-run costs is forbidden; when
   `lastActivityAt` is null the card shows "Updated" with the ticket's `updatedAt`.
6. **Contract changes:** none.
7. **Gaps / follow-ups:** the server routes (P4-D) don't exist yet, so the board was exercised only
   against fixtures (unit tests and a temporary Playwright harness); a committed e2e of the board
   belongs to P4-H. The P4-F links noted above.
8. **Next:** P4-D (server routes), then P4-H's end-to-end flow through the board.
