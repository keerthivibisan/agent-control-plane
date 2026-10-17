# U-V — Verification and final polish

> Progress file for U-V. Only the agent working on U-V edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope: the U-V row in `docs/ui-refresh/README.md` and the
> follow-ups in the STATUS log; rules: `docs/ui-refresh/README.md`.

| Field   | Value           |
| ------- | --------------- |
| Status  | review          |
| Owner   | U-V agent       |
| Branch  | `wp/u-v-verify` |
| Started | 2026-10-17      |
| Updated | 2026-10-17      |

## Work log (append-only; newest last)

| Date       | What was done                                                                  | Commit    | Checks                                             |
| ---------- | ------------------------------------------------------------------------------ | --------- | -------------------------------------------------- |
| 2026-10-17 | Claimed U-V from `feature/ui-refresh` `f790fb3`                                | `209d652` | —                                                  |
| 2026-10-17 | Flakes: one request per query key; e2e drops routes before a test ends         | `b93ae68` | pnpm check 2232/2232; workspace 10/10, shell 90/90 |
| 2026-10-17 | Shared Menu `loop`, LinkTab, Dialog focus hand-off, board Dialog deleted, copy | `3c62fce` | pnpm check 2232/2232                               |
| 2026-10-17 | Square family tree, neutral bubbles, green Passed                              | `ee9f1eb` | pnpm check 2232/2232                               |
| 2026-10-17 | 390px: PageHeader stacking and five overflow fixes; narrow and motion e2e      | `39fa8fe` | pnpm check 2232/2232, e2e 54/54                    |
| 2026-10-17 | Keyboard: menu item focus ring, column Show/Hide focus; keyboard e2e           | `0020a2f` | web 611/611, U-V e2e 4/4                           |
| 2026-10-17 | DESIGN.md Layout and primitives; CHANGELOG `[Unreleased]`                      | `7c1168e` | format ✓                                           |
| 2026-10-17 | Rebased on `feature/ui-refresh` `64b54fd`; pnpm check; full e2e 3×; `review`   | this      | see the report below                               |

## The two flaky e2e tests (task 1)

**`workspace.spec` owner flow, "waiting for … Merge":** a real app bug (client side, with a server
race behind it).

- Reproduced 1 in 6 runs here. The failure trace shows three `GET /api/runs/:id/review` within
  20 ms: the first two aborted by the browser, the third answered **500**, and nothing after it.
  The page then showed "No changes recorded for this agent." and never a Merge button.
- Cause: several SSE notices arrive together; the query store aborted the in-flight request and
  started a new one per notice. An abort only stops the browser waiting; the server still runs
  every copy. Each `review` call stages the helper's worktree (`git add --all` in
  `workspace/manager.ts` `changes()`), so concurrent copies collide on the worktree's git index and
  one fails (a non-`WorkspaceError`, so a 500). No later notice came, so the review was never
  refetched.
- Fix (`src/lib/query-store.ts`): at most one request per key in flight. A notice during a request
  marks the key stale and it is fetched once more when the request ends (same freshness, no
  overlapping copies). Two unit tests.
- Proposed for the server owner (not changed, outside `packages/web`): serialize `changes()` and
  `merge()` per worktree in `packages/server/src/workspace/manager.ts`, since two browser tabs can
  still race:

  ```ts
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    queues.set(key, run);
    void run.finally(() => queues.get(key) === run && queues.delete(key));
    return run;
  }
  // changes(ws, o) { return serial(ws.path, async () => { …today's body… }); } (and merge)
  ```

  with a test that runs two `changes()` on one worktree at once. Also worth a follow-up: the
  ticket's Changes tab shows "No changes recorded" when the review request failed; it could show
  the error instead (a text/behaviour change, so not made here).

**`shell.spec` sidebar toggle, "apiResponse.json: Response has been disposed":** a test race.

- The test ends right after a reload, while the board's `page.route` handler is still inside
  `route.fetch()`; closing the page disposes the response and `.json()` throws (Playwright turns
  the target-closed error into "Response has been disposed"). `skills.spec` already had the fix.
