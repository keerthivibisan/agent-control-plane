# R-D — Skills: server module and page

> Progress file for R-D. Only the agent working on R-D edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value            |
| ------- | ---------------- |
| Status  | in-progress      |
| Owner   | full-stack agent |
| Branch  | `wp/r-d-skills`  |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                     | Commit        | Checks                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| 2026-10-16 | Claimed R-D. Read ADR-0018, redesign §4.3 and §7, the skill contracts and the server git helpers. Paused by the coordinator before any code.                      | `94dcde6`     | docs only; format:check ✓                            |
| 2026-10-16 | Resumed and rebased on main `4261740`. Server module `src/skills/**` (front matter, ADR-0018 path layer, service, typed refusals) and 26 security and flow tests. | `13ae5ef`     | format ✓ lint ✓ typecheck ✓ test 1687/1687 ✓ build ✓ |
| 2026-10-16 | Router `routes/skills.ts` (`createSkillsRouter`) and 4 supertest tests: the full flow, CSRF 403 on every mutation, typed refusals, not_a_git_repo.                | (this commit) | format ✓ lint ✓ typecheck ✓ test 1691/1691 ✓ build ✓ |

## Handoff notes

### Paused (2026-10-16)

**Done:** the WP is claimed on `wp/r-d-skills` and the reading is finished. No code exists yet.

**Design decided (not built yet):**

- `packages/server/src/skills/`:
  - `frontmatter.ts`: a safe parser and serializer for a YAML subset (`key: value` strings only).
  - `paths.ts` (ADR-0018 §3):
    - realpath the root;
    - lstat `.claude`, `.claude/skills` and `<slug>`, refusing symlinks and anything that resolves
      outside the root;
    - `mkdir` that never follows links;
    - an exclusive temp file (`wx`) plus rename;
    - the 64 KiB cap and a UTF-8 check.
  - `service.ts`: `createSkillsService({ git, now, workflowOf })`, with `list`, `get`, `create`,
    `update`, `delete` and `commit` each taking `{ id, rootPath }`.
  - `errors.ts`: `HttpError` codes `conflict` 409, `not_found` 404, `skill_in_use` 409,
    `unsafe_path` 400, `too_large` 413, `staged_changes` 409 and `not_a_git_repo` 409.
- Git is `SAFE_GIT_CONFIG` plus argv only:
  - `status --porcelain -- <path>`;
  - `log -1 --format=%cI -- <path>`;
  - `diff --cached --name-only`, refusing when anything outside the folder is staged;
  - `add -A -- <folder>`;
  - `commit -m "chore(skills): <verb> <slug>"`;
  - `rev-parse --abbrev-ref HEAD` for the branch.

  Commits use the owner's identity and never push.

- `routes/skills.ts` exports
  `createSkillsRouter({ skills, project: (id) => repos.projects.getById(id), csrfToken })`. Every
  response goes through `out()` with the `@acp/core/api` DTOs, and every mutation goes through
  `requireCsrf`.

**Next steps, in order:**

1. Build the server module and its unit tests, using temp repos from `tests/workspace/helpers.ts`.
   Commit.
2. Build the router and its supertest tests, on a minimal express app with `requestId`, the router
   and `errorHandler`. Cover a missing CSRF token (403) and every security case in the task. Commit.
3. Build the web side and commit:
   - add-only sections in `lib/api.ts` and `lib/copy.ts`;
   - `features/skills/SkillsPage.tsx` and the templates;
   - component tests;
   - a Playwright spec on ports 7951/7961, with screenshots.
4. Finish:
   - write the app.ts and bootstrap lines for R-G;
   - add the shell route if R-A is on main;
   - write the §9 report and set the status to `review`.

**Open problems:** none.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
