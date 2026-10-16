# R-G — Server and db wiring, migration 0004

> Progress file for R-G. Only the agent working on R-G edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value                                         |
| ------- | --------------------------------------------- |
| Status  | in-progress (Part 2; Part 1 merged `39bd957`) |
| Owner   | backend agent                                 |
| Branch  | `wp/r-g-server`                               |
| Started | 2026-10-16                                    |
| Updated | 2026-10-16                                    |

## Tasks

Part 1 (no dependency on R-C):

- [x] 1. Migration 0004, with an upgrade test from a 0003 database
- [x] 2. Repositories: workflow get/put (a missing row answers `defaultProjectWorkflow()`)
- [x] 3. Persist `decidedBy` and the run limits snapshot; `ApprovalDto.decidedBy` filled
- [x] 4. `GET/PUT /api/projects/:id/workflow` answering `ProjectWorkflowDto`
- [x] 5. Tests: supertest per route, CSRF refusals, temp git repo, upgrade test

Part 2 (R-C wiring): **in progress** since R-C merged (`6a11e67`).

## Work log (append-only; newest last)

| Date       | What was done                                                                                      | Commit    | Checks                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed R-G; read the spec and the db/server code; paused by the owner before any code was written | `35229f9` | docs-only; `pnpm check` not run (paused)                                                                               |
| 2026-10-16 | Resumed; rebased on main `a532ef2`. Migration 0004, redesign repositories, db tests, README        | `178094d` | format ✓ lint ✓ typecheck ✓ test (db 153; server 306/309, 3 environmental, pass on rerun) ✓ build ✓                    |
| 2026-10-16 | Workflow routes and service, skill-name listing, run store writes/loads decidedBy and limits       | `e067f98` | format ✓ lint ✓ typecheck ✓ test core 243 / demo 12 / orch 366 / adapter 268 / db 153 / web 321 / server 323 ✓ build ✓ |
| 2026-10-16 | Set `review` for Part 1; Part 2 waiting for R-C                                                    | `39bd957` | docs-only; checks as in `e067f98`                                                                                      |
| 2026-10-16 | Part 2 started: rebased on main `fcdc125` (R-C merged)                                             | this      | docs-only                                                                                                              |

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
- **Not yet:** `GET /api/runs/:id/workflow` (`RunWorkflowDto`) and stage changes in the
  `tickets-changed` notices. Both are Part 2.

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

### Part 2 (R-C wiring): not started, waiting for R-C

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

_None._ Part 2 waits for R-C to merge; that is a dependency, not a contract change.

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
