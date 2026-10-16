# Redesign status (coordinator-maintained)

> Only the coordinator edits this file. Agents record progress in `docs/redesign/wp/<WP>.md`.
> Plan and owned paths: [README.md](README.md) §7.

| WP  | Title                                                                                                          | Depends  | Status                                         | Branch                             | Merged                 |
| --- | -------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------- | ---------------------------------- | ---------------------- |
| R-0 | [Contracts, ADRs, progress files](wp/R-0.md)                                                                   | approval | **done**                                       | `main`                             | 2026-10-16             |
| R-A | [Shell, navigation, visual system](wp/R-A.md)                                                                  | R-0      | **done**                                       | `wp/r-a-shell`                     | 2026-10-16 (`8b70fc4`) |
| R-C | [Engine: planner, reviewer, tester](wp/R-C.md)                                                                 | R-0      | **done**                                       | `wp/r-c-engine`                    | 2026-10-16 (`6a11e67`) |
| R-G | [Server and db wiring, migration 0004](wp/R-G.md)                                                              | R-0, R-C | **done**                                       | `wp/r-g-server`                    | 2026-10-16 (`ad81df0`) |
| R-D | [Skills: server module and page](wp/R-D.md)                                                                    | R-0, R-A | **done**                                       | `wp/r-d-skills`                    | 2026-10-16 (`e1039ad`) |
| R-F | [Tokens: query, route, page](wp/R-F.md)                                                                        | R-0, R-A | **done**                                       | `wp/r-f-tokens`                    | 2026-10-16 (`9725a2c`) |
| R-E | [Harness page](wp/R-E.md)                                                                                      | R-A      | **done**                                       | `wp/r-e-harness`                   | 2026-10-16 (`2e1c346`) |
| R-B | [Workflow page](wp/R-B.md)                                                                                     | R-A, R-G | **done**                                       | `wp/r-b-workflow`                  | 2026-10-16 (`ffaa619`) |
| R-H | [Board, ticket, settings simplification](wp/R-H.md)                                                            | R-A, R-G | **done**                                       | `wp/r-h-polish`                    | 2026-10-16 (`1f1a186`) |
| R-I | [Stage ↔ agent-file mapping](README.md#6a-mapping-agent-files-and-skills-to-stages-owner-decisions-2026-10-16) | R-H      | **done**                                       | `wp/r-i-agent-files`, `wp/r-i-web` | 2026-10-16 (`30ab747`) |
| R-J | [Resume the lead's chat](README.md#6b-the-leads-chat-after-the-lead-ends-owner-decisions-2026-10-16)           | R-I      | **done**                                       | `wp/r-j-follow-up`, `wp/r-j-web`   | 2026-10-16 (`ed9b6f7`) |
| R-V | [Verification](wp/R-V.md)                                                                                      | all      | **done** (real run 2026-10-16, owner consent)  | `wp/r-v-verify`                    | 2026-10-16 (`4a0525e`) |
| R-K | Role tool base sets (ADR-0019 §7)                                                                              | R-V      | **done** (real re-check passed)                | `wp/r-k-role-tools`                | 2026-10-16 (`3b6cea3`) |
| R-R | Pre-release review and v0.0.1 (see below)                                                                      | R-V      | in-progress (audit, fixes, visual in parallel) | `wp/r-r-fixes`, `wp/r-r-visual`    | —                      |

**Phase 4:** complete except the browser e2e and the real smoke run, which are now part of R-V.

## Second pause by the owner (2026-10-16), resumed the same day

`main` is at `ecc58d0` + this commit, and green. R-0, R-A, R-C and R-G part 1 are merged. Each paused
branch has a "Paused" or "Paused (2)" note in its progress file with the exact next steps, so read
it first. Agents are resumed in the same branch and worktree.

| WP  | Worktree                                    | Last commit | State and the first next step                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-G | `.claude/worktrees/agent-a64edec75e61b9de3` | `63d30f7`   | Part 2 is wired (roles in place, the review checkout, the skills plugin, stage persistence, `GET /runs/:id/workflow`, `POST /runs/:id/continue`) but unchecked. **Next:** rerun the server tests and `pnpm check`, pass a temp home into the plugin test helper, then write the Part 2 tests listed in its note. |
| R-D | `.claude/worktrees/agent-a2bf7f960a015159c` | `4e484a0`   | The skills and agents APIs and the Skills page are done and checked (1,851 ✓ at `5b08511`). **Next:** fix the tests for the "Skills & Agents" label (or revert it), then the Agents tab, its tests, e2e with screenshots, and the report.                                                                        |
| R-F | `.claude/worktrees/agent-adb76c3a8d5a55467` | `f437279`   | The query and the route are checked (1,732 ✓), and the router registration is `1237460`. **Next:** update `tests/features/project.test.tsx` and the Tokens test in `e2e/demo.spec.ts`, then the page tests, e2e with screenshots, and the report.                                                                |
| R-E | `.claude/worktrees/agent-af38834dec4c1148d` | `d4c08bb`   | Checked at `c293844` (1,736 ✓). **Next:** rerun the e2e with screenshots, look at the ticket and none shots, then write the report and set `review`.                                                                                                                                                             |
| R-B | `.claude/worktrees/agent-a9ee4bd598a92e996` | `0c031c8`   | The graph builder, the view, the stage panel and the agent-files list are written (web typecheck only). **Next:** unit and component tests, Playwright with screenshots, then `pnpm check` and the report. Its layout choice (three wrapped rows) needs a look at the screenshots.                               |

**Decisions settled on the second resume (2026-10-16):**

- 1 (migration 0005) is **approved** after review. It is a minimal re-key of the one-lead index by
  kind, with its own upgrade test, and no edit to 0002.
- 2 (`stagesHeld` in the run snapshot) is **accepted**.
- 3 (the harness history route) is **assigned to R-G**.
- 4–6 stay with the coordinator, at merge.

**Coordinator decisions on resume (as listed at the pause):**

1. **Migration 0005 (R-G `1d8331a`).** It re-keys 0002's single-root index to "one lead per run",
   because the parentless planner, reviewer and tester otherwise fail to save (a probe test proves
   it). Review it and approve it. It is a new migration, not an edit.
2. **R-G stores `stagesHeld` in the run snapshot**, not in memory as R-C's notes said, because a
   second restart would otherwise leave the agent stuck in STARTING. Accept it.
3. **R-E's proposed route** `GET /api/projects/:id/harness/checks` (main-branch history through
   `checkRuns.listForProjectMain`; reuses `CheckRunDto[]`). It is server-only, so give it to R-G or
   make it a coordinator commit.
4. **Cleanups once R-F lands:**
   - remove `features/usage/**` (the interim Tokens page);
   - switch `server/src/workflow/skill-names.ts` to R-D's `listSkillFolders`;
   - mark Harness available in DESIGN.md's route table.
5. **R-F palette finding:** the shared dark `--color-token-*` colours fail the palette validator's
   lightness check (contrast and colour-blind separation pass). It is minor; leave it for R-H's
   polish.
6. **Shared-file commits to review at merge:**
   - R-D: `app.ts`/`bootstrap.ts` wiring (`ea04ff8`, `5b08511`) and `ApiClient.delete` (`f7b2d40`);
   - R-F: router registration (`1237460`);
   - R-E and R-B: one `e2e/playwright.config.ts` project each, plus palette additions.

**Paste to resume (coordinator, new chat in the repo root):**

> You are the redesign coordinator for Agent Control Plane. Follow `CLAUDE.md`, `AGENTS.md` and
> `docs/redesign/README.md`. Read `docs/redesign/STATUS.md` fully. Then:
>
> 1. Settle "Coordinator decisions on resume" 1–3.
> 2. Resume R-G, R-D, R-F, R-E and R-B from their branches and worktrees. Each reads its "Paused"
>    note first; never start a second branch.
> 3. Review and merge each one as it reaches `review`. Merge order: R-E and R-F first (smallest),
>    then R-D, R-G and R-B. Update this file after each merge.
> 4. Then do R-H, then R-V.
>
> Never push, never use ports 7420/5173, and ask the owner before any real Claude run.
> Agent toolchain: `export PATH=<pnpm-10 shim>:$HOME/.nvm/versions/node/v22.21.1/bin:$PATH`
> (no `source`).

## Earlier: first pause (resolved)

### Paused by the owner (2026-10-16); resumed the same day. The table below was the paused state

`main` is at `f1c7b62` + this commit, and green. Every paused branch has a "Paused (2026-10-16)" note
in its progress file with the exact next steps. Read it first.

| WP  | Worktree (on this machine)                  | State and next steps                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-A | `.claude/worktrees/agent-af77e0014b6d72052` | **Done, in WIP `5dae320`:** shell, project switcher, `PROJECT_PAGES` sidebar, `#/p/:projectId/...` routes, redirects (with unit tests), All projects page, ⌘K palette, design tokens. **Left:** fix the vitest suites that expect old routes; switcher/palette/All-projects tests; `pnpm check`; DESIGN.md; e2e updates and screenshots; rebase (keep main's `registerProject`); report. A ticketless Phase 3 run opens at `#/p/:id/runs/:runId`. |
| R-C | `.claude/worktrees/agent-a2d3226375ace63e6` | **Done, in WIP `fb73268`:** workflow snapshot, agent stages, separate planner, reviewer and tester after merge, `post_review`, `continueStages`, Stop covers every role. **Left:** fix the typecheck (`exactOptionalPropertyTypes`, `plan.ts:182`); finish `policy.ts`; exports; `deriveRunWorkflow`; all new tests (including default-workflow equivalence); README. Adapter toolsets are blocked on contract decisions A and B below.           |
| R-G | `.claude/worktrees/agent-a64edec75e61b9de3` | Claimed, with the design in its note. **Next:** migration `0004_redesign.sql` and an upgrade test, `repositories/redesign/{workflow,audit}.ts`, `decidedBy`/limits wiring, `GET/PUT /api/projects/:id/workflow`, tests. Part 2 waits for R-C.                                                                                                                                                                                                     |
| R-D | `.claude/worktrees/agent-a2bf7f960a015159c` | Claimed, with the design in its note. **Next:** the `src/skills/` service and tests, the router with supertest security tests, the Skills page with tests and screenshots, and the app.ts/bootstrap lines for R-G.                                                                                                                                                                                                                                |

**R-G part 2, R-F, R-B and R-D reviews (2026-10-16):** each was rebased by the coordinator and
checked (`pnpm check` up to 1,954 ✓, e2e up to 33/33 ✓). The coordinator read the security-relevant
code:

- R-G: the skills-plugin writer rebuilds the front matter from name and description only; the reviewer
  checkouts are argv git under the data directory with internal ids. `6905cfb` (the tester gets a
  worktree record) is approved.
- R-D: realpath plus `lstat` at every level, `O_NOFOLLOW` reads, an exclusive temp file plus rename,
  and a commit refused when other files are staged.

Rebase notes: add-only shared files (`copy.ts`, `api.ts`, the Playwright config) were rebuilt as
main's version plus each WP's own section, to avoid blocks cut in half. One duplicate import and two
shell tests (no page is unbuilt any more) were fixed in R-D's history (`5a9fbd0`, `e1039ad`).

**R-R audit (2026-10-16, read-only, tree and full history):**

- No secrets: token-like strings are test placeholders only. Secret scanners may flag them; add an
  allowlist if they do.
- No large or binary files and no databases ever committed. The fixtures are synthetic.
- Fixed in `07f9f4a`: machine paths, another real project's name and path, and a scratch path with
  a session id.
- **Owner decisions:**
  - keep the author email in history as is;
  - keep `HANDOFF.md` while the repo is private and remove or move it before going public;
  - push only `main` (`git push origin main`), not the 94 local agent branches.

**R-K real re-check (2026-10-16, owner consent):** passed.

- Each role's `system/init` tool list is exactly its base set: `Skill` only for the planner with
  the plugin, the `acp` control tools, and the reviewer narrowed to `Read`.
- No extra tools.
- Budget tokens fell from ~96k to ~29k.

Details are in `docs/research/r-v-real-run-2026-10-16.md`. Next: R-R.

**R-K review (2026-10-16):** merged `3b6cea3` (`wp/r-k-role-tools`). Scope OK (adapter,
verification tests, `provider-adapters.md` §11.1, its progress file). Read and confirmed:

- `roleBaseTools`: worker and tester get the editing set; everyone else gets Read, Grep, Glob.
- `agentToolNames` narrows the base set by the agent file and adds `Skill` only with a plugin.
- The gate denies built-ins outside the set without asking.
- `isRunSkillCall` allows only the run's plugin skill names and fails closed on another input
  shape.
- The lead's edits are denied.

The coordinator re-ran pnpm check (2,089 tests) and the e2e (49/49). Notes:

- In the R-V real run the planner's skill reached it with no `Skill` tool call (the gate counted
  none), so a wrong `{ skill }` input guess would not block preloaded skills.
- A consented real re-check should confirm each role's `system/init` list.
- `provider-adapters.md` §11's "no real run yet" header is stale (R-R).

**R-V real run (2026-10-16, owner consent):** passed. See
`docs/research/r-v-real-run-2026-10-16.md`.

- Every stage was done and the run COMPLETED.
- The skill loaded through the plugin, and the agent file was applied (marker words seen).
- The reviewer's tools were exactly `Read` and `post_review`.
- The follow-up resumed the lead's own session with only Read, Grep and Glob, and the status did
  not change.
- No chat text was in the logs.
- About 96k budget tokens.

**Finding for R-R (security hardening, before v0.0.1):** roles without a `tools` base set
(planner, lead, worker, tester) get 28–37 tools from the Claude Code install, for example
`SendMessage`, `CronCreate`, `RemoteTrigger`, `WebFetch` and `Task`, plus 21 bundled skills. Fix:
an explicit `tools` base set per role; the reviewer proves it works.

**R-V automatic part review (2026-10-16):** merged `4a0525e` (`wp/r-v-verify`). Scope OK
(`web/e2e/**`, `server/tests/verification/redesign/**`, its progress file). The real-run driver
`real-run/drive.ts`:

- refuses without `ACP_REAL_RUN=1`, refuses in CI, and is not a `*.test.ts`;
- records option names, counts and booleans only, never prompt or reply text;
- uses an empty temp `ACP_CLAUDE_DIR`.

The coordinator re-ran pnpm check (2,075 tests) and the e2e (49/49). The stream question is
answered: there is no gap; `chat-message` and `runs-changed` arrive and the page updates without a
reload.

Findings for R-R or follow-ups:

- an agent file in use can be deleted (skills refuse with 409);
- the follow-up prompt ignores a changed agent file (the SDK records the prompt);
- the "Code reviewer" template lists Bash, which the review stage removes;
- the P3-F driver's `fake.byId`.

Visual list (10 items, in `wp/R-V.md`):

- the board's nine columns overflow with no scroll hint;
- "No tickets yet" shows with empty columns;
- the planner panel says "lead";
- the helper branch shows as a UUID;
- a successful lead reads "Stopped";
- Done is never highlighted;
- Tokens hides the counts with no sessions;
- the Project filter inside a project;
- Data health tab placement;
- Workflow fold and overlap.

**R-J backend review (2026-10-16):** merged `ed9b6f7` (`wp/r-j-follow-up`). Scope OK
(orchestrator, server, adapter, `provider-adapters.md` §11.1, its progress file). Read and
confirmed:

- `applyFollowUp` sets `resume`, `forkSession: false`, `tools` Read/Grep/Glob (only narrowed by
  the agent file), and read-only `disallowedTools` plus `Agent`/`Task`. `mcpServers` is `{}`, and
  plugins and skills are removed.
- The follow-up gate allows only those tools, inside the project root. `allowedTools` is never set.
- Logs carry codes and ids only.

The engine keeps follow-up state in memory and never moves a status. The coordinator re-ran pnpm
check (2,068 tests) and the e2e (42/42). The existing tests that expected `409 run_not_active` on
an ended-lead chat now expect a follow-up turn (ADR-0020). Follow-ups:

- R-V checks, in the real run: the resumed session id, new-messages-only, the missing-session
  failure shape, and that the page leaves "running" without a reload;
- the derived follow-up flag covers only the latest 100 messages.

**R-J web review (2026-10-16):** merged `0224740` (`wp/r-j-web`). Scope OK (web plus its progress
file; `Chat.tsx` gains optional props only; no contract change; no raw HTML). The coordinator re-ran
pnpm check (2,028 tests) and the e2e (42/42), and looked at the follow-up screenshot. It only acts
when `RunDetailDto.followUp` is present, so it is inert until the R-J backend merges. Follow-ups:

- the backend must publish a run stream notice when a follow-up reply lands, so "running" goes
  back to "available" without a reload;
- the UI reads the refusal's message, not its code.

**Owner decision (2026-10-16), release:** after R-V comes **R-R, a pre-release review and v0.0.1**.
The repository stays **private** for the first one or two releases. Note: on a private repository,
GitHub Actions minutes count against the plan's monthly free minutes. CI is one Ubuntu job on
pushes to `main` and on PRs, with a 20-minute cap, and is well within them; check the account's
Actions budget is $0. R-R checklist:

- scan the tree and history for secrets, tokens and personal data: absolute `/Users/...` paths,
  emails, real transcript content in `test-fixtures/`;
- README "Status" lists only what is implemented and verified; docs flipped [planned] →
  [implemented] only where true;
- `HANDOFF.md`, `AGENTS.md` and `CLAUDE.md` read well for outside contributors;
- versions `0.0.0` → `0.0.1` in every `package.json` (a coordinator change, lockfile untouched),
  a `CHANGELOG.md`, and tag `v0.0.1`;
- the first CI run on GitHub (it has never run there): fix any Linux-only issue, e.g. the native
  `better-sqlite3` build;
- the owner pushes, or asks the coordinator to.

**R-I web review (2026-10-16):** merged `30ab747` (`wp/r-i-web`). Scope OK (web plus its progress
file; no contract or `api.ts` change; no raw HTML). The coordinator re-ran pnpm check (2,012 tests)
and the e2e (40/40), and looked at the picker, the missing-file and "Used by" screenshots. README §4.3
was updated on merge. Follow-ups:

- the ticket page's live graph doesn't flag a missing agent file;
- lead mode shows two pickers for one lead (the panel says which applies);
- chip names truncate at 1024.

**Owner decision (2026-10-16), lead chat:** resume on message, answers only (ADR-0020, README §6b,
WP R-J). Why: the lead is stopped when the final stages start or the run completes, and a restart
ends it, so the chat closed for good.

**R-I backend review (2026-10-16):** merged `d55ff27` (`wp/r-i-agent-files`). Scope OK
(orchestrator, server, adapter, `provider-adapters.md` §11.1, its progress file). Read and
confirmed:

- `server/src/workflow/agent-profile.ts` reads only the owner's checkout through R-D's path rules;
  any front-matter problem means no profile; logs carry reason codes only.
- The adapter appends the instructions under a heading. `profileToolNames` is the SDK `tools`
  base set: built-ins only, minus the read-only limits, plus `Skill` with a plugin. The gate
  denies unlisted built-ins. `allowedTools` is never set.
- The model order is stage > file > project > provider (`resolveAgentModel`).

The coordinator re-ran pnpm check (1,995 tests). Proposed contract fields (`ProjectWorkflowDto.agents`,
`AgentDefinitionSummaryDto.usedBy`) were not taken: the web part uses `GET /agents` and
`stagesUsingAgent`. Follow-ups:

- refuse deleting an agent file that a stage uses, like skills do;
- the duplicate path rules in `server/src/workflow/skill-*.ts`;
- R-V checks the init tool list, `Task`→`Agent`, and the profile text in the prompt.

**R-H review (2026-10-16):** scope OK (web plus its progress file; two small allowed edits in
`control/Chat.tsx` and the plan-review status word). Continue uses `controlPost` (CSRF). No raw
HTML. Rebased on main (`43b9d57`), then the coordinator re-ran pnpm check (1,956 tests) and the full
e2e (38/38), and looked at the ticket (stages, held + Continue) and board screenshots. Done from the
list below: the board select, the removed pages, the Settings link, the one Helpers description,
the live graph + Continue, the planner chat label and the RunsCard history route. Still open:
`skill-names.ts`/`skill-files.ts` → `listSkillFolders`, the DESIGN.md rows, the
`reference-usage.test.ts` timeout, moving `useSetupAction`, and the palette dark lightness. The live
graph shows the project's current models and skills (`RunWorkflowDto` keeps no snapshot); the card
says so when the workflow changed after the run started.

**Follow-ups for R-H, or coordinator commits (most done in R-H, see above):**

- the board's own project select (owner, 2026-10-16: "removed the project switching in board");
- remove `features/usage/**`, `features/project/ProjectPage.tsx` and `features/ticket/redirect.tsx`;
- Settings' harness card becomes a link to Harness;
- the duplicate description in the Workflow Helpers panel;
- the live workflow graph on the ticket page (`GET /runs/:id/workflow`) and Continue;
- a planner chat label (decision C);
- switch R-E's RunsCard to the history route;
- switch `skill-names.ts` and `skill-files.ts` to R-D's `listSkillFolders`;
- DESIGN.md rows for Workflow and Skills & Agents;
- a longer timeout for `reference-usage.test.ts` (it times out at load ~16).

**R-E review (2026-10-16):** scope OK. The edits outside its own paths are the allowed shell
plug-in, palette additions and copy section. No raw HTML. The coordinator re-ran pnpm check and the
full e2e (24/24) and looked at the screenshots. Merged after the coordinator fixed the recurring
smoke-test flake on main (`67001cd`: wait for the subagent edge). Follow-ups:

- once R-G's history route lands, switch `RunsCard` to it (3 small web changes, listed in
  `wp/R-E.md`);
