# P4-G — Ticket page UI

> Progress file for P4-G. Only the agent working on P4-G edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value            |
| ------- | ---------------- |
| Status  | review           |
| Owner   | frontend agent   |
| Branch  | `wp/p4-g-ticket` |
| Started | 2026-10-15       |
| Updated | 2026-10-16       |

## Tasks

- [x] Route #/tickets/:id; #/control redirects to the board
- [x] Agent tree canvas with per-agent cards (role, status, branch, budget bar, activity, prompt box, Stop)
- [x] Side panel tabs: Chat, Activity, Changes, Checks, Approvals, Details
- [x] Plan review card (approve / request changes with comment, versions)
- [x] Merge / merge-anyway (reason) / discard; run history
- [x] Fixture tests; screenshots; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                              | Commit        | Checks                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| 2026-10-15 | Claimed P4-G; branch `wp/p4-g-ticket` from `main`                                                                                                                                                                                                          | `58ad08a`     | docs only                                                                            |
| 2026-10-16 | Ticket page: route, `#/control` → board (start page kept at `#/control/new`), canvas, side panel, plan card, checks, merge-anyway, history; typed client; fixture tests                                                                                    | `b2f1108`     | format ✓ lint ✓ typecheck ✓ test 1407/1407 ✓ build ✓                                 |
| 2026-10-16 | Fixture-backed Playwright spec `e2e/ticket.spec.ts` (project `ticket` on the demo server, page.route) + screenshots; layout polish (narrower cards, 25rem panel, scrolling tabs, review list only in REVIEW)                                               | `9697dea`     | format ✓ lint ✓ typecheck ✓ test 1407/1407 ✓ build ✓; e2e `--project ticket` 3/3 ✓   |
| 2026-10-16 | Rebased on `main` (P4-F, `aacca2e`; conflicts resolved, see Decisions). Agent cards and Details show `AgentRunDto.branch` from the start, falling back to the review's branch (`agentBranch`, tested); fixtures carry `branch`                             | `097d662`     | format ✓ lint ✓ typecheck ✓ test 1601/1601 ✓ build ✓                                 |
| 2026-10-16 | Final screenshot pass: three helpers no longer overflow the canvas at 1440 (cards `w-48`, tree padding inside the scroll area; e2e guards it); shorter helper prompt placeholder; screenshots taken from the top. Full web e2e. §9 report; status `review` | (this commit) | format ✓ lint ✓ typecheck ✓ test 1601/1601 ✓ build ✓; web e2e (all projects) 14/14 ✓ |

## Handoff notes

**2026-10-16: ready for review.** Rebased on `main` at `0d82cef`. Everything below "Left" is done.
The earlier pause note is kept for history:

Stopped on the owner's request (2026-10-16). Status stays `in-progress`.

- **Done:** route `#/tickets/:id`; `#/control` → `#/board` (start page kept at `#/control/new`;
  `control.spec.ts` and one control unit test updated); canvas, side panel tabs, plan card,
  checks, merge / merge-anyway / discard, run picker, history, comments, PATCH edit; client
  functions in `lib/api.ts` (`updateTicket`, `addTicketComment`, `decidePlan`, `rerunTicket`,
  `runAgentChecks`, `messageAgent`, `ticketPaths`, `ticketSchemas`; `ApiClient.patch`); tests.
- **Screenshots** (light/dark, 1440/1024): `ACP_SCREENSHOT_DIR=<dir> ACP_E2E_PORT=7521
ACP_E2E_CONTROL_PORT=7531 pnpm --filter @acp/web test:e2e --project ticket`.
- **Left:** run the full web e2e (all projects) with `ACP_E2E_PORT=7521`; look at the last
  screenshots once more; §9 completion report; status `review`.
- **For the coordinator / P4-D:** `AgentRunDto` has no worktree branch, so a card shows it only
  once `GET /runs/:id/review` reports it (proposal: add `branch: string | null` to
  `AgentRunDto`). Assumed responses: PATCH ticket, plan decision and start → `TicketDetailDto`.
  Merge conflicts expected with P4-E (`href.board`/`href.ticket`, same text) and P4-F (`ApiClient.put`
  next to `patch`). The "Control panel" sidebar entry still exists (Shell is not P4-G's).

## Decisions (2026-10-16, after the rebase)

- **Rebase resolution:** `lib/api.ts`, `lib/copy.ts`, `router.ts`, `App.tsx` were rebuilt as
  main's file plus the P4-G section (not a hunk-by-hunk "keep both"), then compared with
  `git show main:<file>`. `ApiClient` has `put` (P4-F) and `patch` (P4-G); `request` takes
  `'GET' | 'POST' | 'PUT' | 'PATCH'`. `href.board`/`href.ticket` are main's; the route union and
  `parseRoute` keep the board, project-setup and ticket entries.
- **Duplicate imports:** main already imports `TicketDetailDtoSchema` and `CheckRunDtoSchema`
  (board, project setup), and `TicketStage`/`CheckRunStatus` in copy.ts, so the P4-G import blocks
  only add what is new (no aliased `TicketCheckRunDtoSchema` any more).
- **One word per check result:** P4-F's `CHECK_STATUS_COPY` had the same name as P4-G's. The ticket
  page now uses P4-F's (so "Took too long" reads the same in settings and on the ticket); the
  Checks tab maps its tones (`done` ✓, `problem` ✗, else –).
- **Stage words match the board:** `TICKET_STAGE_COPY.word` comes from P4-E's `STAGE_COPY` (e.g.
  "Plan review", not "Plan ready for you"); the ticket page keeps its own tips and tones.
