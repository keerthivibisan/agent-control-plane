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

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