- move `useSetupAction` out of `project-setup`;
- R-H replaces the Settings harness card with a link.

**R-C review (2026-10-16):** scope OK (orchestrator and adapter, plus the approved decision-B core
commit). Adapter toolsets read and confirmed:

- the planner and reviewer get `disallowedTools` for Bash, Edit, Write and the like, and are denied
  anything but in-folder reads;
- the reviewer alone has `post_review`; the lead's set excludes it, and the engine refuses it from
  anyone else;
- the skills plugin is passed with `settingSources: []` kept.

Default-workflow equivalence is tested. pnpm check was re-run (1,793 ✓). Known gap: in separate mode
the lead still sees `submit_plan`; the engine refuses it. An optional `ManagedAgentSpec.controlTools`
would hide it (later).

**Owner requests (2026-10-16):**

- agent definition files (`.claude/agents/<name>.md`): ADR-0018 is amended, contracts are added in
  `5353095`, and R-D's scope is widened to "Skills & Agents";
- the process graph is R-B, started now. Editable workflows are recorded for later (README §7a).

**R-A review (2026-10-16):** scope OK. The edits outside R-A's paths are link-helper and import
updates plus the removal of `ProjectsList` (All projects replaces it). No raw HTML. The coordinator
re-ran pnpm check (1,719 ✓) and the e2e (20/20 ✓, ports 7551/7561) and looked at the screenshots. Page
WPs plug in through `PROJECT_PAGES` (`src/app/project-pages.ts`) and `ProjectScreen` (DESIGN.md
"Adding a project page"). Follow-ups:

