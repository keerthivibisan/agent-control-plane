# R-E — Harness page

> Progress file for R-E. Only the agent working on R-E edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value            |
| ------- | ---------------- |
| Status  | review           |
| Owner   | frontend agent   |
| Branch  | `wp/r-e-harness` |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Work log (append-only; newest last)

Hashes are from after the last rebase on `main` (fa7ebfe).

| Date       | What was done                                                                                          | Commit    | Checks                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------- |
| 2026-10-16 | Claimed R-E on `wp/r-e-harness`                                                                        | `5a64f55` | docs only                                                  |
| 2026-10-16 | Harness page (status, checks, main-branch runs, Build the harness, where checks run), ⌘K Run checks    | `cffc41c` | format ✓ lint ✓ typecheck ✓ test 1735/1735 ✓ build ✓       |
| 2026-10-16 | e2e `harness.spec.ts` with screenshots; labelled harness-ticket notes, failed output open, empty state | `3352754` | check ✓ test 1736/1736 ✓; e2e harness 4/4 ✓ (before tweak) |
| 2026-10-16 | Paused by the owner; handoff note                                                                      | `518dd30` | docs only                                                  |
| 2026-10-16 | Resumed; rebased on main; e2e expects failed output open; full e2e and screenshots re-checked          | `317f2d3` | check ✓ test 1812/1812 ✓; e2e 24/24 ✓                      |
| 2026-10-16 | Completion report; status `review`                                                                     | (this)    | docs only                                                  |

## Handoff notes

### Paused (2026-10-16), resolved

