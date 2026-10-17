# RL-D — Web: approval modes, Start dialog, change cards, ticket-branch merge

> Progress file for RL-D. Only the agent working on RL-D edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope and owned paths: `docs/review-loop/README.md` §7 and §9 (`packages/web/**`).

| Field   | Value                                                               |
| ------- | ------------------------------------------------------------------- |
| Status  | review                                                              |
| Owner   | agent (RL-D)                                                        |
| Branch  | `wp/rl-d-web` (from `feature/ui-refresh`, rebased on 9082d81, RL-A) |
| Started | 2026-10-17                                                          |
| Updated | 2026-10-17                                                          |

## Tasks

- [x] 1. Approvals: Workflow Helpers panel (modes, command list editor, warning), wizard mode,
      Settings summary
- [x] 2. Review stage panel: reviewer, rework rounds, review agent's model/skill/agent file
- [x] 3. Start dialog (board and ticket page) posting `StartTicketRequest`
- [x] 4. Ticket page: change cards, owner overrides, ticket-branch card and actions
- [x] 5. Live workflow graph: review counts, rework edge, "Owner merges" gate, "Waiting for
      review"
- [x] 6. Copy: add-only section; control tool labels from core
- [x] 7. Legacy runs unchanged
- [x] 8. Tests: component tests, e2e full loop on mocked routes, screenshots

## Work log (append-only; newest last)

| Date       | What was done                                                         | Commit    | Checks                                                            |
| ---------- | --------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| 2026-10-17 | Claimed RL-D                                                          | `b2d289d` | docs                                                              |
| 2026-10-17 | Approvals editor, review stage, Workflow graph loop, wizard, Settings | `7b62b28` | format ✓ lint ✓ typecheck ✓ test 2334/2334 ✓ build ✓              |
| 2026-10-17 | Start dialog, change cards, ticket-branch card, live graph, copy      | `8e5adf5` | format ✓ lint ✓ typecheck ✓ test 2372/2372 ✓ build ✓              |
| 2026-10-17 | e2e full loop + screenshots; fixes from the screenshots; DESIGN.md    | `b1ed3f2` | test 2372/2372 ✓; e2e 59/59 ✓                                     |
| 2026-10-17 | Rebased on `feature/ui-refresh` 9082d81 (RL-A merged); full re-check  | (this)    | format ✓ lint ✓ typecheck ✓ test 2451/2451 ✓ build ✓; e2e 59/59 ✓ |

## Decisions and assumptions

1. **Start keeps its one click.** The existing Start/Re-run (and their tests) post `{}` as before.
   The dialog is opt-in: "Start with options…" in the board's Move menu (right after Start) and an
   "Options" button next to Start/Re-run on the ticket page. The dialog sends only the choices
   that differ from the project, so an unchanged dialog also posts `{}`. The two menu-list tests
   (unit and `e2e/shell.spec.ts`) now list the new item.
2. **Legacy `allowlist` is still sent** (the request requires it): it follows the mode (Manual →
   both off; Auto edits/Auto → both on, which `approvalsFromLegacy` maps back to Auto edits). A
   setup saved before ADR-0021 whose approvals the owner did not touch is sent exactly as before
   (its allowlist, no `approvals`), so a limits-only save never changes how runs ask. Settings
   never sends `approvals`.
3. **Review-stage fields are saved only when they differ from `reviewStageOf`'s defaults**, so an
   untouched workflow still saves `review: { requireChecks: true }`.
4. **Loop-run detection** is `changes !== undefined || ticketBranch !== undefined`; everything new
   on the ticket page and the live graph is behind it (legacy runs: same DOM as before).
5. **The run's reviewer and rework limit** are not in `RunDetailDto`; the live graph infers the
   reviewer from the change rounds (`reviewer: 'agent'` present) and the limit from
   `ChangeReviewDto.maxReworkRounds`, falling back to the project's current settings.
6. **`POST /api/runs/:id/ticket-branch` response:** the contract does not fix it; the client
   accepts `TicketBranchReviewDto` or `RunDetailDto` and refetches the ticket and run either way.
7. **`AWAITING_REVIEW` stays out of `LIVE_AGENT`** (no process runs, so no Stop button); the
   helpers row counts it as "N in review". Its final words: "Waiting for review" with a tip naming
   the lead's three choices.
8. **"Latest" labels:** `lib/activity.ts` maps `Used tool: mcp__acp__<name>` (or a bare
   `mcp__acp__<name>`) through core's `controlToolLabel`; anything else is shown as sent.
9. Changed existing tests only where the feature replaced the control they used: the wizard's
   step 3 and the Workflow Helpers save (checkboxes → mode radios), the Review stage's agent-file
   picker (now offered), and the two Move-menu lists.

## Handoff notes for RL-B / RL-V

- Web calls: `POST /api/tickets/:id/start` with `StartTicketRequest` (only overrides);
  `POST /api/runs/:id/review` with `action: 'rework'` + `comment`; `GET`/`POST
/api/runs/:id/ticket-branch`. The change card shows files and diff from `GET
/api/runs/:id/review` when that lists the helper (it is fetched once any change has a
  `headCommit`); without it the card shows `changedFiles` only.
