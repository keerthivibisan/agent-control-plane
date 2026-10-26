# H-D

> Progress file for H-D. Only its agent edits it. Plan: [../README.md](../README.md) (part 5, the
> harness in the workflow); binding: [ADR-0027](../../decisions/0027-harness-setup-and-check-blocks.md);
> look: [packages/web/DESIGN.md](../../../packages/web/DESIGN.md) ("The harness in the workflow").
> Web only: the Workflow editor's Checks blocks, the Harness page, the ticket's Checks tab.

| Field  | Value                                                              |
| ------ | ------------------------------------------------------------------ |
| Status | review                                                             |
| Branch | `wp/h-d-web`, rebased on `release/0.3.0` at `453daa8` (H-A merged) |

## Done

- **Workflow editor** (`features/workflow/`): `check-blocks.ts` (pure: a block's place, selection
  and failure route with the pre-ADR-0027 defaults, the checks a selection runs, missing picks,
  where a check runs); the reducer's `add-checks`, `set-check-place`, `set-check-failure` (wiring
  only through core's `canConnect`; `insertFinalStage` never leaves a half-made chain; removing a
  helper removes its change block); the Checks block panel (`editor/CheckBlockFields.tsx`); Add
  block's Checks group; the canvas chip; layout (change blocks in the work row, branch blocks on
  the merge chain, Checks pills 216 wide); Problems warnings for missing picks.
- **Harness page** (`features/harness/`): `SetupCard.tsx` (steps, network badge, outputs, the
  switch, the latest setup runs on main), `SetupRuns.tsx` (shared row), labels and "Where it
  runs" in `ChecksCard.tsx`, "Run setup and checks now".
- **Ticket Checks tab** (`features/ticket/ChecksPanel.tsx`, `ChecksTab.tsx`): setup runs first,
  then On each change / Before the lead's merge / On the ticket branch / Run now on main.
- `lib/api.ts` (add-only): `harnessSetupPaths`, `harnessSetupSchemas`, `isSetupRunsUnavailable`.
  `lib/copy.ts` (add-only): `HARNESS_BLOCKS_COPY`, `SETUP_STATUS_COPY`.
- `e2e/playwright.config.ts`: one new project, `harness-blocks` (demo server).

## API shapes assumed (H-B)

- `GET /api/projects/:id/harness` → `HarnessStatusDto` with optional `setup` (absent: no Setup card).
- `GET /api/projects/:id/harness/checks` → `CheckRunDto[]` (rows may carry `place: 'main'`).
- `POST /api/projects/:id/harness/checks` (CSRF, `{}`) → `CheckRunDto[]`; runs setup, then checks.
- `GET /api/projects/:id/harness/setup-runs` → `SetupRunDto[]` (latest main setup runs, shown in
  the order given); 404 reads as none.
- `PUT /api/projects/:id/setup` with `setupNetwork`; the switch sends projectKey, limits, budget,
  model, contextFiles and `setupNetwork` only (approvals, allowlist and branching absent = kept).
- `TicketDetailDto.setupRuns` (the current run's); `CheckRunDto.place` absent = before merge.
- `GET /api/projects/:id/workflow-graph` for "Where it runs" (404: the column is hidden).

## Decisions

- Missing-pick warnings come from core since H-A: `validateWorkflowGraph(graph, { …, harness })`
  with `harnessForValidation` (ready/partial: its checks; none: null; invalid or loading: no
  warnings). The web-side `checkSelectionWarnings` was dropped. Block defaults come from core's
  `checkBlockOf`, the checks a block runs from `checksForBlock`. The panel keeps its own plain
  words for places and routes (core's `CHECK_PLACE_NAMES` / `CHECK_FAILURE_ROUTE_NAMES` are
  lowercase message fragments).
- The ticket's Checks tab reads `setupRuns` from the cached ticket detail (same query key), so
  `TicketPage.tsx` (not H-D's) is unchanged.
- The merge block keeps its eyebrow "Checks" and, until configured, its old description.
- Against H-A's real rules: a change block may check several helpers ("Back to the helper" adds a
  rework link to each, the rounds are set on all); a tester's flow to its change block is not a
  chain step, so removing or moving a block rejoins only the final chain. No test mocks core.
- The ⌘K "Run checks" action keeps its name: the palette does not read the harness, and renaming
  it would need a harness fetch in `features/palette` (not H-D's path).

## Tests

- vitest: `harness-blocks-state.test.ts` (12, including a graph with a change block, back to
  the helper, and a branch block passing core's validation), `harness-blocks-panel.test.tsx` (5),
  `harness-setup.test.tsx` (6), `ticket-checks-groups.test.tsx` (3); `ticket-page.test.tsx`
  updated for the Checks tab's new order and heading.
- e2e `harness-blocks.spec.ts` (2): the panel (fixed merge block, picks by keyboard, label chips,
  failure routes, new blocks) and the Harness page (setup, the switch by keyboard, where checks
  run, run now). Screenshots light and dark with `ACP_SCREENSHOT_DIR`.

## Log

- 2026-10-23: claimed.
- 2026-10-23: editor Checks blocks; Harness page setup; ticket Checks tab; e2e, DESIGN.md,
  status review.
- 2026-10-23: rebased on H-A (`453daa8`); core's selection warnings, defaults and rules; mocks
  removed; a real-validation save test; status review.