- R-H: remove the board header's own project select and delete `features/project/ProjectPage.tsx`
  and `features/ticket/redirect.tsx`.
- R-E: a ⌘K "Run checks" action.
- R-F: replace the interim Tokens page.

**R-G part 1 review (2026-10-16):** scope OK. Migration 0004 only adds a table and nullable columns,
and 0001–0003 are unchanged. The skill-name listing uses lstat on every segment, contains the
realpath, and never lists `~/.claude`. pnpm check was re-run (1,686 ✓). Follow-up: when R-D lands,
switch `server/src/workflow/skill-names.ts` to R-D's module.

**Coordinator decisions (settled on resume, 2026-10-16):**

- **A. Done on main** (`ManagedAgentSpec.kind: AgentRoleKind`).
- **B. Approved, landing on R-C's branch:** add `post_review` to `LeadToolInputs`, together with the
  adapter change that keeps it out of the lead's default set. On main alone it would reach today's
  lead, because the adapter registers every lead tool.
- **C. Deferred:** there is no `planner` chat role yet, so planner chat shows as the lead's until R-H
  decides how the UI labels it.
- **D. Done on main** (`RunSummaryDto.ticketId`, filled by the control mapper; `b435d14`).
- **E. Settled.** With `settingSources: []` no filesystem skills load. Mapped skills reach agents
  through a run-scoped skills-only plugin that the server builds from the project checkout, with
  front matter reduced to name and description, passed by the adapter as
  `plugins` + `skills: ['acp-skills:<name>']`. See ADR-0019 §4 and ADR-0018 §6. R-V verifies it in
  the consented smoke run.

