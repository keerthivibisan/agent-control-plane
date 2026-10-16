# R-G — Server and db wiring, migration 0004

> Progress file for R-G. Only the agent working on R-G edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value                                    |
| ------- | ---------------------------------------- |
| Status  | review (Part 2; Part 1 merged `39bd957`) |
| Owner   | backend agent                            |
| Branch  | `wp/r-g-server`                          |
| Started | 2026-10-16                               |
| Updated | 2026-10-16                               |

## Tasks

Part 1 (no dependency on R-C):

- [x] 1. Migration 0004, with an upgrade test from a 0003 database
- [x] 2. Repositories: workflow get/put (a missing row answers `defaultProjectWorkflow()`)
- [x] 3. Persist `decidedBy` and the run limits snapshot; `ApprovalDto.decidedBy` filled
- [x] 4. `GET/PUT /api/projects/:id/workflow` answering `ProjectWorkflowDto`
- [x] 5. Tests: supertest per route, CSRF refusals, temp git repo, upgrade test

Part 2 (R-C wiring, started when R-C merged `6a11e67`):

- [x] 6. Rebased on main (`817d61c`)
- [x] 7. Each ticket run gets the project's workflow (`ticketRunPrompts`, snapshot stored)
- [x] 8. R-C's effects: the reviewer's detached checkout, reviewer comments, the tester's worktree
- [x] 9. `agent_runs.stage` persisted and reloaded
- [x] 10. `GET /api/runs/:id/workflow` → `RunWorkflowDto`; `POST /api/runs/:id/continue` (CSRF)
- [x] 11. Stage changes in the `tickets-changed` notices
- [x] Skills plugin (amended ADR-0019 §4); `kind === 'worker'` checks fixed (tester, helper counts)
- [x] Extra for R-E: `GET /api/projects/:id/harness/checks`

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                   | Commit          | Checks                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed R-G; read the spec and the db/server code; paused by the owner before any code was written                                              | `35229f9`       | docs-only; `pnpm check` not run (paused)                                                                                      |
| 2026-10-16 | Resumed; rebased on main `a532ef2`. Migration 0004, redesign repositories, db tests, README                                                     | `178094d`       | format ✓ lint ✓ typecheck ✓ test (db 153; server 306/309, 3 environmental, pass on rerun) ✓ build ✓                           |
| 2026-10-16 | Workflow routes and service, skill-name listing, run store writes/loads decidedBy and limits                                                    | `e067f98`       | format ✓ lint ✓ typecheck ✓ test core 243 / demo 12 / orch 366 / adapter 268 / db 153 / web 321 / server 323 ✓ build ✓        |
| 2026-10-16 | Set `review` for Part 1; Part 2 waiting for R-C                                                                                                 | `39bd957`       | docs-only; checks as in `e067f98`                                                                                             |
| 2026-10-16 | Part 2 started: rebased on main `fcdc125` (R-C merged)                                                                                          | `36d00d6`       | docs-only                                                                                                                     |
| 2026-10-16 | Migration 0005 (one-lead index by kind; shared path, needs approval)                                                                            | `616b939`       | format ✓ lint (db) ✓ typecheck (db) ✓ test db 157/157 ✓                                                                       |
| 2026-10-16 | WIP Part 2 server wiring (paused by the owner)                                                                                                  | `6e723fa`       | not checked: server typecheck ✓; server tests 321/323 before a test fix (see Paused (2))                                      |
| 2026-10-16 | Resumed (2); rebased on `cf2f5ab`. WIP checked; temp home for the skills plugin in test helpers; `GET /api/projects/:id/harness/checks` for R-E | `daca594`       | format ✓ lint ✓ typecheck ✓ test core 246 / demo 12 / orch 424 / adapter 283 / db 158 / web 354 / server 325 ✓ build ✓        |
| 2026-10-16 | The tester gets a worktree record (db orchestration repository; outside R-G's paths, needs approval)                                            | `6905cfb`       | format ✓ lint (db) ✓ test db 159/159 ✓                                                                                        |
| 2026-10-16 | Part 2 tests: separate planner, reviewer and tester, skills plugin, Continue after restarts, run workflow states, parser                        | `264146d`       | format ✓ lint ✓ typecheck ✓ test core 246 / demo 12 / orch 424 / adapter 283 / db 159 / web 354 / server 337 ✓ build ✓        |
| 2026-10-16 | Server README; rebased on main `817d61c`; status `review`                                                                                       | `e94d517`, this | format ✓ lint ✓ typecheck ✓ test core 246 / demo 12 / orch 424 / adapter 283 / db 159 / web 371 / server 337 (1832) ✓ build ✓ |

## Handoff notes

### What R-B (Workflow page) and R-H (ticket page) can rely on now

- `GET /api/projects/:id/workflow` → `ProjectWorkflowDto` `{ workflow, setup, skills }`.
  - `workflow` is the saved workflow, or `defaultProjectWorkflow()` (dated at the project's
    registration) when none is saved.
  - `setup` is the project's `ProjectAgentSetup` (created with defaults on first use, as
    `GET …/setup` does). Limits and the allowlist are edited through `PUT …/setup`, as before.
  - `skills` lists the project's skill names, sorted. A mapped skill that is not in this list is
    "missing": show it as a problem.
