# Redesign status (coordinator-maintained)

> Only the coordinator edits this file. Agents record progress in `docs/redesign/wp/<WP>.md`.
> Plan and owned paths: [README.md](README.md) §7.

| WP  | Title                                                                                                          | Depends  | Status                    | Branch            | Merged                 |
| --- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------- | ----------------- | ---------------------- |
| R-0 | [Contracts, ADRs, progress files](wp/R-0.md)                                                                   | approval | **done**                  | `main`            | 2026-10-16             |
| R-A | [Shell, navigation, visual system](wp/R-A.md)                                                                  | R-0      | **done**                  | `wp/r-a-shell`    | 2026-10-16 (`8b70fc4`) |
| R-C | [Engine: planner, reviewer, tester](wp/R-C.md)                                                                 | R-0      | **done**                  | `wp/r-c-engine`   | 2026-10-16 (`6a11e67`) |
| R-G | [Server and db wiring, migration 0004](wp/R-G.md)                                                              | R-0, R-C | **done**                  | `wp/r-g-server`   | 2026-10-16 (`ad81df0`) |
| R-D | [Skills: server module and page](wp/R-D.md)                                                                    | R-0, R-A | **done**                  | `wp/r-d-skills`   | 2026-10-16 (`e1039ad`) |
| R-F | [Tokens: query, route, page](wp/R-F.md)                                                                        | R-0, R-A | **done**                  | `wp/r-f-tokens`   | 2026-10-16 (`9725a2c`) |
| R-E | [Harness page](wp/R-E.md)                                                                                      | R-A      | **done**                  | `wp/r-e-harness`  | 2026-10-16 (`2e1c346`) |
| R-B | [Workflow page](wp/R-B.md)                                                                                     | R-A, R-G | **done**                  | `wp/r-b-workflow` | 2026-10-16 (`ffaa619`) |
| R-H | [Board, ticket, settings simplification](wp/R-H.md)                                                            | R-A, R-G | **done**                  | `wp/r-h-polish`   | 2026-10-16 (`1f1a186`) |
| R-I | [Stage ↔ agent-file mapping](README.md#6a-mapping-agent-files-and-skills-to-stages-owner-decisions-2026-10-16) | R-H      | todo (contract `21cf2ab`) | —                 | —                      |
| R-V | [Verification](wp/R-V.md)                                                                                      | all      | todo                      | —                 | —                      |

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
