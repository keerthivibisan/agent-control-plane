# Redesign status (coordinator-maintained)

> Only the coordinator edits this file. Agents record progress in `docs/redesign/wp/<WP>.md`.
> Plan and owned paths: [README.md](README.md) §7.

| WP  | Title                                               | Depends  | Status                                                                    | Branch           | Merged                         |
| --- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------- | ---------------- | ------------------------------ |
| R-0 | [Contracts, ADRs, progress files](wp/R-0.md)        | approval | **done**                                                                  | `main`           | 2026-10-16                     |
| R-A | [Shell, navigation, visual system](wp/R-A.md)       | R-0      | **done**                                                                  | `wp/r-a-shell`   | 2026-10-16 (`8b70fc4`)         |
| R-C | [Engine: planner, reviewer, tester](wp/R-C.md)      | R-0      | in-progress (resumed)                                                     | `wp/r-c-engine`  | —                              |
| R-G | [Server and db wiring, migration 0004](wp/R-G.md)   | R-0, R-C | **part 1 merged**; part 2 (R-C stage wiring, skills plugin) waits for R-C | `wp/r-g-server`  | part 1: 2026-10-16 (`39bd957`) |
| R-D | [Skills: server module and page](wp/R-D.md)         | R-0, R-A | in-progress (resumed)                                                     | `wp/r-d-skills`  | —                              |
| R-F | [Tokens: query, route, page](wp/R-F.md)             | R-0, R-A | in-progress                                                               | `wp/r-f-tokens`  | —                              |
| R-E | [Harness page](wp/R-E.md)                           | R-A      | in-progress                                                               | `wp/r-e-harness` | —                              |
| R-B | [Workflow page](wp/R-B.md)                          | R-A, R-G | todo                                                                      | —                | —                              |
| R-H | [Board, ticket, settings simplification](wp/R-H.md) | R-A, R-G | todo                                                                      | —                | —                              |
| R-V | [Verification](wp/R-V.md)                           | all      | todo                                                                      | —                | —                              |

**Phase 4:** complete except the browser e2e and the real smoke run, which are now part of R-V.

## Paused by the owner (2026-10-16); resumed the same day. The table below was the paused state

`main` is at `f1c7b62` + this commit, and green. Every paused branch has a "Paused (2026-10-16)" note
in its progress file with the exact next steps. Read it first.

| WP  | Worktree (on this machine)                  | State and next steps                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-A | `.claude/worktrees/agent-af77e0014b6d72052` | **Done, in WIP `5dae320`:** shell, project switcher, `PROJECT_PAGES` sidebar, `#/p/:projectId/...` routes, redirects (with unit tests), All projects page, ⌘K palette, design tokens. **Left:** fix the vitest suites that expect old routes; switcher/palette/All-projects tests; `pnpm check`; DESIGN.md; e2e updates and screenshots; rebase (keep main's `registerProject`); report. A ticketless Phase 3 run opens at `#/p/:id/runs/:runId`. |
| R-C | `.claude/worktrees/agent-a2d3226375ace63e6` | **Done, in WIP `fb73268`:** workflow snapshot, agent stages, separate planner, reviewer and tester after merge, `post_review`, `continueStages`, Stop covers every role. **Left:** fix the typecheck (`exactOptionalPropertyTypes`, `plan.ts:182`); finish `policy.ts`; exports; `deriveRunWorkflow`; all new tests (including default-workflow equivalence); README. Adapter toolsets are blocked on contract decisions A and B below.           |
| R-G | `.claude/worktrees/agent-a64edec75e61b9de3` | Claimed, with the design in its note. **Next:** migration `0004_redesign.sql` and an upgrade test, `repositories/redesign/{workflow,audit}.ts`, `decidedBy`/limits wiring, `GET/PUT /api/projects/:id/workflow`, tests. Part 2 waits for R-C.                                                                                                                                                                                                     |
| R-D | `.claude/worktrees/agent-a2bf7f960a015159c` | Claimed, with the design in its note. **Next:** the `src/skills/` service and tests, the router with supertest security tests, the Skills page with tests and screenshots, and the app.ts/bootstrap lines for R-G.                                                                                                                                                                                                                                |

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
