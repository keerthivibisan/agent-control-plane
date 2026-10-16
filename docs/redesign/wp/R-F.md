# R-F — Tokens: query, route, page

> Progress file for R-F. Only the agent working on R-F edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value            |
| ------- | ---------------- |
| Status  | in-progress      |
| Owner   | full-stack agent |
| Branch  | `wp/r-f-tokens`  |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                          | Commit       | Checks                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------- |
| 2026-10-16 | Claimed R-F on `wp/r-f-tokens`.                                                                                                                                                                                                        | claim        | —                                                    |
| 2026-10-16 | db: `createTokenQueries().projectTokens()` (`queries/tokens.ts`), exported from `@acp/db`; 9 temp-file DB tests.                                                                                                                       | db query     | format ✓ lint ✓ typecheck ✓ test 1728/1728 ✓ build ✓ |
| 2026-10-16 | server: `TokensService` (`src/tokens/service.ts`) and `GET /api/projects/:id/tokens` (`routes/tokens.ts`); 4 supertest tests over the real pipeline. Registration in `app.ts`/`bootstrap.ts` is a separate commit for the coordinator. | server route | format ✓ lint ✓ typecheck ✓ test 1732/1732 ✓ build ✓ |
| 2026-10-16 | web: Tokens page in `features/tokens/**`, api/copy sections, plugged into `ProjectScreen`. WIP: no tests yet; paused by the owner.                                                                                                     | wip(web)     | not run (web typecheck ✓, eslint ✓)                  |

## Handoff notes

**Paused (2026-10-16, owner pause).** Status stays `in-progress`.

Done and checked (pnpm check green at each commit): the db query
(`packages/db/src/queries/tokens.ts`, 9 tests), the service and route
(`packages/server/src/tokens/service.ts`, `routes/tokens.ts`, 4 supertest tests), and the router
registration in `app.ts`/`bootstrap.ts` (separate commit, for the coordinator).

Done but unchecked (the `wip(web)` commit): `features/tokens/**` (TokensPage, TokenTiles,
TokensChart, TokensBreakdown, RangeControl, Segmented, figures, tokens-params), the R-F sections at
the end of `lib/api.ts` and `lib/copy.ts`, and the `tokens` case in `App.tsx` now renders
`TokensPage`. Web typecheck and eslint pass on these files.

Next steps, in order:

1. `pnpm --filter @acp/web test`: update `tests/features/project.test.tsx` ('routes
   #/p/:projectId/tokens…'), which still expects `/api/usage/summary`. Point it at
   `/api/projects/p-1/tokens` with a fixture `ProjectTokensDto`.
2. Add `tests/features/tokens.test.tsx` with fixture DTOs: the tiles (null reads "Not reported",
   partial mark, the share sentence), the charts and day table, the undated note, all four
   breakdowns (cost column labelled "estimated (provider-reported)", no total row, `external` role
   word, unknown model), the range control writing `range`/`from`/`to`/`by` to the hash, and
   `tokens-params` unit tests (presets, swapped custom days, exclusive `to`).
3. Rewrite the Tokens test in `e2e/demo.spec.ts` to compare the page with
   `/api/projects/:id/tokens` (the demo server now serves it). Add `e2e/tokens.spec.ts` plus a
   `tokens` project in `e2e/playwright.config.ts`, with `page.route` fixtures and screenshots at 1440
   and 1024 in light and dark. Run with `ACP_E2E_PORT=8051 ACP_E2E_CONTROL_PORT=8061`, then look at
   the screenshots with Read.
4. Then `pnpm check`, squash or replace the wip commit with a proper `feat(web)` commit, update
   DESIGN.md's Tokens route row, and write the completion report.

Open points:

- `features/usage/**` (the interim page) has no users after this change except its own tests. It
  should be removed, but it is not in R-F's owned paths, so that is the coordinator's call.
- The dataviz validator fails the dark-mode lightness band for the shared `--color-token-*` dark
  values in `index.css` (R-A's file). Contrast and CVD separation pass, and the second line is
  dashed. Reported here, not changed.
- The DTO has no `ambiguousAttributionCount` and no aggregate usage per session. The page links
  each session to its detail page, which shows both.

Decisions (also in the code comments):

- A session belongs to the agent run whose `agent_run_sessions` link names its provider session.
  That includes Claude Code's own helper sessions inside the same provider session. The earliest
  link wins, so a retry link never moves a session. A session with no link is `external`.
- Project scope is the sessions with `project_id` = P, plus unassigned sessions whose owning run
  belongs to P.
- With a range: usage records are filtered by `occurredAt` (from inclusive, to exclusive; undated
  records are excluded). A session is counted when its observed lifetime overlaps the range or when
  it has usage in the range. A run is counted when it was open at any time in the range. The cost is
  the latest snapshot before `to`.
- `byTicket` lists tickets with a run in the range, even with no observed usage (then all
  categories are null). The other breakdowns list only groups with usage. Records with no model
  are grouped under the key `unknown`.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