- `PUT /api/projects/:id/workflow` (needs `X-ACP-CSRF`; body `UpdateWorkflowRequest`
  `{ plannerMode, stages }`) → `ProjectWorkflowDto`. The project comes from the path; a body
  `projectId`/`updatedAt` is ignored. A save publishes the `projects-changed` SSE notice.
  - Errors: 403 `csrf_missing`/`csrf_invalid`, 400 `invalid_request`, 404 `not_found`.
- `ApprovalDto.decidedBy` is filled on every approval in `RunDetailDto` and the approval decision
  response: `owner | allowlist | timeout`, or `null` while pending, when the engine closed it, and
  for approvals decided before 0004.
- **Part 2 (R-H's ticket page):**
  - `GET /api/runs/:id/workflow` → `RunWorkflowDto`: one entry per stage in workflow order, with
    `state` (`off | waiting | active | needs-you | done | failed | skipped`) and `agentRunIds`
    (ids into `RunDetailDto.agents`). 404 for an unknown run; off with managed agents off, like
    every `/api/runs/**` route.
  - `POST /api/runs/:id/continue` (CSRF, no body) → `RunDetailDto`. It is the owner's Continue
    after a restart held the next post-merge stage, shown as `code-review: needs-you` with the run
    in REVIEW. Refusals: 409 `run_not_active` (nothing waits), `run_cancelling`,
    `workers_still_running`, `review_not_allowed` (a change is unreviewed).
  - `tickets-changed` is published when any stage's state changes, and for each reviewer post.
  - Reviewer findings are ticket comments with `author: 'reviewer'`, the run id and
    `planId: null`, in `TicketDetailDto.comments`.
  - The tester appears in `RunDetailDto.agents` (kind `tester`) with a `review` like a helper's,
    in `GET /api/runs/:id/review`, and is merged or discarded through `POST /api/runs/:id/review`.
    Its checks run like a helper's. The reviewer and the tester count as live helpers on cards.
  - Agent kinds `planner`, `reviewer` and `tester` appear in `RunDetailDto.agents`.
- **R-E:** `GET /api/projects/:id/harness/checks` → `CheckRunDto[]`, the last 50 main-branch
  results, newest first. 404 for an unknown project.

### Decisions made (within the spec)

- The 0004 columns on Phase 3 tables are accessed through `repositories/redesign/run-audit.ts`,
  not the orchestration repositories (accepted by the coordinator).
- `ApprovalDecider` is a closed list in `@acp/db` (`APPROVAL_DECIDERS`), because core defines it
  only inside `ApprovalDtoSchema`. The limits snapshot is validated with
  `ProjectAgentSetupSchema.pick({ maxConcurrentHelpers, maxDepth }).strict()`.
- 0004 has no CHECK on enum values (`stage`, `decided_by`), only length bounds, following the
  0002/0003 convention. `limits` and `workflow` have JSON-object CHECKs.
- The default workflow's `updatedAt` is the project's `createdAt`, so repeated reads agree.
- Skill listing (`src/workflow/skill-names.ts`) **duplicates R-D's path rules**, because R-D's
  `src/skills/**` is not on main. It only lists folders and lstats `SKILL.md`; it never opens a
  file. It refuses symlinked `.claude`, `.claude/skills`, skill folders and `SKILL.md` files, and
  never lists anything inside the owner's `~/.claude`, even for a project registered at `$HOME`.
  When R-D lands, replace it with R-D's module.
- A project folder that is gone answers `skills: []` (not an error). Other I/O errors (for example
  `EACCES`) propagate as a 500.
- The workflow routes are mounted with the board (same CSRF token). They answer when managed
  agents are off, like the board's reads and setup.
- Stored limits now come back on reload, so a restarted run keeps its project limits instead of
  the Phase 3 defaults. Rows from before 0004 still load with the defaults.

### Part 2 decisions (within the spec)

- **Migration 0005** re-keys the one-lead index by kind. It was needed because the planner,
  reviewer and tester have no parent. Approved by the coordinator.
- **The workflow snapshot and `stagesHeld`** are in the `orchestration_runs.limits` JSON
  (`{ maxConcurrentHelpers, maxDepth, workflow?, stagesHeld? }`, validated as a whole), as the
  coordinator decided. `stagesHeld` is stored so a second restart cannot start a held stage inside
  `recoverAfterRestart`, whose effects the server drops. Accepted by the coordinator; a test covers
  two restarts. `leadBrief` and `reviewPosts` stay in memory.
- **The tester's workspace record**: `repositories/orchestration/workspaces.ts` accepted workers
  only. It now also accepts the tester, in its own commit (`6905cfb`). This path is outside R-G's,
  so it needs the coordinator's approval.
- **The reviewer's checkout** is a detached worktree of the project's HEAD, the branch helpers'
  changes were merged into, under `<dataDir>/review-checkouts/<run>/<agent>`. It is built in
  `control/review-checkouts.ts` with the workspace module's git runner and safety config; the
  workspace module itself is unchanged. While it exists it is an extra root of the project, so
  the reviewer's session is attributed, and it is a managed path, never offered as a new project.
  After a restart the in-memory map is empty: `start()` removes every leftover checkout, instead of
  the `remove-review-checkout` effect of `recoverAfterRestart`, because the server keeps dropping
  recovery effects.
- **Skills plugin**: built per agent start from the project checkout. Skills already copied for
  another agent of the same run are overwritten atomically. The plugin goes when the run reaches a
  terminal state, and every run's plugin goes on `start()`. A skill that is refused (symlink,
  outside the root, `~/.claude`, over 64 KiB, not UTF-8, missing) is counted as
  `skill-unavailable` and left out. The description parser handles plain, quoted and block
  scalars only, not full YAML; the output description is JSON-quoted, so it stays one value.