**Paste to resume (coordinator, new chat in the repo root):**

> You are the redesign coordinator for Agent Control Plane. Follow `CLAUDE.md`, `AGENTS.md` and
> `docs/redesign/README.md`. Read `docs/redesign/STATUS.md` fully. Then:
>
> 1. Settle decisions A–E as coordinator commits on `main` (for E, research the SDK docs first).
> 2. Resume R-A, R-C, R-G and R-D from their branches and worktrees. Each agent reads its progress
>    file's "Paused" note first and continues; never start a second branch.
> 3. Review and merge each one as it reaches `review`, updating this file.
> 4. Then start R-F and R-E, then R-B and R-H, then R-V.
>
> Never push, never use ports 7420/5173, and ask the owner before any real Claude run.

**Agent toolchain note:** the worktree sandbox blocks `source ~/.nvm/nvm.sh` in compound commands.
Give agents a direct prefix instead:
`export PATH=<a pnpm-10 shim dir>:$HOME/.nvm/versions/node/v22.21.1/bin:$PATH`. On this machine
the shim dir is the session scratchpad's `bin/`; recreate it with `ln -s /usr/local/bin/pnpm`.

**Environment notes:** these are the same as Phase 4 (STATUS there):

- use a pnpm 10 shim on `PATH`;
- vitest timeouts under heavy load are environmental, so rerun before treating one as a failure;
- e2e runs on free ports of 7500 or above. The owner's app runs on 7420/5173.