- Fix: `test.afterEach(() => page.unrouteAll({ behavior: 'ignoreErrors' }))` in every spec with a
  `route.fetch()` handler (shell, harness, ticket, workflow; pages' U-V block too).

**Evidence:** workspace.spec 10/10 in ten separate runs with fresh servers and screenshots on
(`--repeat-each` cannot rerun it on one server: the flow creates the `shop` repository, so a second
iteration fails on "already exists"); `shell.spec --repeat-each=10` 90/90; full suite 3× (below).

## Bundle size (task 5)

`pnpm --filter @acp/web build`, v0.0.1 (tag `v0.0.1`, built in a scratch worktree) vs now:

| Asset                  | v0.0.1                  | Now                                           | Change               |
| ---------------------- | ----------------------- | --------------------------------------------- | -------------------- |
| JS                     | 1,294.48 kB (376.65 gz) | 1,588.12 kB (475.22 gz)                       | +293.6 kB (+98.6 gz) |
| CSS                    | 81.39 kB (14.33 gz)     | 101.46 kB (17.37 gz)                          | +20.1 kB (+3.0 gz)   |
| Fonts (woff2, latin)   | none (system font)      | 88.65 kB (Inter 48.25 + JetBrains Mono 40.40) | +88.65 kB            |
| Brand SVGs (`/brand/`) | none                    | 6.1 kB                                        | +6.1 kB              |

U-V itself adds about 1 kB of JS (1,587.13 → 1,588.12 kB). Measured with esbuild, the way the app
imports them (React external): **Motion ≈ 151 kB (52 kB gz)**, Radix dialog/menu/tabs/popover
≈ 110 kB (36 kB gz). Motion is half the JS growth. It is used in six files; five are fades and
small rises that CSS keyframes could do, but the board's card glide between columns (`layoutId`,
`layoutScroll`) is a layout animation CSS cannot do simply, so Motion stays as long as that glide
does. If size matters, the follow-up is `LazyMotion` with `m.*` components (domMax for the board),
or dropping the glide and moving the rest to CSS. Not done here (report, don't over-engineer).

## Accessibility and motion (task 4)

- **Keyboard:** menus (open with ArrowDown, arrows, Move menu wraps with the new `loop`, Escape
  back to the trigger), dialogs (focus in, trapped, Escape returns focus; palette → New ticket keeps
  focus and returns it to the palette's opener), tabs (arrows move and select), the sidebar toggle
  (Enter, focus kept on the toggle), board column Show/Hide (**fixed**: focus was lost to the page;
  it now moves to the button that replaced it).
- **Focus visible:** a 2px `accent` outline everywhere. **Fixed:** menu items (shared Menu and the
  project switcher) had `outline-none` and only a faint hover fill; they now take the ring, inset,
  on `:focus-visible`. e2e `focus-ring.ts` measures the ring against the surface behind it on ivory
  and graphite (≥ 3:1; e.g. olive `#4b5e00` on the ivory sidebar, lime on graphite).
- **Reduced motion:** e2e with `reducedMotion: 'reduce'`: no transform or fade on a page change, no
  slide on the side panel, dialog CSS animations at ~0 s. Motion's `reducedMotion="user"` keeps
  opacity fades by design; the page transition is skipped entirely, and CSS keyframes are cut.
- Note: `transition-colors` also animates `outline-color` (150 ms), so a ring fades in; harmless,
  but a screenshot taken at once can show it half-way.

## Narrow widths (task 2)

At 390 px (e2e `pages.spec` U-V, 13 pages, light and dark): PageHeader actions stack under the
title below `sm`; fixed the Sessions picker (page scrolled 100 px sideways), the Harness status
card's "Check again" (outside its card), the Tokens cost column (pushed out of view in stacked
rows), truncated token labels ("Input tok…"), a 16 px phone gutter, and the agent tree now opens
scrolled to its lead.

## Completion report (AGENTS.md §9) — U-V

1. **Summary:** fixed both flaky e2e tests at their root (a query-store request storm that raced
   the server's review staging; a route-handler race at test end), the narrow-width layout at
   390 px, the STATUS leftovers, keyboard focus gaps; recorded the bundle size; DESIGN.md Layout and
   CHANGELOG `[Unreleased]` updated.
2. **Files changed** (all under `packages/web/**` plus `CHANGELOG.md` and this file):
   - created: `e2e/focus-ring.ts`, `docs/ui-refresh/wp/U-V.md`;
   - deleted: `src/features/board/Dialog.tsx`;
   - modified: `src/lib/query-store.ts`, `src/lib/copy.ts` (a `passed` tone only),
     `src/components/{Dialog,Menu,Tabs,PageHeader,Card,DataTable,TokenBreakdown,icons}.tsx`,
     `src/app/{Shell,HealthScreen,ProjectSwitcher}.tsx`,
     `src/features/board/{MoveMenu,BoardColumns}.tsx`, `src/features/control/{Chat,bits}.tsx`,
     `src/features/ticket/{AgentCanvas,ChecksTab,TicketInfo}.tsx`,
     `src/features/sessions/{FamilyTree,HowSessionsRelate}.tsx`,
     `src/features/skills/AgentEditor.tsx`, `tests/lib/query-store.test.ts`,
     `tests/components/primitives.test.tsx`, `tests/features/board.test.tsx`,
     `e2e/{shell,pages,harness,ticket,workflow}.spec.ts`, `DESIGN.md`, `CHANGELOG.md`.
3. **Commands and results** (after the rebase on `64b54fd`):
   - `pnpm check`: format ✓, lint ✓, typecheck ✓, tests 2,234/2,234 (core 249, demo 12,
     orchestrator 452, claude-code 323, db 168, web 611, server 419), build ✓;
   - full e2e 3× with screenshots on: 56/56, 56/56, 56/56 (3.8–3.9 min each);
   - repeats: workspace.spec 10/10, shell.spec `--repeat-each=10` 90/90.
4. **Acceptance criteria:** flakes fixed with root cause and repeat evidence → met; narrow widths
   with e2e and screenshots → met; STATUS leftovers → met (all eight, plus FamilyTree, bubbles,
   Passed tone); keyboard and reduced motion → met (e2e); bundle before/after → met (table);
   DESIGN.md Layout, CHANGELOG → met; screenshots 1440/1024/390 light and dark → met.
5. **Assumptions:** text unchanged (only `agent_in_use`, already in `AGENTS_COPY.refusals`, is now
   read from there); chat/comment bubbles made neutral (owner outlined, agents filled) because the
   brand keeps lime for working/selected; the reviewer comment keeps its accent edge.
6. **Shared-file or contract changes:** none made. Proposed: the per-worktree lock in
   `packages/server/src/workspace/manager.ts` (above).
7. **Known gaps / follow-ups:** the server lock; the Changes tab hides a failed review request
   behind "No changes recorded"; Motion's bundle share (LazyMotion or CSS); one Tokens screenshot
   at 1440 caught the sidebar mid-transition (the first shot after a resize from the 1280 rail).
8. **Next recommended task:** coordinator review and merge of `wp/u-v-verify`, then
   `feature/ui-refresh` → `release/0.1.0`.
