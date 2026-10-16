# R-V — Verification

> Progress file for R-V. Only the agent working on R-V edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value                                 |
| ------- | ------------------------------------- |
| Status  | review                                |
| Owner   | verification agent                    |
| Branch  | `wp/r-v-verify` (from `main` e06608f) |
| Started | 2026-10-16                            |
| Updated | 2026-10-16                            |

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Commit        | Checks                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed R-V (automatic part); branch `wp/r-v-verify` from `main` (e06608f)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | (this commit) | —                                                                                                                                 |
| 2026-10-16 | Server verification (`packages/server/tests/verification/redesign/`): HTTP harness with the real adapter's SDK options captured per agent; the full stage flow (separate planner + skill + agent file, lead file, helper, merge, reviewer with a `Read, Bash` file kept read-only, tester with stage model + missing file, Done); lead-mode file choice, provider-default model, symlinked/missing file, in-use agent file delete; follow-up turn (resume id, answers-only SDK options, gate, status unchanged, one at a time, SSE notice on reply and on turn end, restart mid-turn)                                                                             | (this commit) | format ✓ lint ✓ typecheck ✓ test 2075/2075 ✓ build ✓                                                                              |
| 2026-10-16 | Browser e2e: `workspace.spec.ts` (P4-H's deferred flow on the real routes: New project wizard → skill + agent file saved and committed → Workflow (separate planner, code review with skill + file) → New ticket → Start → plan v1 → request changes → v2 → approve → helper → merge → reviewer comment → Done → follow-up answered with no reload) on a new live-mode workspace server with a driver (`tests/verification/redesign/e2e-server.ts`); `pages.spec.ts` (every sidebar page, every old address, project Sessions, a session, Data health, not found); a refused follow-up in `ticket.spec.ts`; a race fix in `skills.spec.ts`; screenshots looked at | (this commit) | format ✓ lint ✓ typecheck ✓ test 2075/2075 ✓ build ✓; e2e 48/49, the 1 a pre-existing race in skills.spec.ts, fixed and rerun 4/4 |
| 2026-10-16 | Real run plan for owner consent and its guarded driver (`real-run/drive.ts`: refuses without `ACP_REAL_RUN=1` or with `CI`; not collected by vitest); findings, visual problems, handoff, completion report; status `review`                                                                                                                                                                                                                                                                                                                                                                                                                                      | (this commit) | format ✓ lint ✓ typecheck ✓ test 2075/2075 ✓ build ✓; e2e 49/49 ✓                                                                 |

## What is verified (automatic part)

| R-V item (README §7, STATUS review notes)                                   | Result        | Evidence                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow with planner, reviewer and tester stages, end to end over HTTP     | met           | `server/tests/verification/redesign/stages.test.ts`                                                                                                                             |
| Skills plugin built from the checkout and passed (`plugins`, `skills`)      | met           | same: plugin folder with the cut front matter; planner SDK options `plugins`, `skills: ['acp-skills:planning']`, `tools` gains `Skill`; the tester gets its own; removed at end |
| Stage agent file applied: instructions under the heading in the prompt      | met           | same (planner, lead, reviewer): the real adapter's `systemPrompt.append`; never in logs or stream frames                                                                        |
| Tool narrowing never widens; the reviewer stays read-only with `Read, Bash` | met           | same: reviewer SDK `tools: ['Read']`, `disallowedTools` ⊇ Bash/Edit/Write, the real gate denies Bash, Write, Grep; no approval reaches the owner                                |
| Model precedence stage > file > project > provider                          | met           | `stages.test.ts` (tester stage model, planner and reviewer file model, lead project model), `agent-files.test.ts` (no model anywhere: no SDK `model`)                           |
| A missing (or symlinked) agent file does not block                          | met           | both files: no profile, logged by name and reason code only, the run goes on                                                                                                    |
| Follow-up: resume id = the lead's session, answers-only tools               | met           | `follow-up.test.ts`: `resume`, `forkSession: false`, `tools: ['Read']` (narrowed by the file), Agent/Task/Bash/Edit disallowed, no MCP server, no plugin or skills              |
| Follow-up: status unchanged, one at a time, no relaunch on restart          | met           | same: run and lead record unchanged, `409 follow_up_running`, a restart mid-turn starts nothing, the next message resumes the same session                                      |
| **Run stream notice when the reply lands and when the turn ends**           | met           | same: a `chat-message` notice when the reply lands, `runs-changed` when the turn ends; browser `workspace.spec.ts`: the answer appears and the box returns with no reload       |
| Browser e2e for the whole new UI, incl. P4-H's deferred `workspace.spec.ts` | met           | `web/e2e/workspace.spec.ts` (real routes, fake agents), `pages.spec.ts`, the existing specs: 49/49                                                                              |
| Screenshots light/dark at 1440 and 1024 of every page, looked at            | met           | in the scratchpad only (not committed); problems listed below                                                                                                                   |
| Real smoke run (init tool lists, skill loaded, profile, read-only, resume)  | **plan only** | "Real run plan for owner consent" below; needs the owner's consent in chat                                                                                                      |

## Findings

1. **Deleting an agent file that a stage uses is allowed** (a used skill answers 409). Recorded in
   `agent-files.test.ts` ("documents the current behaviour"); the stage then starts without the
   file. Same as the R-I review follow-up. Owner: the server skills module (`src/skills/agents.ts`).
2. **A follow-up turn's system prompt is probably not re-read** (research note: a resumed session
   reuses its first prompt). The agent-file heading is passed again in `append` but may be ignored.
   Answers-only is enforced by the tool options and the gate, which the tests check. The real run
   records `appendBytes`; the model's behaviour is not observable without reading content.