- The ticket-branch card loads `GET …/ticket-branch` only at REVIEW/NEEDS_REVIEW (merge) and for
  a stopped run's open branch (discard only).
- Findings shown on the change cards come from `TicketDetailDto.comments` by
  `ChangeReviewRoundDto.commentId`.

## Completion report (AGENTS.md §9)

## Completion report — RL-D

1. **Summary:** the web side of ADR-0021 against the RL-0 contract with fixtures: approval modes
   (Workflow, wizard, Settings), the review stage panel, the Start dialog, change cards with the
   owner's overrides, the ticket-branch card with the final merge actions, and the live graph's
   review-loop additions. Legacy runs render as before.
2. **Files changed** (all under `packages/web/` plus this file):
   - created: `src/features/review-loop/{ApprovalsEditor,ChangeCard,ReasonForm,StartDialog,TicketBranchCard,icons}.tsx`,
     `src/features/review-loop/logic.ts`, `src/lib/activity.ts`,
     `tests/features/review-loop-{workflow,setup,ticket,board}.test.tsx`,
     `e2e/review-loop.spec.ts`, `e2e/review-loop-fixtures.ts`, `docs/review-loop/wp/RL-D.md`;
   - modified: `src/lib/{api,copy}.ts`; `src/features/workflow/{draft,graph,StagePanel,WorkflowNodes,WorkflowPage}.ts(x)`;
     `src/features/project-setup/{NewProjectWizard,ProjectSettings,SetupSections,fields}.tsx`;
     `src/features/board/{BoardPage,BoardColumns,MoveMenu,TicketCard,moves}.ts(x)`;
     `src/features/ticket/{TicketPage,SidePanel,LiveWorkflow,ChangesTab,ChecksTab,AgentCanvas}.tsx`;
     `src/features/control/{Approvals,AgentTree}.tsx`; `DESIGN.md`; `e2e/playwright.config.ts`,
     `e2e/shell.spec.ts`; `tests/features/{board,project-setup,stage-agent-files,workflow}.test.tsx`.
3. **Commands run and actual results** (Node 22.21.1, pnpm 10.26.1, after the rebase):
   `pnpm check` — format:check ✓, lint ✓, typecheck ✓, test ✓ 2451 passed (core 285,
   adapter-demo 12, orchestrator 552, adapter-claude-code 323, db 175, web 685, server 419),
   build ✓. `ACP_E2E_PORT=9051 ACP_E2E_CONTROL_PORT=9061 pnpm --filter @acp/web test:e2e` —
   59/59 passed (incl. the new `review-loop` project, 3 tests). Screenshots light/dark at
   1440/1024/390 in the scratchpad `rl-d-shots/rl-*.png`.
4. **Acceptance criteria:**
   - Approvals editor with modes, sentences, warning, command list validated with
     `CommandPatternSchema` (inline refusals) → met (`review-loop-workflow.test.tsx`, e2e);
   - wizard mode (Auto edits default), Settings summary linking to Workflow → met
     (`project-setup.test.tsx`, `review-loop-setup.test.tsx`);
   - review stage: reviewer, rounds 0–5, review agent's model/skill/agent file, saved in the
     workflow → met;
   - Start dialog from board and ticket page, project defaults, overrides only, existing Start
     unchanged → met (`review-loop-ticket`, `review-loop-board`, e2e);
   - change cards per state, checks, findings, history, conflicts; owner overrides only for
     needs-owner or after the lead ended; rework with comment → met;
   - ticket-branch card: combined diff, tip checks, Merge / Merge anyway (reason) / Request
     changes (comment) / Discard / Update from main, CSRF, confirmations → met;
   - live graph: review counts, "Rework ×n", owner-merge gate, waiting for review → met;
   - copy add-only (`REVIEW_LOOP_COPY`), `CONTROL_TOOL_LABELS` in "Latest", auto-approval
     records → met; legacy runs unchanged → met (legacy test + all existing tests).
5. **Assumptions:** "Decisions and assumptions" 1–9 above.
6. **Contract or shared-file changes needed:** none made. Proposals for the coordinator: (a) fix
   the `POST /api/runs/:id/ticket-branch` response body in the contract (the web accepts either
   `TicketBranchReviewDto` or `RunDetailDto`); (b) consider `RunDetailDto.reviewer` /
   `maxReworkRounds` (the run's snapshot) so the live graph need not infer them; (c) once RL-B
   no longer reads the legacy `allowlist`, make it optional in `UpdateProjectSetupRequest`.
7. **Known gaps / follow-ups:** built against fixtures; RL-V should check the real routes'
   bodies against assumptions 5–6 and the handoff notes. The Checks tab's "Run again" still
   follows the legacy review state. No owner "grant one more round" control beyond rework past
   the limit from the change card (the card says when a rework goes past it).
8. **Next recommended task:** RL-B (server) against these calls, then RL-V's consented real run.
