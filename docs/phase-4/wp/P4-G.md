# P4-G — Ticket page UI

> Progress file for P4-G. Only the agent working on P4-G edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value            |
| ------- | ---------------- |
| Status  | in-progress      |
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
- [ ] Fixture tests; screenshots; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                  | Commit        | Checks                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------- |
| 2026-10-15 | Claimed P4-G; branch `wp/p4-g-ticket` from `main`                                                                                                                                                                              | `58ad08a`     | docs only                                                                          |
| 2026-10-16 | Ticket page: route, `#/control` → board (start page kept at `#/control/new`), canvas, side panel, plan card, checks, merge-anyway, history; typed client; fixture tests                                                        | `b2f1108`     | format ✓ lint ✓ typecheck ✓ test 1407/1407 ✓ build ✓                               |
| 2026-10-16 | Fixture-backed Playwright spec `e2e/ticket.spec.ts` (project `ticket` on the demo server, page.route) + screenshots; layout polish (narrower cards, 25rem panel, scrolling tabs, review list only in REVIEW)                   | `9697dea`     | format ✓ lint ✓ typecheck ✓ test 1407/1407 ✓ build ✓; e2e `--project ticket` 3/3 ✓ |
| 2026-10-16 | Rebased on `main` (P4-F, `aacca2e`; conflicts resolved, see Decisions). Agent cards and Details show `AgentRunDto.branch` from the start, falling back to the review's branch (`agentBranch`, tested); fixtures carry `branch` | (this commit) | format ✓ lint ✓ typecheck ✓ test 1601/1601 ✓ build ✓                               |

## Handoff notes

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

_Written when the WP moves to `review`._