3. **No gap in the run stream** for follow-ups (the R-J web review's question): it publishes when
   the reply lands and when the turn ends, and the ticket page refetches on both.
4. The **"Code reviewer" agent template lists `Bash`** and its text says "Read the diff (for example
   with `git diff`)", but the Final code review stage removes Bash (read-only role). Drop Bash from
   that template, or say there that the stage removes it. Owner: R-D
   (`features/skills/agent-templates.ts`).
5. Test-harness note: the P3-F e2e driver's `fake.byId` returns the first agent with an id. A
   follow-up turn reuses the lead's id, so a driver must act on the latest start (the R-V workspace
   driver does).

## Visual problems (screenshots at 1440 and 1024, light and dark)

None fixed: all are outside R-V's paths.

1. **Board: tickets in Done (and In review, Needs you) are off-screen.** The nine columns don't fit
   at 1440 or 1024. Only Backlog to Plan review show, with no scroll hint, so a board whose only
   ticket is Done looks empty (`workspace-board-done`). Owner: R-H.
2. **Board: the empty state and the empty columns show together** (the "No tickets yet" card above
   nine empty columns). Owner: R-H.
3. **The Planner's side panel says "Chat with the lead agent"**, "Tell the lead agent…" and
   "Message the lead agent…" while the Planner is selected (`workspace-plan-review`). Decision C's
   label is only on the bubbles. Owner: R-H (`control/Chat.tsx` copy).
4. **Helper cards show the branch as a UUID** (`…/0ff5eab0-6f16-4c02-…`) wrapping over three lines
   (`workspace-review`). The P4-G fixtures use short names, so their screenshots don't show it.
   Owner: R-H (`AgentCanvas`).
5. **The lead reads "Stopped" after a successful run** (the engine closes it when the review stage
   starts), which reads as if the owner stopped it (`workspace-follow-up-answered`). Owner: R-H copy.
6. **Live graph: the final "Done" node is never lit**, even when the ticket is Done. Owner: R-H.
7. **Tokens on a project with runs but no observed sessions** shows only "No token usage yet"; the
   DTO's `runs` and `ticketsWithRuns` counts are hidden. Owner: R-F.
8. **Sessions inside a project still has a Project filter** (other projects and "All projects"),
   and its description says "Every Claude Code session in your projects". Owner: R-H.
9. **Data health: the Overview/Connection tabs sit above the page title**, unlike every other page.
   On global pages the switcher says "Choose a project" although a project is remembered. Owner:
   R-A.
10. Workflow at 1440 (viewport): the bottom row (reviewer, tester, Done) is below the fold at
    900 px, the canvas "+" control overlaps the Done edge, and the stage panel's Save sits at the
    fold. Minor. Owner: R-B.

## Real run plan for owner consent

**Not executed.** It needs the owner's explicit consent in chat at that time (ADR-0012).

