# U-F — Remaining pages: Tokens, Harness, Sessions, projects, settings, health, control

> Progress file for U-F. Only the agent working on U-F edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope, owned paths and rules: `docs/ui-refresh/README.md`.

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
| Owner   | U-F agent      |
| Branch  | `wp/u-f-pages` |
| Started | 2026-10-17     |
| Updated | 2026-10-17     |

## Work log (append-only; newest last)

| Date       | What was done                                                                   | Commit    | Checks                          |
| ---------- | ------------------------------------------------------------------------------- | --------- | ------------------------------- |
| 2026-10-17 | Claimed U-F; baseline e2e 49/49 with screenshots                                | `f593139` | —                               |
| 2026-10-17 | Tokens, Harness, Sessions, Session, projects, wizard, Settings, health, control | `ad57928` | pnpm check 2119/2119            |
| 2026-10-17 | Coordinator note: Approvals, BudgetBar, ConfirmAction width; Connection steps   | `9fee8d9` | pnpm check 2119/2119            |
| 2026-10-17 | Control panel screenshots in `control.spec.ts` (add-only)                       | `a0861a5` | e2e control 4/4                 |
| 2026-10-17 | Rebased on `feature/ui-refresh` (`9912864`, U-D merged)                         | —         | pnpm check 2121/2121, e2e 49/49 |

## Handoff notes

- **Shared within my paths, kept for other WPs' importers:** `dangerButtonClass` (now
  `buttonClass('danger')`), `ActionError`, `ConfirmAction`, `StatusWord`, `Fact` in
  `control/bits.tsx`; `BudgetBar` in `control/AgentTree.tsx`; `TextField`, `CheckboxField`,
  `NumberChoice` in `project-setup/fields.tsx` (U-E's StagePanel). Their props are unchanged.
- **New in `control/bits.tsx`:** `alertClass`, the one style for a failed action's sentence
  (soft red with an `AlertIcon`); ActionError, the wizard's and Connection's refusals use it.
- **Removed duplicates:** `features/tokens/Segmented.tsx` (→ shared Segmented),
  `sessions/Filters.tsx`'s `fieldClass`, `project-setup/fields.tsx`'s `inputClass`, `StartRun`'s
  `fieldClass`, HealthCards' own `AlertIcon` (→ shared icons), the hand-rolled tablist in
  `HowSessionsRelate` (→ shared Tabs; the tab is still the address's `view`).
- **BudgetBar** is a CSS container: below 15rem the figure gets its own line (micro size, no
  break). `ConfirmAction`'s resting button is `w-fit`, so it never stretches in a column.

## Blockers / proposed contract changes

_None._ No dependency, contract or shared-file change was needed.

## Completion report (AGENTS.md §9) — U-F

1. **Summary:** the Tokens, Harness, Sessions, Session, All projects, New project, Settings, Data
   health/Connection pages and the legacy control panel (not Chat.tsx) restyled on the U-A tokens
   and shared parts (Segmented, Tabs, field style, Badge/Pill, Skeleton, icons), plus the
   coordinator's three ticket-page control parts (Approvals, BudgetBar, ConfirmAction). Behaviour,
   data and text unchanged.
2. **Files changed (packages/web):**
   - modified: `src/features/tokens/{RangeControl,TokensBreakdown,TokensChart,TokensPage}.tsx`,
     `src/features/harness/{ChecksCard,HarnessPage,RunsCard,StatusCard,UsageCard}.tsx`,
     `src/features/sessions/{ConcurrencyTimeline,Filters,HowSessionsRelate,SessionGraph,SessionNodeView}.tsx`,
     `src/features/session-detail/{ActivityFeed,CostCard,SessionDetail,TokensCard}.tsx`,
     `src/features/all-projects/{AcrossProjects,AllProjectsPage,ProjectCard}.tsx`,
     `src/features/project-setup/{fields,HarnessPanel,NewProjectWizard,ProjectSettings,SetupSections,SourceStep}.tsx`,
     `src/features/health/HealthCards.tsx`,
     `src/features/setup/{HooksSetup,RegisterProjectForm,SetupPage}.tsx`,
     `src/features/control/{AgentTree,Approvals,bits,ControlPanel,ReviewPanel,RunList,StartRun}.tsx`,
     `src/lib/copy.ts` (add-only `PAGES_REFRESH_COPY` at the end), `e2e/control.spec.ts`
     (add-only screenshots);
   - created: `src/features/tokens/TokensSkeleton.tsx`, this file;
   - deleted: `src/features/tokens/Segmented.tsx`.
3. **Commands and results** (after the rebase on `9912864`): `pnpm check` — format ✓, lint ✓,
   typecheck ✓, test 2121/2121 ✓ (web 499, server 419, orchestrator 451, adapter-claude-code 323,
   core 249, db 168, adapter-demo 12), build ✓. `ACP_E2E_PORT=8751 ACP_E2E_CONTROL_PORT=8761`
   e2e: 49/49 ✓. Before the rebase, one full e2e run had a control test fail on an HTTP 500 from
   `/api/runs/:id/review` (server side, under load; it passed on re-run and in the final run), and
   one `pnpm check` run had a 5 s timeout in the server's
   `tests/verification/control/content.test.ts` (passed on re-run). Neither touches web code.
4. **Acceptance criteria:**
   - Tokens: StatCard tiles, Recharts chart (`.recharts-surface` kept, colors from
     `TOKEN_TYPE_COLOR`/tokens, still unstacked lines with gaps for missing days), DataTable
     breakdowns, shared Segmented, honest-number rules kept → met (tokens unit + e2e unchanged).
   - Harness: checks card, run history, run-now, pills/badges → met (harness unit + e2e).
   - Sessions + Session: shared field style, list, graph (`edge-subagent`/`edge-continuation`
     kept), timeline, shared Tabs, detail cards, native `<details>` → met (explorer, family,
     session-detail tests; demo e2e graph checks).
   - All projects, wizard, Settings: cards, steps, shared fields, danger zone → met.
   - Data health / Connection cards (HealthScreen tabs untouched) → met.
   - Control panel (except Chat.tsx) on v2, `dangerButtonClass`/`fieldClass` → shared → met.
   - Skeletons while loading (Tokens page-shaped skeleton, runs history, context files, project
     cards), subtle motion only through U-A presets/CSS (reduced motion respected) → met.
   - No text, role, accessible name, test id or `data-*` change; no Radix part on an app
     `data-state` element → met (all tests unchanged and passing).
5. **Assumptions:** the shared field style's `aria-invalid` red border replaces the per-field
   `border-danger` toggles (same signal); labels use the shared caption-size `labelClass`; the
   tokens chart's faint fill under each line is not stacking (each fill reaches the axis on its
   own); dots on the chart only up to 31 days (hover still marks a day).
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:** the check status "Passed" uses the `done` tone (grey dot) from
   `CHECK_STATUS_COPY`, a copy-level choice I did not change; the two flaky server-side checks in
   item 3 may deserve a look by their owners.
8. **Next recommended task:** coordinator review and merge, then U-V.