- **Branch on the card (decision 4):** `agentBranch(agent, review)` = the agent's `branch`, else the
  review's, else "No branch yet"; never for the lead (no worktree).

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

## Completion report — P4-G

1. **Summary:** the ticket page `#/tickets/:id` (README §5.3): agent tree canvas with per-agent
   cards (role, status, branch, budget bar, activity, prompt box, Stop), side panel tabs, plan
   review card, checks, merge / merge anyway (with reason) / discard, run picker and history,
   comments and editing. `#/control` redirects to the board. Built against synthetic fixtures and
   `page.route`, since P4-D's routes are not merged yet.
2. **Files changed:**
   - created: `packages/web/src/features/ticket/{AgentCanvas,ChangesTab,ChecksTab,PlanReview,SidePanel,TicketInfo,TicketPage}.tsx`,
     `…/ticket/{actions,ticket-state}.ts`, `…/ticket/redirect.tsx`, `packages/web/e2e/ticket.spec.ts`,
     `packages/web/e2e/ticket-fixtures.ts`, `packages/web/tests/features/ticket.test.tsx`,
     `packages/web/tests/features/ticket-logic.test.ts`;
   - modified (add-only sections or route additions): `packages/web/src/lib/{api,copy,router}.ts`,
     `packages/web/src/app/App.tsx`, `packages/web/e2e/playwright.config.ts` (project `ticket`);
   - modified for the `#/control` redirect: `packages/web/e2e/control.spec.ts`,
     `packages/web/tests/features/control.test.tsx` (start page now at `#/control/new`);
   - this progress file.
3. **Commands run and actual results** (2026-10-16, Node 22.21.1, pnpm 10.26.1, after the rebase):
   - `pnpm check`: format ✓, lint ✓, typecheck ✓, test 1601/1601 ✓ (core 233, demo 12,
     orchestrator 366, claude-code 267, db 142, web 320, server 261), build ✓;
   - `ACP_E2E_PORT=7521 ACP_E2E_CONTROL_PORT=7531 pnpm --filter @acp/web test:e2e`: 14/14 ✓
     (demo 7, ticket 3, control 4);
   - screenshots (`ACP_SCREENSHOT_DIR`): plan review, working, working with a helper selected,
     in review (changes, checks); light and dark; 1440 and 1024. Viewed; see the log line.
4. **Acceptance criteria (README §8, P4-G):**
   - tree canvas, built only from `parentAgentRunId`, depth-2 nesting: **met**
     (`ticket.test.tsx`, e2e "working");
   - per-agent cards with prompt boxes (lead → chat, helper → `message_agent`) and Stop: **met**;
   - branch on the card from `AgentRunDto.branch`, review fallback, none for the lead: **met**
     (`agentBranch` tests, card and Details tests, e2e);
   - side panel tabs Chat (lead only), Activity, Changes, Checks, Approvals, Details: **met**;
   - plan review card replaces the canvas; approve / request changes (comment required);
     earlier versions collapsed: **met** (component tests, e2e "plan review");
   - checks with duration, exit status and output tail; Merge blocked by a failing required check;
     merge anyway with a reason: **met** (component tests, e2e "in review");
   - history (runs, plans, comments) and Re-run when terminal: **met**;
   - fixture tests and screenshots in light and dark at 1440 and 1024: **met**;
   - against the real P4-D server: **not verified yet** (P4-D not merged; P4-H covers it).
5. **Assumptions** (documented in `lib/api.ts` section header and here): PATCH ticket, plan
   decision and start answer `TicketDetailDto`; comments answer `TicketCommentDto`; run and agent
   checks answer `CheckRunDto[]`; `TicketDetailDto.checks` holds the current run's checks; the
   lead has no worktree branch.
6. **Contract or shared-file changes needed:** none open. (`AgentRunDto.branch` was proposed and
   is merged in `aacca2e`.) Shared files touched only as allowed: add-only sections in
   `lib/api.ts` (`ApiClient.patch`) and `lib/copy.ts`, routes in `router.ts`/`App.tsx`, and one
   Playwright project in `e2e/playwright.config.ts` (coordinator: please confirm the config line).
7. **Known gaps / follow-ups:**
   - the "Control panel" sidebar entry still exists (Shell is not P4-G's); README §5.1 folds it
     into the board;
   - the page is not yet run against P4-D; mismatches in response shapes would show as parse
     errors (never silently);
   - the run status word "Plan ready for you" (P3/P4-0 `RUN_STATUS_COPY`) sits next to the ticket
     stage "Plan review" (board word); both are correct, the coordinator may want one word.
8. **Next recommended task:** P4-D serves the §6.3 routes with the shapes above; then P4-H's
   workspace e2e runs this page against the fake-Claude server.
