# R-H — Board, ticket and settings simplification

> Progress file for R-H. Only the agent working on R-H edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value           |
| ------- | --------------- |
| Status  | review          |
| Owner   | frontend agent  |
| Branch  | `wp/r-h-polish` |
| Started | 2026-10-16      |
| Updated | 2026-10-16      |

## Tasks

- [x] 1. Board: no own project select; header = project name, live line, New ticket; tokens and
      harness moved off (links)
- [x] 2. Ticket page: live workflow graph, Continue, reviewer comments, new role labels, planner
      chat label, one plan-review word
- [x] 3. Settings: harness card → link; limits and allowlist → one line linking to Workflow
- [x] 4. Harness RunsCard on `GET /api/projects/:id/harness/checks`, grouped into runs
- [x] 5. Workflow Helpers panel: one description
- [x] 6. Remove `features/usage/**`, `features/project/ProjectPage.tsx`, `features/ticket/redirect.tsx`
- [x] 7. Visual consistency (R-A page header, cards, empty states, shared buttons)
- [x] 8. Screenshots (board, ticket states, settings; light/dark; 1440/1024), looked at

## Work log (append-only; newest last)

| Date       | What was done                                                                                  | Commit    | Checks                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| 2026-10-16 | Claimed R-H on `wp/r-h-polish`                                                                 | `ac7deb9` | docs only                                                    |
| 2026-10-16 | Board header, settings simplified, unused usage/project/redirect code removed                  | `c34d344` | web only: format ✓ lint ✓ typecheck ✓ test 414/414 ✓ build ✓ |
| 2026-10-16 | Harness RunsCard on the history route (grouped into runs); Workflow Helpers panel one sentence | `38718c4` | pnpm check ✓: test 1,935/1,935 (web 419)                     |
| 2026-10-16 | Ticket page: live workflow, Continue, roles, reviewer comments, chat speakers; e2e; report     | (this)    | pnpm check ✓: test 1,955/1,955 (web 439); e2e 38/38 ✓        |

## Handoff notes

### Decisions made (within the spec)

- **Board header:** the R-A `PageHeader` with "Board" as the eyebrow, the project name as the title
  (README §4.1) and the live line as its one line. Tokens and Harness are quiet links in the
  actions, next to New ticket. `BoardPage` now takes the project id from the address only; the
  board's own `acp.board.lastProject` memory is removed (the shell remembers the project, and
  still reads that old key as a fallback).
- **Settings keeps the default model.** §4.7 moves limits and the allowlist to Workflow, but the
  Workflow page only uses the project's default model as a placeholder, so the field stays in
  Settings next to the board key. Settings saves the setup as saved now with only its own fields
  changed (board key, model, context files), so it never overwrites limits saved on Workflow.
- **Harness history grouping:** the history rows have no run id, so `groupMainRuns` starts a new
  run when a check repeats or after a pause of more than a minute after the previous check ended
  (checks of one run run back to back). A display grouping only. A run started on this page shows
  from the session store while it runs, when it is refused, and until the history is read again.
