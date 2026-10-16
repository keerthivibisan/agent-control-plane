# R-E — Harness page

> Progress file for R-E. Only the agent working on R-E edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value            |
| ------- | ---------------- |
| Status  | in-progress      |
| Owner   | frontend agent   |
| Branch  | `wp/r-e-harness` |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Work log (append-only; newest last)

| Date       | What was done                                                                                          | Commit    | Checks                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------- |
| 2026-10-16 | Claimed R-E on `wp/r-e-harness`                                                                        | `10113ce` | docs only                                                  |
| 2026-10-16 | Harness page (status, checks, main-branch runs, Build the harness, where checks run), ⌘K Run checks    | `f0b127d` | format ✓ lint ✓ typecheck ✓ test 1735/1735 ✓ build ✓       |
| 2026-10-16 | e2e `harness.spec.ts` with screenshots; labelled harness-ticket notes, failed output open, empty state | `c293844` | check ✓ test 1736/1736 ✓; e2e harness 4/4 ✓ (before tweak) |
| 2026-10-16 | Paused by the owner; handoff note                                                                      | (this)    | docs only                                                  |

## Handoff notes

### Paused (2026-10-16)

**Done** (all committed, `pnpm check` green at `c293844`):

- `packages/web/src/features/harness/`: `HarnessPage.tsx`, `StatusCard.tsx`, `ChecksCard.tsx`,
  `RunsCard.tsx`, `UsageCard.tsx`, `logic.ts`, `main-check-runs.ts`.
- Plugged in: Harness `available: true` in `app/project-pages.ts`, and the `harness` case in
  `ProjectScreen` (`app/App.tsx`).
- ⌘K: one add-only `run-checks` action (`features/palette/commands.ts`, `CommandPalette.tsx`). It
  starts the run in the per-QueryStore `MainCheckRuns` store and opens the Harness page.
- `lib/copy.ts`: add-only `HARNESS_PAGE_COPY` and `formatSeconds`. `lib/api.ts` needed no change:
  the existing harness, ticket and board functions are reused.
- Tests: `tests/features/harness.test.tsx` (9) and `harness-logic.test.ts` (8). The shell and
  palette suites were updated for the new page and action.
- e2e: `e2e/harness.spec.ts`, plus a `harness` project in `e2e/playwright.config.ts`. It passed
  4/4 on ports 8151/8161. Screenshots for ready, none, ticket and invalid, in light and dark at
  1440 and 1024, were reviewed with Read. Fixes from that review are in `c293844`.

**Next steps:**

1. Re-run the e2e after the last UI tweak, then look at the `harness-ticket-*` and `harness-none-*`
   screenshots again:
   `ACP_E2E_PORT=8151 ACP_E2E_CONTROL_PORT=8161 ACP_SCREENSHOT_DIR=<dir> pnpm --filter @acp/web test:e2e`.
   The full run includes the other projects.
2. Add a short DESIGN.md route-table touch: "Harness (R-E)" is now available. This is an R-A-owned
   file, so leave it to the coordinator if it is not allowed.
3. Write the §9 completion report below, and set the status to `review`.

**Decisions made:**

- History shows only this app session's runs, and the card says so with an ⓘ. No route exists yet
  (see Blockers).
- The harness ticket is the newest ticket of type `harness` that is not cancelled. "Build the
  harness" is offered only for state `none` with no open harness ticket. A Done ticket doesn't
  block a new one.
- The "its review runs no checks" note shows only while the project has no runnable checks.
  P4-H: checks are read from the project folder, so the note is only true then.
- `GET /harness` is always fresh on the server. The 10 s cache affects the board and project cards.
  The ⓘ says so, and the page has "Check again".
- `checks_running` on main conflicts only with another main run. The review race
  (`checks_running` right after entering review) is explained on the "When a ticket's work enters
  review" line, because it happens on the ticket's "Run checks again".

## Blockers / proposed contract changes

**Blocked: history of past main-branch runs.** The db already has
`checkRuns.listForProjectMain(projectId, { limit })`, newest first, but no route exposes it.
Proposed for R-G or the coordinator (server only; no core change, because the existing
`CheckRunDto[]` is reused):

```diff
// packages/server/src/board/service.ts (BoardService)
+  mainCheckHistory(projectId: string, limit?: number): CheckRunDto[];
...
+    mainCheckHistory(projectId, limit = 50) {
+      project(projectId); // 404 for an unknown project
+      return ws.checkRuns.listForProjectMain(projectId, { limit });
+    },

// packages/server/src/routes/board.ts
+  router.get('/projects/:id/harness/checks', (req, res) => {
+    res.json(out(CheckRunListSchema, board.mainCheckHistory(param(req.params['id']))));
+  });
```

Once that lands, the web side adds `projectSetupPaths.harnessHistory` in its own section of `api.ts`
and groups the rows by start time in `RunsCard`. Until then, the card says older runs can't be listed
yet.

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
