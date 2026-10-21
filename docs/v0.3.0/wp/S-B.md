# S-B

> Progress file for S-B. Only its agent edits it. Plan: [../README.md](../README.md).

| Field  | Value      |
| ------ | ---------- |
| Status | review     |
| Branch | wp/s-b-web |

## Tasks

- [x] B1 One pure naming function (`packages/web/src/lib/session-name.ts` `nameSession`) with a
      test per rule (`tests/lib/session-name.test.ts`).
- [x] B2 Names in every view that lists or draws sessions: the Sessions list, a session's page
      (marker plus "Open WEB-12" / "Open the run"), the family tree (and so the control panel's
      agent tree, whose helper lists are that tree), the relationships diagram, the timeline, the
      relationships picker, related sessions, All projects' lists; Tokens by session and the cost
      list use "Session <short id>" when they have no title.
- [x] B3 The run summary card and the merge line on the ticket page (`features/ticket/RunSummary.tsx`,
      reading rules in `features/ticket/run-summary.ts`); "Agent Control Plane" as the `app`
      author label, also in the plan history's comments.
- [x] B4 e2e with mocked routes (`packages/web/e2e/session-names.spec.ts`, Playwright project
      `session-names` on the demo server) and screenshots (`ACP_SCREENSHOT_DIR`).
- [x] B5 Docs (`packages/web/DESIGN.md`, "Session names and run summaries"), gate, report.

## Work log

| Date       | What                                                       | Commit    | Checks                                                |
| ---------- | ---------------------------------------------------------- | --------- | ----------------------------------------------------- |
| 2026-10-21 | Naming function, every view, run summary card, unit tests  | `7add220` | format ✓ lint ✓ typecheck ✓ test 4633/4633 ✓ build ✓  |
| 2026-10-21 | e2e (mocked routes), screenshots, DESIGN.md, status review | (next)    | see the commit; full web e2e green on ports 7631/7641 |

## Decisions and findings

- **Order of the rules** as in the brief: managed → Claude title → helper → fallback. So a managed
  session shows the app's name even when Claude Code also titled it, and a titled helper shows its
  title (with its task still as the second line).
- **A helper** is a session with an agent id _or_ an agent type (the naming rule). Grouping helpers
  under their parent still uses the agent id only (`isHelperAgent`), unchanged.
- **Blank text is no text:** a title, label, branch or description of only spaces does not win a
  rule.
- **Start time** in the fallback: local time without seconds, `Oct 21, 9:00 AM` (`en-US`, like
  the rest of the app). The formatter is injected so tests don't depend on the time zone; the e2e
  pins `timezoneId: 'UTC'`.
- **Marker:** a quiet neutral `Badge` "Started by Agent Control Plane" (no logo: DESIGN.md keeps the
  logo for the top bar and the tab; no lime: lime means working or selected). Its link lives only
  on the session's own page ("Open WEB-12" / "Open the run" → `#/control/:runId`, which already
  redirects to the run's ticket or run page), because elsewhere the marker sits inside a row or
  card link.
- **Diagram:** the marker or a helper's task shares the id's line, so node heights (the layout's
  fixed `Y_GAP`) stay as they were.
- **Lists with only an id and a title** (`ProjectTokensDto.bySession`, the overview's latest
  snapshots) can't apply rules 1, 3 and 4; they read "Session 1a2b3c4d" (the existing
  `OVERVIEW_COPY.sessionById`). Follow-up (contract, not made): add `managed` (and `firstSeenAt`,
  `gitBranch`, `agentType`) to `ProjectTokensDto.bySession` if the owner wants full names there.
- **Removed** the now unused `UNTITLED_SESSION`, `OVERVIEW_COPY.untitled` and `format.sessionLabel`.
- **Run summary reading rules** (no strict format): a first line "Run summary" is dropped (the
  card has that title); a line of at most 80 characters ending with a colon is a heading; `- `
  lines are a list, two spaces of indent per level (at most 3), and a list continues across blank
  lines; everything else is text as written, consecutive lines kept together with their breaks.
  Any other `app` comment is a card too.
- **Merge line:** a single-line `app` comment matching `Merged <branch> into <target> at <rest>`
  (a final period allowed) is a small line with a merge icon, the three parts in monospace.
- **Palette:** it lists actions, pages, projects and tickets, not sessions, so nothing changed
  there.
- **Depends on S-A's real data:** the `managed` field on session DTOs (list, detail, tree), the
  exact run summary text and the merge line's wording. With a server before S-A the views fall
  back to rules 2–4 and the comments to the old authors, as tested.
- No instructions were found in repository files, fixtures or tool output.