**Set-up (all temporary; nothing of the owner's is read):**

- A throwaway repository created by the app (`POST /api/projects/new`) in a temp parent folder,
  with one README commit on `main`.
- A separate server, in-process, on an ephemeral 127.0.0.1 port (never 7420 or 5173):
  `ACP_MODE=live ACP_MANAGED=on`, a temp `ACP_DATA_DIR`, and an **empty** temp `ACP_CLAUDE_DIR`
  for observation, so the real `~/.claude` is never read. The `claude` process gets
  `managedAgentEnv(process.env)` (no `ACP_*` or `GIT_*` variables), as in production.
- Driver: `packages/server/tests/verification/redesign/real-run/drive.ts`. It refuses unless
  `ACP_REAL_RUN=1`, refuses when `CI` is set, and isn't a `*.test.ts` file, so `pnpm test` never
  collects it. Run it from `packages/server`:
  `ACP_REAL_RUN=1 node --conditions=development --import tsx tests/verification/redesign/real-run/drive.ts`.
  It wraps the real SDK `query` only to observe aggregates; the adapter, the gate and the server
  are the production ones.

**Configuration (the UI's routes; every mutation sends `X-ACP-CSRF`):**

1. `GET /api/control/token` for the CSRF token.
2. `POST /api/projects/new` `{ parentDir, name: 'rv-smoke', readme }`.
3. `PUT /api/projects/:id/setup`: key `RV`, 1 helper, depth 1, **60,000 budget tokens per agent**,
   the default model, `editInOwnWorktree: true` (writes in an agent's own worktree need no click),
   no pre-approved checks, no context files.
4. `POST /api/projects/:id/skills` `plan-small` (it asks the planner to end its summary with a
   marker word), then `POST …/skills/plan-small/commit`.
5. `POST /api/projects/:id/agents` `strict-reviewer` with `tools: ['Read', 'Bash']` (it asks the
   reviewer to begin its finding with a marker word), then `POST …/agents/strict-reviewer/commit`.
6. `PUT /api/projects/:id/workflow`: `plannerMode: 'separate'`, plan skill `plan-small`, Final code
   review on with the agent file `strict-reviewer`, Unit tests on.

**The ticket:**

7. `POST /api/projects/:id/tickets` "Add a greet function" (one file, one helper), then
   `POST /api/tickets/:id/move` READY and `POST /api/tickets/:id/start`.
8. Poll `GET /api/tickets/:id` until Plan review, then
   `POST /api/tickets/:id/plans/:planId/decision` approve.
9. Poll `GET /api/runs/:id` every 2 s:
   - any approval still pending (not settled by the gate or the allowlist, e.g. a Bash command) is
     denied with `POST /api/approvals/:id`; there are no human clicks;
   - if the lead hasn't requested review 60 s after its helper finished, one chat nudge (P3-F);
   - in REVIEW, `GET /api/runs/:id/review`, and `POST /api/runs/:id/review` merges each pending
     change (retrying on `checks_running`): the helper's, then the tester's.
10. After COMPLETED, `POST /api/runs/:id/chat` with one follow-up question; poll until
    `followUp.state` is no longer `running`.

**What is observed** (aggregates only; printed, and saved to `<data dir>/real-run-summary.json`):

- Per agent start (planner, lead, helper, reviewer, tester, follow-up), from the SDK options:
  `tools`, `disallowedTools`, whether `allowedTools` is set (must never be), MCP server names, the
  plugin count, `skills`, `resume`, `forkSession`, `model` and `settingSources`; whether the
  agent-file heading is in the system prompt's append (a boolean and a byte count, never the text).
- From each SDK `system/init`: the session id, **the tool names the CLI actually loaded**, and the
  skill names. This is the evidence the adapter tests can't give: the reviewer's list has no
  Bash/Edit/Write, the planner's has `Skill`, and the `Task`/`Agent` naming.
- From each result: subtype, error flag, and the reported cost (estimated, per agent, never
  summed).
- The real gate's decisions as `tool:allow|deny` counts per agent (the read-only denials).
- Markers, as booleans: the skill's marker word in the stored plan summary (the skill loaded); the
  agent file's marker word in the reviewer's stored comment (the profile instructions applied).
- Follow-up:
  - `resume` equals the lead's first init session id;
  - the follow-up's init session id is the same (research item 1, an inference until now);
  - a reply is stored with `followUp: true`;
  - the run status and the lead's record (status, end time, budget used) are unchanged.
- Usage: budget tokens per agent from `GET /api/runs/:id`; the follow-up turn must not change the
  lead's. With an empty observation folder no transcript is ingested, so transcript usage and
  session links in the UI are absent by design (as in P3-F). Transcript dedup isn't part of this
  run.
- Chat storage (ADR-0015): only owner messages, lead and planner replies, plans and reviewer
  comments are stored. The driver checks that the server log contains neither the follow-up
  question nor the plan summary. Afterwards, a dump of the temp database can be searched for the
  helper's file content (it must be absent), as P3-F did.

**Expected tokens and time:** P3-F measured about 15k budget tokens per agent on the first turn,
mostly the system prompt's cache write. Six agent turns (planner, lead, helper, reviewer, tester,
follow-up) come to roughly **90k–150k budget tokens**, capped at 60k per agent by the budget.
Expect 3–10 minutes. The cost is whatever Claude Code reports (printed per agent, estimated).

**Stop and clean-up:**

- Ctrl-C, or the 20-minute limit (`ACP_REAL_RUN_LIMIT_MS`), calls `POST /api/runs/:id/stop`
  (every agent stops), then closes the server.
- The temp folders (data, the empty Claude folder, the parent with the repository and worktrees)
  are printed and kept for inspection, or removed with `ACP_REAL_RUN_CLEANUP=1`.
- Nothing outside the temp folders is written by the driver. Claude Code itself keeps its session
  transcripts where it always does (under the owner's Claude config); the driver never reads them.

## Handoff notes

- **Redesign verification harness:** `server/tests/verification/redesign/harness.ts`,
  `bootRedesign()`. It is P4-H's set-up plus a tee adapter that hands every start to the real
  Claude Code adapter over a capturing `query`, so tests read the real SDK options
  (`sdkFor(id, followUp?)`) and call the real gate (`gate()`). `openStream()` and `waitForNotice()`
  read SSE as it arrives; `mergeChange()` retries `checks_running`.
- **The browser flow on real routes:** the `workspace` Playwright project and
  `server/tests/verification/redesign/e2e-server.ts` (live mode, an empty temp Claude dir, no
  project). Driver routes: `/parent`, `/agents`, `/agents/:id/:action` (the latest start of that
  id), `/repo/show`, `/logs`. Ports default to `ACP_E2E_CONTROL_PORT` + 10 and + 11.
- Screenshots: set `ACP_SCREENSHOT_DIR` for the e2e run; the new names are `workspace-*` and
  `pages-*`.

## Blockers / proposed contract changes

None. Findings 1 and 4 and the visual problems are for the owning WPs (named with each).

## Completion report (AGENTS.md §9)

## Completion report — R-V (automatic part)

1. **Summary:** the redesign is verified end to end without a real Claude. Server tests over HTTP
   read the real adapter's SDK options and call its gate; the browser e2e covers the whole new UI,
   including P4-H's deferred workspace flow on the real routes and the follow-up chat updating with
   no reload. The real smoke run is planned, with a guarded driver, and not executed.
2. **Files changed:**
   - created: `packages/server/tests/verification/redesign/{harness.ts, stages.test.ts,
agent-files.test.ts, follow-up.test.ts, e2e-server.ts, real-run/drive.ts}`,
     `packages/web/e2e/{workspace.spec.ts, pages.spec.ts}`;
   - modified: `packages/web/e2e/playwright.config.ts` (marked R-V sections),
     `packages/web/e2e/ticket.spec.ts` (one R-V test), `packages/web/e2e/skills.spec.ts` (race
     fix), `docs/redesign/wp/R-V.md`.
3. **Commands and results** (Node 22.21.1, pnpm 10.26.1): `pnpm check` gives format ✓, lint ✓,
   typecheck ✓, build ✓, and 2075 tests passed (core 249, demo 12, orchestrator 451, claude-code
   309, db 168, web 470, server 416, of which 7 are new). The e2e (`pnpm --filter @acp/web
test:e2e`, ports 7851/7861/7871) passed 49/49.
4. **Acceptance criteria:** see "What is verified" above. All are met except the real smoke run,
   which is a plan only, as instructed.
5. **Assumptions:** `workspace.spec.ts` "on the mock routes" was done on the real server routes
   with fake agents, which is stronger than page.route mocks. The e2e server runs in live mode so
   the wizard's repository creation behaves as in production.
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:** the real run (owner consent); findings 1, 2 and 4; visual problems
   1–10. The driver is typechecked and its guards are tested, but its flow hasn't been executed.
8. **Next recommended task:** ask the owner for consent and run the real smoke run with the
   driver; then R-R.