- **Live workflow (`features/ticket/LiveWorkflow.tsx`):** R-B's `buildWorkflowGraph` and node
  views, read-only, wrapped so each stage gets its state (ring and a state word) from
  `GET /runs/:id/workflow`. Planner mode comes from the run's agents (a planner agent means
  separate); optional stages are on or off from the run's own states (`off`). Models and skills
  are the project's current settings (`GET /projects/:id/workflow`); a line says so when the
  workflow was saved after the run started. The helpers box holds one summary row ("2 agents ·
  2 working") instead of one row per helper, so the graph stays readable; the agent tree under the
  graph shows every helper (README §8 density risk). Clicking a stage shows its agent in the side
  panel. The graph is hidden while either route has not answered, and when the run route answers 404.
- **Held stage:** `heldStage` reads `code-review` or `unit-tests` as `needs-you` with no live
  agent of that stage while the run is in REVIEW; `unit-tests` only when no tester exists yet (a
  tester's own change waiting for review is also `needs-you`, but is not held). Continue posts
  `POST /runs/:id/continue` with CSRF and explains a refusal.
- **Planner chat (decision C):** `chatSpeaker` names a `lead` message "Planner agent" when it was
  written before the planner ended (the lead waits, QUEUED, until approval, and approval ends the
  planner), "Lead agent" after, and "Lead or planner" when it can't be told (the same instant, or
  a planner not ended while the lead no longer waits). Runs without a planner: "Lead agent". The
  one edge case: text a planner sent after it was ended would read as the lead's; the engine
  stops the planner's session at approval, so this is not expected.
- **Chat and prompts:** the chat reaches the planner while it plans and the lead otherwise
  (`chatAgent`, as the engine's `ownerChat`); the planner gets the Chat tab too. A card's prompt
  box shows only on the agent the chat reaches while it is live, and on live helpers. The
  reviewer and tester get none: they run in REVIEW, when `message_agent` is refused. The panel's
  chat box closes, with its own sentence, once that agent has stopped (the engine refuses it).
  `features/control/Chat.tsx` gets two optional props (`speakerOf`, `closedText`) for this.
- **One plan-review word:** the run status `PLAN_REVIEW` now reads "Plan review" everywhere (it was
  "Plan ready for you", next to the stage pill's "Plan review" and in the run picker), and the
  summary under the header leaves out the run status for the current run (the stage pill says
  it), except while stopping or after a restart.
- **Roles:** cards, the panel and Details name each kind ("Planner agent", "Reviewer agent",
  "Tester agent"); only helpers and the tester show a branch; the read-only planner and reviewer
  say so in Changes and Checks. Tree roots follow the flow: planner, lead, reviewer, tester.
- **Reviewer comments:** an accent "Reviewer" pill and an accent left border, with a tip; the
  graph card links to them ("1 finding from the reviewer in the comments below", a button that
  scrolls, since the hash is the route).

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

## Completion report — R-H

1. **Summary:** the board header has the project name, one live line and New ticket (no project
   select, tokens and harness linked instead); Settings is the project, board key, default model,
   context files, links to Workflow and Harness, and the danger zone; the ticket page shows the
   run's live workflow with stage states, Continue for a held stage, the new roles, reviewer
   comments and planner chat labels. The Harness runs come from the history route; the Workflow
   Helpers panel says its description once; unused code is removed.
2. **Files changed** (under `packages/web/` unless noted):
   - created: `src/features/ticket/LiveWorkflow.tsx`;
   - deleted: `src/features/usage/**` (8 files), `src/features/project/{ProjectPage,SessionsPager}.tsx`,
     `src/features/ticket/redirect.tsx`, `src/features/board/{BoardStats.tsx,last-project.ts}`,
     `tests/features/{usage,project}.test.tsx`;
   - modified: `src/features/board/{BoardPage,icons}.tsx`,
     `src/features/project-setup/{ProjectSettings,HarnessPanel}.tsx`,
     `src/features/ticket/{TicketPage,AgentCanvas,SidePanel,TicketInfo,PlanReview,ChangesTab,ChecksTab}.tsx`,
     `src/features/ticket/ticket-state.ts`, `src/features/harness/{HarnessPage,RunsCard}.tsx`,
     `src/features/harness/{logic,main-check-runs}.ts`, `src/features/workflow/StagePanel.tsx`,
     `src/features/control/Chat.tsx` (two optional props), `src/lib/api.ts` (R-H section),
     `src/lib/copy.ts` (board, settings, ticket, harness runs and run status sections; dead page
     copy removed), `DESIGN.md` (Workflow and Skills & Agents route rows), tests
     `tests/features/{board,board-logic,project-setup,harness,harness-logic,palette,workflow,ticket,ticket-logic}.test.*`,
     e2e `e2e/{ticket-fixtures,ticket.spec,shell.spec,harness.spec}.ts`, and this file.
3. **Commands run and actual results** (repo root, Node 22.21.1, pnpm 10.26.1):
   - `pnpm check`: format:check ✓, lint ✓, typecheck ✓, build ✓; tests 1,955 passed (core 246,
     demo 12, orchestrator 424, claude-code 283, db 168, web 439, server 383).
   - `ACP_E2E_PORT=8351 ACP_E2E_CONTROL_PORT=8361 ACP_SCREENSHOT_DIR=… pnpm --filter @acp/web test:e2e`:
     38/38 passed.
4. **Acceptance criteria:**
   - Board: own select removed; header = project name, live line, New ticket; token tiles and
     harness pill off the board, with links: **met** (component test; shell e2e asserts no
     select, the name and the live line).
   - Ticket: live graph from `RunWorkflowDto` with every state, R-B's nodes read-only, agent tree
     kept: **met** (component tests for plan review, separate planner with post-merge stages, a
     missing route, stage click; logic tests for `liveGraph`, `stageStates`, `runPlannerMode`).
   - Continue for a held stage, CSRF, plain explanation and refusal: **met** (component tests;
     e2e posts it).
   - Reviewer comments with a distinct "Reviewer" label: **met** (component and e2e).
   - Planner, reviewer and tester labelled on cards: **met** (component and e2e).
   - Planner chat labelled from the run detail, "Lead or planner" only when it can't be told:
     **met** (`chatSpeaker` unit tests, component and e2e).
   - One plan-review word: **met** (the pill, the run picker and the summary).
   - Settings: harness card → link; limits and allowlist → one line linking to Workflow; name,
     folder, board key, context files, danger zone kept: **met** (component tests; e2e).
   - Harness RunsCard on the history route, grouped, without the session note: **met** (unit,
     component and e2e).
   - Workflow Helpers panel shows one description: **met** (component test).
   - Unused code removed after grepping: **met**.
   - Visual consistency: board, ticket and settings use `PageHeader`, `Card`, `EmptyState`, `Pill`
     and `Button` (the ticket's custom Start and Review buttons became `Button`): **met**.
   - Screenshots light/dark at 1440 and 1024 for board, ticket (plan review, working with stages,
     in review with reviewer and tester, held with Continue) and settings, looked at: **met**.
     Fixes from them: the settings header gap, a prompt box and chat box on a stopped lead, the
     run picker still saying "Plan ready for you", and a taller graph so node text stays readable.
5. **Assumptions:** see "Decisions made" above.
6. **Contract or shared-file changes:** none to contracts, routes or dependencies. Shared web
   files: add-only R-H section in `lib/api.ts`; `lib/copy.ts` edits in sections R-H took over
   (board, settings, ticket) plus the `RUN_STATUS_COPY.PLAN_REVIEW` word and R-E's runs copy (both
   named in the brief); `features/control/Chat.tsx` gets two optional props for the planner label.
7. **Known gaps / follow-ups:**
   - The live graph shows the project's current models and skills, not the run's snapshot (the
     DTO has no snapshot); a line says so when the workflow changed after the run started. A
     `RunWorkflowDto.workflow` field would make it exact.
   - A `planner` chat role (decision C) would replace the time-based `chatSpeaker`.
   - Not done here (not R-H paths): switching `server/src/workflow/{skill-names,skill-files}.ts`
     to R-D's `listSkillFolders`, the `reference-usage.test.ts` timeout, moving `useSetupAction`
     out of `project-setup`, R-F's dark token palette note.
   - Screenshots are in the session scratchpad (`rh-shots/`), not committed.
8. **Next recommended task:** merge R-H, then R-V (browser e2e of the whole redesign and the
   consented smoke run).