- **Role helpers** in `control/roles.ts` mirror the engine's `hasReviewableChange` and
  `countsAsHelper`, which the orchestrator does not export.
- **Read-only roles**: the planner's and the reviewer's permission requests are denied without
  asking, with their own messages, and counted as `read-only-tool-denied`. The lead keeps its
  counter.
- **Duplication**: `workflow/skill-files.ts` duplicates R-D's path rules, because R-D is not on
  main. Swap in R-D's module when it lands.

When R-C is on main (`docs/redesign/STATUS.md`; R-C's handoff in `docs/redesign/wp/R-C.md`):

1. Rebase on main.
2. Pass `workflow.workflowFor(projectId)` (`src/workflow/service.ts`) into the engine at run
   creation (board `startTicket` and the control service's create path).
3. Perform R-C's new effects with the existing workspace module:
   - the reviewer's temporary detached checkout of the main branch;
   - reviewer findings stored as ticket comments with author `reviewer` (the comments repository
     already accepts it; covered by the 0004 upgrade test);
   - the tester's worktree.
4. Persist `agent_runs.stage` with `runAudit.setAgentStage` in `control/store.ts` `syncAgent`, and
   restore it in `load()` with `agentStagesForRun`.
5. Add `GET /api/runs/:id/workflow` → `RunWorkflowDto` via R-C's `deriveRunWorkflow`.
6. Include stage changes in the existing `tickets-changed` SSE notices.
7. **Skills plugin (coordinator note, amended ADR-0019 §4):** under `settingSources: []`, managed
   agents load no filesystem skills. At each agent start:
   - build `<dataDir>/runs/<runId>/skills-plugin/` containing
     `.claude-plugin/plugin.json` = `{"name":"acp-skills"}`, and `skills/<name>/SKILL.md` for each
     mapped skill;
   - copy each skill from the **project's checkout** (never a worktree), with R-D's
     realpath/no-symlink rules;
   - reduce the front matter to `name` and `description`, and add no hooks, `.mcp.json`, `agents/`
     or settings;
   - set `spec.skillPlugin = { path, skills: ['acp-skills:<name>', …] }`;
   - remove the directory with the run's other temporary files.
   - Tests use a temp repo: a skill with `allowed-tools` in its front matter must come out without
     it, and a symlinked skill folder must be refused.
   - If R-D's skills module is on main, reuse its parser and path checks.

## Blockers / proposed contract changes

Two changes outside R-G's paths, each in its own commit for the coordinator:

- `616b939` migration 0005 (approved);
- `6905cfb` `packages/db/src/repositories/orchestration/workspaces.ts`: the tester may have a
  workspace record. **Needs approval.**

No contract change.

## Completion report (AGENTS.md §9) — R-G Part 1

1. **Summary:** Part 1 is done.
   - Migration 0004 and its repositories.
   - Approval deciders and run limits are persisted and reloaded.
   - The project workflow GET/PUT routes, with a safe skill-name listing.
   - Part 2 (R-C wiring) waits for R-C.
2. **Files changed:**
   - created:
     - `packages/db/src/migrations/0004_redesign.sql`
     - `packages/db/src/repositories/redesign/{index,workflow,run-audit}.ts`
     - `packages/db/tests/redesign/{migration-0004,repositories}.test.ts`
     - `packages/server/src/workflow/{service,skill-names}.ts`
     - `packages/server/src/routes/workflow.ts`
     - `packages/server/tests/workflow/{routes,skill-names,audit}.test.ts`
   - modified:
     - `packages/db/src/index.ts` (export)
     - `packages/db/README.md` (0004 section)
     - `packages/db/tests/schema.test.ts` and its snapshot
     - `packages/db/tests/workspace/migration-0003.test.ts` (allows later migrations)
     - `packages/server/src/{app,bootstrap}.ts`
     - `packages/server/src/control/{store,mappers}.ts`
     - `packages/server/tests/board/helpers.ts` (wires the workflow service, with a temp home)
     - this file
3. **Commands run and actual results** (`pnpm check` at `e067f98`):
   - format:check ✓
   - lint ✓
   - typecheck ✓
   - tests: core 243, demo 12, orchestrator 366, adapter 268, db 153, web 321, server 323, all passed
   - build ✓

   At `178094d`, the server tests had 3 environmental failures: the known smoke "parent unknown"
   flake and two timeouts under load. They passed on rerun (41/41).

4. **Acceptance criteria:**
   - Migration per the §7 spec: met.
     - Tables and columns are in `0004_redesign.sql`.
     - The upgrade test from 0003 shows the data is kept, the new columns are null, the default
       workflow is answered, and a `reviewer` comment is accepted.
     - 0001–0003 checksums are unchanged.
   - Workflow get/put validated with `ProjectWorkflowSchema`, default when missing: met
     (`repositories.test.ts`).
   - `decidedBy` and limits persisted, and `ApprovalDto.decidedBy` shown: met. `audit.test.ts`
     covers owner, allowlist and the reload.
   - Routes with CSRF, `UpdateWorkflowRequest` and the skills listing: met (`routes.test.ts`,
     `skill-names.test.ts`).
   - Part 2 criteria: not started (waits for R-C).
5. **Assumptions:** see "Decisions made" above.
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:**
   - Part 2.
   - Replace the duplicated skill listing with R-D's module once it lands.
8. **Next recommended task:**
   - Merge this branch.
   - R-B can start on the workflow routes.
   - Resume R-G Part 2 after R-C merges.

## Completion report (AGENTS.md §9) — R-G Part 2

1. **Summary:** Part 2 is done.
   - Ticket runs follow the project's workflow, snapshotted with the run.
   - The planner, reviewer and tester start where ADR-0019 says, with their tools, models and a
     skills plugin.
   - Reviewer findings become ticket comments.
   - The tester's change is reviewed, checked and merged.
   - Stages are persisted, held across restarts and continued by the owner.
   - The run workflow and Continue routes, stage notices, and R-E's check history route.
2. **Files changed:**
   - created:
     - `packages/db/src/migrations/0005_stage_agents.sql`
     - `packages/db/tests/redesign/migration-0005.test.ts`
     - `packages/server/src/control/{review-checkouts,roles}.ts`
     - `packages/server/src/workflow/{skill-files,skills-plugin}.ts`
     - `packages/server/tests/workflow/{stages,skills-plugin}.test.ts`
     - `packages/server/tests/board/harness-history.test.ts`
   - modified:
     - `packages/db/src/repositories/redesign/{run-audit,index}.ts` (run snapshot)
     - `packages/db/src/repositories/orchestration/workspaces.ts` (tester; see Blockers)
     - `packages/db/README.md`
     - `packages/db/tests/redesign/{migration-0004,repositories}.test.ts`
     - `packages/server/src/control/{service,store,mappers,allowlist}.ts`
     - `packages/server/src/board/{service,checks}.ts`
     - `packages/server/src/routes/{control,board}.ts`
     - `packages/server/src/workflow/skill-names.ts`
     - `packages/server/README.md`
     - `packages/server/tests/board/helpers.ts` (temp home for the plugin; `reopen` for restarts)
     - `packages/server/tests/workflow/audit.test.ts`
     - this file
3. **Commands run and actual results**, `pnpm check` after rebasing on `817d61c`, exit 0:
   - format:check ✓
   - lint ✓
   - typecheck ✓
   - tests, 1832 passed: core 246, demo 12, orchestrator 424, claude-code 283, db 159, web 371,
     server 337
   - build ✓
4. **Acceptance criteria:**
   - Workflow into the engine at run creation: **met**. `stages.test.ts` covers separate mode,
     stage models and skills; the default is unchanged, and the board flows still pass.
   - Reviewer checkout, reviewer comments and tester worktree: **met**. `stages.test.ts` follows
     the checkout from creation to removal and checks it holds the merge; the comment has author
     `reviewer`, the run id and `planId: null`; the tester's change is merged, the run COMPLETED
     and the ticket DONE.
   - `agent_runs.stage`: **met** (stored stages asserted for every role).
   - `GET /api/runs/:id/workflow`: **met** (states through the whole flow, off stages, 404).
   - Stage changes in `tickets-changed`: **met** (the reviewer post publishes one).
   - Skills plugin with `allowed-tools` stripped and a symlinked skill refused: **met**
     (`stages.test.ts` end to end; `skills-plugin.test.ts` for the parser, size, UTF-8, a
     symlinked SKILL.md, `~/.claude` and cleanup).
   - Continue after a restart: **met**. Two restarts keep the stage held and the checkout is
     cleaned; Continue refuses a bad CSRF token, then starts a new reviewer; a second Continue
     answers 409.
   - `kind === 'worker'` checks: **met** (tester reviewed and checked; reviewer and tester count
     as helpers).
   - Harness history route for R-E: **met** (`harness-history.test.ts`).
5. **Assumptions:** see "Part 2 decisions" above.
6. **Contract or shared-file changes:**
   - Migration 0005 (approved).
   - The orchestration workspaces repository change (`6905cfb`), which needs approval.
   - No contract change.
7. **Known gaps / follow-ups:**
   - Replace `workflow/skill-files.ts` with R-D's module when it lands.
   - R-V should confirm in the real smoke run that skills load through the plugin and that the
     reviewer's tool limits hold. Only the fake adapter is used here.
   - The lead still sees `submit_plan` in separate mode (R-C's follow-up); the engine refuses it.
8. **Next recommended task:**
   - Merge this branch.
   - R-H builds the live graph on `GET /api/runs/:id/workflow` and the Continue action.
   - R-B is unaffected.
