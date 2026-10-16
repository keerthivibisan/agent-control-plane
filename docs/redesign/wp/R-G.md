# R-G — Server and db wiring, migration 0004

> Progress file for R-G. Only the agent working on R-G edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value           |
| ------- | --------------- |
| Status  | in-progress     |
| Owner   | backend agent   |
| Branch  | `wp/r-g-server` |
| Started | 2026-10-16      |
| Updated | 2026-10-16      |

## Work log (append-only; newest last)

| Date       | What was done                                                                                      | Commit      | Checks                                   |
| ---------- | -------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------- |
| 2026-10-16 | Claimed R-G; read the spec and the db/server code; paused by the owner before any code was written | this commit | docs-only; `pnpm check` not run (paused) |

## Handoff notes

### Paused (2026-10-16)

- **Done:** claimed the branch. Read docs/redesign/README.md §6–7, ADR-0019,
  `core/src/workspace/workflow.ts`, `core/src/api/redesign.ts`, migrations 0002/0003, the workspace
  repositories and `server/src/control/store.ts`. No code written yet.
- **Findings to carry on with:**
  - R-C is not merged into main (`wp/r-c-engine` exists; STATUS says in-progress), so only steps 1–5
    apply now.
  - `ticket_comments.author` has no SQL CHECK (it is Zod-validated), and core's
    `TicketCommentAuthorSchema` already includes `reviewer`. So 0004 only needs a comment noting
    that, and the existing comments repository already accepts `reviewer` (add a test).
  - The approvals and runs repositories live in `repositories/orchestration/**`, which R-G does not
    own. Plan: put the new column access in `repositories/redesign/` (`workflow.ts` for get/put;
    `audit.ts` for set/get of `approvals.decided_by`, `orchestration_runs.limits` and
    `agent_runs.stage`), and call them from `server/src/control/store.ts` (`syncApproval` and the
    run insert; `load()` restores `decidedBy` and the limits). Then map `decidedBy` into
    `ApprovalDto` in `control/mappers.ts`.
- **Next steps, exactly:**
  1. Write `packages/db/src/migrations/0004_redesign.sql`: `project_workflow` (project_id PK →
     projects ON DELETE CASCADE, workflow TEXT json_valid object, updated_at);
     `ALTER TABLE agent_runs ADD COLUMN stage TEXT`; `ALTER TABLE approvals ADD COLUMN decided_by TEXT`;
     `ALTER TABLE orchestration_runs ADD COLUMN limits TEXT CHECK (limits IS NULL OR json_valid(limits))`.
  2. Upgrade test from a 0003 database (pattern: `packages/db/tests/workspace/migration-0003.test.ts`).
     Update the schema snapshot in `packages/db/tests/__snapshots__` if one covers the schema.
  3. `repositories/redesign/{workflow,audit,index}.ts`, exported from `packages/db/src/index.ts`, plus
     a README section and tests.
  4. Server: store wiring for decidedBy and limits; `GET/PUT /api/projects/:id/workflow` (CSRF,
     `UpdateWorkflowRequestSchema`, answers `ProjectWorkflowDto` with the setup and a skill-name
     listing of `<root>/.claude/skills/*/SKILL.md`: lstat, no symlinks followed, realpath
     containment); supertest tests with a temp git repo (pattern: `packages/server/tests/board/`).
  5. `pnpm check`, commit, and set `review` with a "Part 2 (R-C wiring): not started, waiting for
     R-C" section.
- **Tooling note:** in this worktree-isolated session, compound shell commands that combine
  `source ~/.nvm/nvm.sh` or `cd … &&` with git were refused by the sandbox; run git and pnpm as
  separate plain commands.
- **Open problems:** none.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
