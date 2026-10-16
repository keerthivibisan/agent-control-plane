# Redesign status (coordinator-maintained)

> Only the coordinator edits this file. Agents record progress in `docs/redesign/wp/<WP>.md`.
> Plan and owned paths: [README.md](README.md) §7.

| WP  | Title                                               | Depends  | Status                                          | Branch                    | Merged     |
| --- | --------------------------------------------------- | -------- | ----------------------------------------------- | ------------------------- | ---------- |
| R-0 | [Contracts, ADRs, progress files](wp/R-0.md)        | approval | **done**                                        | `main`                    | 2026-10-16 |
| R-A | [Shell, navigation, visual system](wp/R-A.md)       | R-0      | in-progress — **paused** (WIP, not checked)     | `wp/r-a-shell` `b145069`  | —          |
| R-C | [Engine: planner, reviewer, tester](wp/R-C.md)      | R-0      | in-progress — **paused** (WIP, typecheck fails) | `wp/r-c-engine` `cb9d1f9` | —          |
| R-G | [Server and db wiring, migration 0004](wp/R-G.md)   | R-0, R-C | in-progress — **paused** (claimed, no code)     | `wp/r-g-server` `b413f22` | —          |
| R-D | [Skills: server module and page](wp/R-D.md)         | R-0, R-A | in-progress — **paused** (claimed, no code)     | `wp/r-d-skills` `321633f` | —          |
| R-F | [Tokens: query, route, page](wp/R-F.md)             | R-0, R-A | todo                                            | —                         | —          |
| R-E | [Harness page](wp/R-E.md)                           | R-A      | todo                                            | —                         | —          |
| R-B | [Workflow page](wp/R-B.md)                          | R-A, R-G | todo                                            | —                         | —          |
| R-H | [Board, ticket, settings simplification](wp/R-H.md) | R-A, R-G | todo                                            | —                         | —          |
| R-V | [Verification](wp/R-V.md)                           | all      | todo                                            | —                         | —          |

**Phase 4:** complete except the browser e2e and the real smoke run, which are now part of R-V.

## Paused by the owner (2026-10-16): resume from here

`main` is at `f1c7b62` + this commit, and green. Every paused branch has a "Paused (2026-10-16)" note
in its progress file with the exact next steps. Read it first.

| WP  | Worktree (on this machine)                  | State and next steps                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-A | `.claude/worktrees/agent-af77e0014b6d72052` | **Done, in WIP `5dae320`:** shell, project switcher, `PROJECT_PAGES` sidebar, `#/p/:projectId/...` routes, redirects (with unit tests), All projects page, ⌘K palette, design tokens. **Left:** fix the vitest suites that expect old routes; switcher/palette/All-projects tests; `pnpm check`; DESIGN.md; e2e updates and screenshots; rebase (keep main's `registerProject`); report. A ticketless Phase 3 run opens at `#/p/:id/runs/:runId`. |
| R-C | `.claude/worktrees/agent-a2d3226375ace63e6` | **Done, in WIP `fb73268`:** workflow snapshot, agent stages, separate planner, reviewer and tester after merge, `post_review`, `continueStages`, Stop covers every role. **Left:** fix the typecheck (`exactOptionalPropertyTypes`, `plan.ts:182`); finish `policy.ts`; exports; `deriveRunWorkflow`; all new tests (including default-workflow equivalence); README. Adapter toolsets are blocked on contract decisions A and B below.           |
| R-G | `.claude/worktrees/agent-a64edec75e61b9de3` | Claimed, with the design in its note. **Next:** migration `0004_redesign.sql` and an upgrade test, `repositories/redesign/{workflow,audit}.ts`, `decidedBy`/limits wiring, `GET/PUT /api/projects/:id/workflow`, tests. Part 2 waits for R-C.                                                                                                                                                                                                     |
| R-D | `.claude/worktrees/agent-a2bf7f960a015159c` | Claimed, with the design in its note. **Next:** the `src/skills/` service and tests, the router with supertest security tests, the Skills page with tests and screenshots, and the app.ts/bootstrap lines for R-G.                                                                                                                                                                                                                                |

**Coordinator decisions to make on resume (before restarting R-C):**

- A. `ManagedAgentSpec.kind`: `'lead' | 'worker'` → `AgentRoleKind` (needed for per-role toolsets).
- B. Add `post_review` (plain text, capped and redacted) to `LeadToolInputs`.
- C. Optional: a `planner` chat role, so the UI doesn't show planner messages as the lead's.
- D. Optional (R-A): add `RunSummaryDto.ticketId`, so `#/control/<run>` redirects go to the exact ticket.
- E. **Verify before more skills work:** managed agents run with `settingSources: []`. Does Claude Code then load project skills from `.claude/skills` at all? If not, ADR-0019 §4 needs a different mechanism, such as an explicit setting source for project skills only. Check this with the SDK docs; a real run needs the owner's consent.

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
