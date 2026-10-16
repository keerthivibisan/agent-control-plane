# R-J (web) — The lead's chat after the lead ends

> Progress file for the web part of R-J. Only the agent working on R-J web edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Spec:
> `docs/redesign/README.md` §6b ("Web" row), ADR-0020, ADR-0015. Contract: `861d380`
> (`RunDetailDto.followUp`, `ChatMessageDto.followUp`). The backend (engine, server, adapter) is a
> separate branch (`wp/r-j-follow-up`).

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
| Owner   | frontend agent |
| Branch  | `wp/r-j-web`   |
| Started | 2026-10-16     |
| Updated | 2026-10-16     |

## Tasks

- [x] 1. Chat box on ended runs: `available` (box + short line), `running` (box disabled, "The lead
      is answering…"), `unavailable` (a note per reason); unchanged when `followUp` is absent
- [x] 2. The run being viewed (current or an earlier one from the run picker); the lead's chat tab
      reachable when the lead ended
- [x] 3. Bubbles: "Follow-up" tag next to the speaker; "After the run ended" divider before the first
      follow-up message
- [x] 4. Tests: component (each state, tag, divider, send via `sendChat` with CSRF, refused while
      running), e2e (completed run with `followUp` available, message round-trip), screenshots

## Work log (append-only; newest last)

| Date       | What was done                                                                                 | Commit    | Checks                                                |
| ---------- | --------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| 2026-10-16 | Claimed R-J web on `wp/r-j-web`                                                               | `83b41fd` | docs only                                             |
| 2026-10-16 | Follow-up chat states, Follow-up tag and divider; 14 component/unit tests, 2 e2e, screenshots | `959d0ff` | pnpm check ✓: test 2,028/2,028 (web 470); e2e 42/42 ✓ |
| 2026-10-16 | Completion report; status `review`                                                            | (this)    | docs only                                             |

## Handoff notes

### Decisions made (within the spec)

- **Only the lead's panel** follows `followUp` (`leadFollowUp` in `ticket-state.ts`). A follow-up
  turn resumes the lead, never the planner, so the planner's chat tab on an ended run stays closed
  as before. The lead's chat tab was already always there (`tabsFor`), and the panel opens on the
  lead once planning is over (`chatAgent`), so no tab change was needed.
- **Cards unchanged:** the lead's card gets no prompt box on an ended run. The follow-up box lives in
  the panel, where the line explaining what it does is shown.
- **`followUp` present wins over the run status:** on a run still in REVIEW whose lead ended (for
  example after the final code review started), the lead's panel shows the follow-up box instead
  of "has finished its work, so the chat is closed".
- **Running:** the textarea and Send are disabled; the line above is a `role="status"` live region.
  The page refreshes as before: the refetch after the send, and the server's stream notices.
- **Refused while running:** shown like other action errors ("Your message wasn't sent." + the
  server's message); the draft is kept.
- **Unavailable with `reason: null`** (the contract allows it): "This chat can't be continued."
- **Chat.tsx** gained optional `notice`, `waiting`, `placeholder` and `followUpDivider` props and
  `SpeakerOf` an optional `tag`. The control panel passes none, so it renders as before.

### For the coordinator / backend

- No contract change needed.
- The UI expects the server to refetch-trigger the run after the follow-up reply (a `chat-message`
  or `runs-changed` notice with the run id), so `followUp` goes from `running` back to `available`
  without a reload. The e2e stands in for that with a reload, because its routes are mocked.
- The error code of the refusal while a turn runs isn't used by the UI; only its message is shown.

## Completion report — R-J (web)

1. **Summary:** The ticket page keeps the lead's chat on runs whose lead ended: a box with a short
   line when a follow-up is available, a disabled box while the lead answers, and a reason note
   when it can't be continued. Follow-up messages carry a "Follow-up" tag after an "After the run
   ended" divider.
2. **Files changed:**
   - modified: `packages/web/src/features/control/Chat.tsx`,
     `packages/web/src/features/ticket/SidePanel.tsx`,
     `packages/web/src/features/ticket/ticket-state.ts`, `packages/web/src/lib/copy.ts` (add-only
     section at the end), `packages/web/e2e/ticket-fixtures.ts`, `packages/web/e2e/ticket.spec.ts`
   - created: `packages/web/tests/features/ticket-follow-up.test.tsx`, `docs/redesign/wp/R-J-web.md`
3. **Commands run and results:** `pnpm check`: format ✓, lint ✓, typecheck ✓, test 2,028/2,028 ✓
   (core 249, demo 12, orchestrator 430, adapter 300, db 168, web 470, server 399), build ✓.
   `ACP_E2E_PORT=7751 ACP_E2E_CONTROL_PORT=7761 pnpm --filter @acp/web test:e2e`: 42/42 ✓.
4. **Acceptance criteria:**
   - chat box on ended runs, three states, unchanged when absent: met (component tests per state
     and per reason; the existing R-H chat tests still pass);
   - current and earlier runs, lead's chat tab reachable: met (run picker test; review-run test);
   - bubbles tag and divider: met (placement test; e2e);
   - no run status copy change: met (none changed; test checks the stage still reads Done);
   - tests and screenshots: met (14 vitest, 2 e2e; light/dark at 1440 and 1024 looked at in the
     scratchpad, not committed).
5. **Assumptions:** see "Decisions made" above.
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:** a real follow-up turn against the backend is untested here (R-V
   real run with owner consent); the e2e uses mocked routes.
8. **Next recommended task:** merge with the R-J backend (`wp/r-j-follow-up`) and run the R-V check.
