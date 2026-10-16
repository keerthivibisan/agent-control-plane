# R-R part 2 — Visual fixes before v0.0.1 (web)

> Progress file for R-R part 2 (visual). Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope: the
> ten "Visual problems" in `docs/redesign/wp/R-V.md`. Another agent does R-R's functional fixes in
> `packages/server/**` and `packages/web/src/features/skills/**` at the same time.

| Field   | Value                                                         |
| ------- | ------------------------------------------------------------- |
| Status  | review                                                        |
| Owner   | web visual agent                                              |
| Branch  | `wp/r-r-visual` (from `main` `01b2079`, rebased on `29934da`) |
| Started | 2026-10-16                                                    |
| Updated | 2026-10-16                                                    |

Owned paths: `packages/web/**` except `src/features/skills/**`, `tests/features/{skills,agents}*`
and `e2e/skills.spec.ts`; `src/lib/copy.ts` strings for these items only; this file.

## Tasks (R-V.md "Visual problems")

- [x] 1. Board: columns off-screen with no hint; a board with only a Done ticket looks empty
- [x] 2. Board: "No tickets yet" and nine empty columns together
- [x] 3. Planner side panel says "Chat with the lead agent"
- [x] 4. Helper cards: branch as a UUID over three lines
- [x] 5. A lead closed by the engine after a successful run reads "Stopped"
- [x] 6. Live workflow: the final "Done" node is never highlighted
- [x] 7. Tokens: runs but no observed sessions hides the run and ticket counts
- [x] 8. Sessions inside a project: Project filter and "in your projects"
- [x] 9. Data health: tabs above the title; switcher on global pages
- [x] 10. Workflow at 1440: bottom row below the fold, "+" control over the Done edge, Save

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                        | Commit        | Checks                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------- |
| 2026-10-16 | Claimed; before screenshots (light/dark, 1440/1024) in the scratchpad, e2e 49/49                                                     | `bdda988`     | docs only                                                         |
| 2026-10-16 | Items 1–10 in one web commit, with unit tests and e2e assertions; after screenshots looked at                                        | `ef20700`     | format ✓ lint ✓ typecheck ✓ test 2103/2103 ✓ build ✓; e2e 49/49 ✓ |
| 2026-10-16 | Rebased on `main` `29934da` (R-R part 1); `AGENTS_COPY.refusals.agent_in_use` added (coordinator's request); status `review`, report | (this commit) | format ✓ lint ✓ typecheck ✓ test 2111/2111 ✓ build ✓; e2e 49/49 ✓ |

## Before / after (screenshots in the scratchpad, not committed)

| #   | Before                                                                                                 | After                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Nine 256 px columns. Done was off-screen at 1440 and 1024 with no hint; a Done-only board looked empty | Empty columns and Cancelled fold into 48 px rails (count plus vertical name; click to open, "Hide" to fold; still drop targets). The Done-only board shows Done on screen. When it still overflows, an edge fade and a button at each hidden edge appear; the right one counts the hidden tickets ("1 more ticket") and scrolls while a card is dragged over it |
| 2   | "No tickets yet" card above nine empty columns                                                         | The empty-state card alone                                                                                                                                                                                                                                                                                                                                      |
| 3   | The planner's panel said "Chat with the lead agent" / "Message the lead agent…"                        | It names the agent the chat reaches: "Chat with the planner agent", "Message the planner agent…" while the planner plans. The lead's wording is unchanged                                                                                                                                                                                                       |
| 4   | `…/0ff5eab0-6f16-4c02-…` wrapping over three lines                                                     | `…/318360d3` on one line (8 characters when the last part is longer than 12), with the full branch as the title; short names unchanged; the full branch is still in Details                                                                                                                                                                                     |
| 5   | The lead read "Stopped" after a good run                                                               | "Finished" (done tone) when the engine closed it: `CANCELLED` at the same instant as a reviewer's or tester's start, or as a COMPLETED run's end. `data-status` stays `CANCELLED`; owner stops and timeouts keep "Stopped" / "Timed out"                                                                                                                        |
| 6   | The Done node was never lit                                                                            | A success ring and `data-state="done"` once the run is COMPLETED                                                                                                                                                                                                                                                                                                |
| 7   | Only "No token usage yet"                                                                              | Sessions and Agent runs count tiles ("1 · for 1 ticket"), then the empty state: "Usage appears here once the app observes these Claude Code sessions and they report tokens." No token tile, so nothing reads as 0                                                                                                                                              |
| 8   | Project filter (with "All projects") and "in your projects"                                            | No Project filter; "Every Claude Code session in this project…"; the address's project doesn't count as a filter, and Clear goes back to `#/p/:id/sessions`                                                                                                                                                                                                     |
| 9   | Tabs above the page title; "Choose a project"                                                          | Tabs under the title (as Tokens' range control). The switcher shows the remembered project; R-V's "Choose a project" came from a fresh browser context, where nothing is remembered. The e2e now opens a project first and checks it                                                                                                                            |
| 10  | At 1440 × 900 the bottom row and Done were below the fold; "+" sat on the Done edge                    | The canvas is capped at `min(780px, 100vh − 18rem)`, the flow sentence is the card title's ⓘ, and the zoom controls are a row in the unused top-left corner. Done is fully on screen at 1440 × 900 and the controls don't overlap it (e2e). Save was already in a sticky footer; e2e checks it is in view                                                       |

## Completion report — R-R part 2 (visual)

1. **Summary:** the ten R-V visual problems are fixed in the web UI only. There is no contract,
   dependency or server change. Every behaviour change has unit tests and e2e assertions, and
   before/after screenshots (light/dark, 1440/1024) were looked at.
2. **Files changed (all modified unless noted):**
   - `packages/web/src/features/board/{BoardColumns,BoardPage}.tsx`;
   - `features/control/{Chat,bits}.tsx`, `features/control/run-state.ts` (`closedByEngine`);
   - `features/ticket/{AgentCanvas,LiveWorkflow,SidePanel,TicketPage}.tsx`;
   - `features/tokens/{TokenTiles,TokensPage}.tsx`;
   - `features/sessions/{Filters,SessionExplorer}.tsx`, `features/sessions/explorer-params.ts`;
   - `features/health/DataHealthPage.tsx`, `features/setup/SetupPage.tsx`, `app/HealthScreen.tsx`,
     `app/App.tsx`;
   - `features/workflow/{WorkflowGraph,WorkflowPage}.tsx`;
   - `lib/copy.ts` (strings for these items, plus `AGENTS_COPY.refusals.agent_in_use`);
   - tests: `tests/features/{board,ticket,control-logic,tokens,explorer}.test.*`,
     `tests/app/shell.test.tsx`;
   - e2e: `e2e/{shell,workspace,pages}.spec.ts`, `e2e/ticket-fixtures.ts` (new
     `plannerReviewScenario`; the lead's `endedAt` in `mergedAgents` now matches the reviewer's
     start, as the engine does it; `doneScenario` serves the run workflow);
   - created: this file.
3. **Commands and results** (Node 22.21.1, pnpm 10.26.1), after the rebase: `pnpm check` gives
   format ✓, lint ✓, typecheck ✓, build ✓, and 2111 tests passed (core 249, demo 12,
   orchestrator 451, claude-code 323, db 168, web 490, server 418). The e2e
   (`ACP_E2E_PORT=8151 ACP_E2E_CONTROL_PORT=8161 pnpm --filter @acp/web test:e2e`) passed 49/49.
4. **Acceptance criteria:** items 1–10 are met; the evidence is in the table above. Unit tests:
   `board.test.tsx` (rails, unfold/hide, a drop on a rail, the empty board alone),
   `ticket.test.tsx` "R-R visual fixes" (planner chat copy, `shortBranch`, Finished vs Stopped,
   the Done node lit only when completed), `control-logic.test.ts` (`closedByEngine`),
   `tokens.test.tsx` (counts without usage), `explorer.test.tsx` (project scope),
   `shell.test.tsx` (tabs under the title, the remembered project on `#/health`). e2e: shell
   (rails, the "1 more ticket" hint scrolls Done into view, the back button), workspace (the
   empty board alone, the planner chat copy, the lit Done node, the lead "Finished" with
   `data-status=CANCELLED`, the short UUID branch, Done in view on the board, the Tokens counts,
   the Workflow fit, controls and Save), pages (no Project filter and "this project", tabs under
   the title, the remembered project in the switcher).
5. **Assumptions:**
   - "Closed by the engine" is read from timestamps only. The engine (`orchestrator/src/draft.ts`
     `startStage` and the COMPLETED step) ends the lead in the same step, with the same `now`,
     as it creates the stage agent or ends the run.
   - The chat names the agent it reaches (`chatAgent`), not always the selected one. On the
     planner's panel after approval, messages go to the lead, so it says "lead agent".
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:**
   - An owner Stop of a lead with no helpers can trigger a stage start or completion in the same
     step. That lead then also reads "Finished", as the engine's own `orchestrate: done` treats
     it. A server-side end reason on `AgentRunDto` would remove the guess.
   - The Phase 3 run page (`control/AgentTree`, runs without a ticket) still shows "Stopped" for
     a lead closed at completion. It is not part of the ticket flow; `agentStatusCopy` in
     `control/bits.tsx` is ready for it.
   - `features/skills/AgentEditor.tsx` keeps its local `agent_in_use` string. The skills owner
     can now use `AGENTS_COPY.refusals` and drop it.
8. **Next recommended task:** the rest of the R-R checklist (secret scan, versions, CHANGELOG,
   first CI run).
