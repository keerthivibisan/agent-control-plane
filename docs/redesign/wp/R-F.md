# R-F — Tokens: query, route, page

> Progress file for R-F. Only the agent working on R-F edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value            |
| ------- | ---------------- |
| Status  | review           |
| Owner   | full-stack agent |
| Branch  | `wp/r-f-tokens`  |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                        | Commit       | Checks                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| 2026-10-16 | Claimed R-F on `wp/r-f-tokens`.                                                                                                                                                                                                                      | claim        | —                                                                 |
| 2026-10-16 | db: `createTokenQueries().projectTokens()` (`queries/tokens.ts`), exported from `@acp/db`; 9 temp-file DB tests.                                                                                                                                     | db query     | format ✓ lint ✓ typecheck ✓ test 1728/1728 ✓ build ✓              |
| 2026-10-16 | server: `TokensService` (`src/tokens/service.ts`) and `GET /api/projects/:id/tokens` (`routes/tokens.ts`); 4 supertest tests over the real pipeline. Registration in `app.ts`/`bootstrap.ts` is a separate commit for the coordinator.               | server route | format ✓ lint ✓ typecheck ✓ test 1732/1732 ✓ build ✓              |
| 2026-10-16 | web: Tokens page in `features/tokens/**`, api/copy sections, plugged into `ProjectScreen`. WIP: no tests yet; paused by the owner.                                                                                                                   | wip(web)     | not run (web typecheck ✓, eslint ✓)                               |
| 2026-10-16 | Resumed; rebased on main (817d61c, conflicts with R-E kept both sides). web: component tests, `project.test.tsx` and demo e2e updated, `e2e/tokens.spec.ts` with screenshots; layout fixes from the screenshots; DESIGN.md Tokens row. Set `review`. | feat(web)    | format ✓ lint ✓ typecheck ✓ test 1842/1842 ✓ build ✓; e2e 27/27 ✓ |

## Handoff notes

Resumed after the owner's pause and finished; the Paused note's steps are done.

Decisions (also in the code comments):

- A session belongs to the agent run whose `agent_run_sessions` link names its provider session.
  That includes Claude Code's own helper sessions inside the same provider session. The earliest
  link wins, so a retry link never moves a session to another role or ticket. A session with no
  link is `external` ("Outside the app").
- Project scope is the sessions with `project_id` = P, plus unassigned sessions whose owning run
  belongs to P.
- With a range: usage records are filtered by `occurredAt` (from inclusive, to exclusive; undated
  records are excluded). A session counts when its observed lifetime overlaps the range or it has
  usage in the range. A run counts when it was open at any time in the range. The session cost is
  the latest snapshot before `to`.
- `byTicket` lists tickets with a run in the range even with no observed usage (all categories
  null, shown as "Not reported"). The other breakdowns list only groups with usage. Records with
  no model use the key `unknown` ("Unknown model").
- The page: cache read and write share one column, and the cache share sits under the total, so
  the session table keeps its cost column in view at 1024px. The range control has its own row
  under the header.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

## Completion report — R-F

1. **Summary:** the project Tokens page from end to end. `projectTokens()` in `@acp/db`,
   `GET /api/projects/:id/tokens` (`ProjectTokensDto`), and `features/tokens/**`: five headline
   tiles, separate new-work and cache charts with a day table, breakdowns by session, ticket,
   agent role and model, and a date range kept in the address.