Next steps 1 and 3 are done (see the work log). Step 2 (DESIGN.md's route table still says "Harness
(R-E; not available yet)") is left to the coordinator, because DESIGN.md is R-A's file.

### For the coordinator, R-G and R-H

- **History route (accepted, R-G adds it):** `GET /api/projects/:id/harness/checks` →
  `CheckRunDto[]`, newest first (diff below). When it lands, the web side:
  1. adds `projectSetupPaths.harnessHistory` and a `getHarnessHistory` in its own section of
     `lib/api.ts`;
  2. groups the rows into runs by `startedAt` closeness in `features/harness/RunsCard.tsx`, or uses a
     run id if the route gives one;
  3. drops the "Only runs started since you opened the app" ⓘ (`HARNESS_PAGE_COPY.runs.historyTip`)
     and the card's description.

  This session's in-memory attempts (`main-check-runs.ts`) can stay for the running state and the
  ⌘K action.

- **R-H:** the Settings page still has the old harness card (`project-setup/HarnessPanel.tsx`).
  Replace it with a link to `href.projectPage(id, 'harness')` once settings are simplified. The
  Harness page imports only `useSetupAction` from `project-setup/actions.ts`, so moving that hook to
  `src/lib/` or `components/` would be welcome. That move is proposed, not made.
- **Merge conflicts to expect:** `app/project-pages.ts`, `App.tsx` `ProjectScreen`, the palette
  test's expected page list, and the shell test's "pages not built yet" loop. Each page WP flips its
  own line.

## Blockers / proposed contract changes

**History of past main-branch runs: accepted by the coordinator, and R-G adds it.** The db already has
`checkRuns.listForProjectMain(projectId, { limit })`, newest first. This is server only, with no core
change, because the existing `CheckRunDto[]` is reused:

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

Until it lands, the page says that older runs can't be listed yet.

## Completion report (AGENTS.md §9)

## Completion report — R-E

1. **Summary:** the Harness page at `#/p/:projectId/harness` (docs/redesign/README.md §4.4). It
   shows:
   - the status, with its problems in plain sentences;
   - the checks;
   - "Run checks now" on the main branch, with each result and this session's history;
   - "Build the harness", with the ticket and its stage;
   - where the checks run;
   - the four P4-H behaviours as ⓘ tips.

   The ⌘K palette gets one "Run checks" action.

2. **Files changed** (all under `packages/web/` unless noted):
   - Created:
     - `src/features/harness/{HarnessPage,StatusCard,ChecksCard,RunsCard,UsageCard}.tsx`;
     - `src/features/harness/{logic,main-check-runs}.ts`;
     - `tests/features/harness.test.tsx`, `tests/features/harness-logic.test.ts`;
     - `e2e/harness.spec.ts`.
   - Modified:
     - `src/app/project-pages.ts`: Harness `available: true`;
     - `src/app/App.tsx`: the `harness` case;
     - `src/features/palette/{commands.ts,CommandPalette.tsx}`: the add-only `run-checks` action;
     - `src/lib/copy.ts`: the add-only `HARNESS_PAGE_COPY` and `formatSeconds`;
     - `e2e/playwright.config.ts`: the `harness` project;
     - `tests/app/shell.test.tsx` and `tests/features/palette.test.tsx`: the page and action are now
       available;
     - `docs/redesign/wp/R-E.md`.
   - Not changed: `src/lib/api.ts`. The existing harness, ticket and board calls are reused.
     Nothing in `features/project-setup/**` was edited.
3. **Commands run and actual results** (root, Node 22.21.1, pnpm 10.26.1, rebased on `cf2f5ab`;
   `fa7ebfe` on main since then changes only `docs/redesign/STATUS.md`):
   - `pnpm check`: format ✓, lint ✓, typecheck ✓, build ✓.
   - Tests: 1812/1812 passed (core 246, demo 12, orchestrator 424, claude-code 283, db 153, web 371,
     server 323).
   - `ACP_E2E_PORT=8151 ACP_E2E_CONTROL_PORT=8161 ACP_SCREENSHOT_DIR=… pnpm --filter @acp/web test:e2e`:
     24/24 passed (demo 7, ticket 4, shell 5, harness 4, control 4).
   - After the last e2e assertion change, the harness project was re-run alone: 4/4 passed.
4. **Acceptance criteria:**
   1. Status card with No harness yet / Invalid / Partial / Ready, and the problems in plain
      sentences: **met** (component tests for ready, none and invalid; e2e for invalid).
   2. Check list with name, argv as code, folder, time limit, and required or optional: **met**
      (component test on the table rows; e2e on a multi-word argv and a `cwd`).
   3. Run checks now on main, with each result's output tail, duration and exit status: **met**
      (component test; e2e). A failed check's output opens by default.
   4. History: **partly met.** This session's runs are shown, and the page says so. The route for
      older runs is accepted, and R-G will add it.
   5. "Build the harness" creates the ticket and links to it via `href.ticket`. An existing ticket
      shows its stage: **met** (component tests for create, existing and stage; e2e).
   6. Where checks are used (on entering review, on demand, required checks block a plain merge,
      "merge anyway" needs a reason): **met** (component test).
   7. The P4-H behaviours as ⓘ tips (component tests read each tip's text):
      - the harness ticket's review runs no checks: **met**. A labelled note, shown only while the
        project has no runnable checks;
      - the `checks_running` race: **met**. An ⓘ on the review line, and a plain sentence for a 409
        on this page;
      - the ~10 s status delay: **met**. An ⓘ by "Read from the repository", plus "Check again";
      - a new folder asks even with auto-approve: **met**. A labelled note on the ticket, and an ⓘ
        by the build button.
   8. ⌘K "Run checks": **met** (App-level component test; e2e from another page).
   9. Screenshots in light and dark at 1440 and 1024 (ready with results, none, a ticket at work,
      invalid): **met.** I reviewed them with Read. Fixes from the review:
      - bare ⓘ icons became labelled notes;
      - the empty state now has one sentence;
      - a failed check's output is open.

      After the resume, the shots show the ticket row's two notes on their own line and a clean
      empty state in both themes.
5. **Assumptions** (recorded under "Decisions made" in the Paused note above, and in code comments):
   - The harness ticket is the newest ticket of type `harness` that is not cancelled. "Build" is
     offered only for state `none` with no open ticket.
   - Runs live in memory, one store per `QueryStore`. The ⌘K action and the page share it.
   - The Checks card is hidden for an invalid manifest with no checks. The Runs card shows only
     when checks can run, or once runs exist.
6. **Contract or shared-file changes needed:**
   - The history route above. It is accepted, and R-G adds it.
   - Proposed: moving `useSetupAction` out of `features/project-setup`.
   - DESIGN.md's route table should mark Harness as available. That file is R-A's, so this is left
     to the coordinator.
7. **Known gaps and follow-ups:**
   - Past main-branch runs aren't listed until the route lands.
   - Settings still shows the old harness card (R-H).
   - The "Where checks run" card links to the Workflow page only once that page is available.
8. **Next recommended task:** switch `RunsCard` to the history route once R-G lands it. Then R-H
   replaces the Settings harness card with a link to this page.