2. **Files changed:**
   - created: `packages/db/src/queries/tokens.ts`, `packages/db/tests/tokens.test.ts`,
     `packages/server/src/tokens/service.ts`, `packages/server/src/routes/tokens.ts`,
     `packages/server/tests/tokens/routes.test.ts`, `packages/web/src/features/tokens/`
     (`TokensPage`, `TokenTiles`, `TokensChart`, `TokensBreakdown`, `RangeControl`, `Segmented`,
     `figures`, `tokens-params`), `packages/web/tests/features/tokens.test.tsx`,
     `packages/web/tests/fixtures/tokens.ts`, `packages/web/e2e/tokens.spec.ts`;
   - modified: `packages/db/src/index.ts` (one export); `packages/server/src/app.ts` and
     `bootstrap.ts` (router registration, a separate commit for the coordinator);
     `packages/web/src/lib/api.ts` and `lib/copy.ts` (add-only R-F sections);
     `src/app/App.tsx` (`tokens` case) and `src/app/project-pages.ts` (comment);
     `tests/features/project.test.tsx`, `e2e/demo.spec.ts` (Tokens tests rewritten for the new
     page and route), `e2e/playwright.config.ts` (`tokens` project), `DESIGN.md` (Tokens route
     row); this file.
3. **Commands run and actual results** (after rebasing on main 817d61c):
   - `pnpm check`: format ✓, lint ✓, typecheck ✓, test 1842 passed (core 246, demo 12,
     orchestrator 424, claude-code 283, db 162, web 388, server 327), build ✓;
   - `ACP_E2E_PORT=8051 ACP_E2E_CONTROL_PORT=8061 pnpm --filter @acp/web test:e2e`: 27 passed.
4. **Acceptance criteria:**
   - db query with sessions, runs, tickets with runs, null-preserving totals with
     `recordsWithUnavailable`, and byDay, bySession (with title and latest cost), byTicket,
     byRole, byModel, each with `tokenHeadline()`: met (`tokens.test.ts`, 9 tests: null stays
     null, a fork-shared message counts once, lead/worker/reviewer vs external, a retry link,
     range filters, bad range, unknown project).
   - Route parsed by `ProjectTokensDtoSchema`, 404 for an unknown project, 400 for a bad range:
     met (`routes.test.ts`, 4 tests through the real pipeline).
   - Tiles: Sessions, Agent runs, New work, Total processed, and Cache reuse share with its
     sentence: met (component tests and screenshots).
   - Two separate charts: met. A day table and an undated-records note are added.
   - Breakdown tables with direct usage and "Not reported" / "Partial": met.
   - Cost column labelled "estimated (provider-reported)", never totalled: met.
   - Date range control and provenance badges: met.
   - Fixture-DTO component tests: met (17 in `tokens.test.tsx`, plus the routing test).
   - Playwright with `page.route` fixtures: met (`tokens.spec.ts`, 3 tests). The demo spec
     compares the page with the real route.
   - Screenshots in light and dark at 1440 and 1024, looked at: met. They led to two layout
     fixes: the cost column overflowed at 1024, and a custom range squeezed the title.
5. **Assumptions:** see the decisions under Handoff notes (role and ticket attribution, project
   scope, range semantics, the `unknown` model key). They are also commented in
   `queries/tokens.ts` and `tokens/service.ts`.
6. **Contract or shared-file changes needed (proposed, not made):**
   - `ProjectTokensDto` has no `ambiguousAttributionCount` and no per-session aggregate usage.
     §4.5 asks for direct and aggregate side by side. Today each session links to its detail
     page, which shows both. Adding `ambiguousAttributionCount` per session row, and in totals,
     would let the page flag fork-shared records. That needs an `@acp/core/api` change by R-0.
   - None otherwise. The router registration in R-G's files is its own commit.
7. **Known gaps and follow-ups:**
   - `features/usage/**` (the interim page) is unused now except by its own tests. The
     coordinator removes it after the merge.
   - The dataviz palette validator fails the dark-mode lightness band for the shared
     `--color-token-*` dark values in `index.css` (R-A's file). Contrast and colour-blind
     separation pass, and the second series is dashed.
   - Between 1024 and about 1100px the table is close to full width. It scrolls inside its card
     if a long model name or title ever needs more room.
8. **Next recommended task:** coordinator review and merge of `wp/r-f-tokens`, including commit
   `chore(server): register the tokens router`. Then remove `features/usage/**`.
