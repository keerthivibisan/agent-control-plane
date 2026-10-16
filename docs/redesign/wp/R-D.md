# R-D — Skills & Agents: server module and page

> Progress file for R-D. Only the agent working on R-D edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7. Scope grew on 2026-10-16 to agent definition files (ADR-0018 amendment).

| Field   | Value            |
| ------- | ---------------- |
| Status  | review           |
| Owner   | full-stack agent |
| Branch  | `wp/r-d-skills`  |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Work log (append-only; newest last)

Commit hashes are the current ones, after the last rebase onto main `ad81df0`.

| Date       | What was done                                                                                                                                                                                                                       | Commit    | Checks                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| 2026-10-16 | Claimed R-D. Read ADR-0018, redesign §4.3 and §7, the skill contracts and the server git helpers. Paused by the coordinator before any code.                                                                                        | `f4aec27` | docs only; format:check ✓                                         |
| 2026-10-16 | Resumed and rebased on main `4261740`. Server module `src/skills/**` (front matter, ADR-0018 path layer, service, typed refusals) and 26 security and flow tests.                                                                   | `ba8e9b4` | format ✓ lint ✓ typecheck ✓ test 1687/1687 ✓ build ✓              |
| 2026-10-16 | Router `routes/skills.ts` (`createSkillsRouter`) and 4 supertest tests: the full flow, CSRF 403 on every mutation, typed refusals, not_a_git_repo.                                                                                  | `e9fb144` | format ✓ lint ✓ typecheck ✓ test 1691/1691 ✓ build ✓              |
| 2026-10-16 | Shared-file addition: `ApiClient.delete` for 204 responses in `lib/api.ts`, with 3 tests.                                                                                                                                           | `eb1f072` | format ✓ lint ✓ typecheck ✓ test 1694/1694 ✓ build ✓              |
| 2026-10-16 | Rebased on main `59c56c4` (R-G part 1). Refuse a project whose `.claude` is the owner's `~/.claude` (home-folder project), with a test.                                                                                             | `0b2c35c` | format ✓ lint ✓ typecheck ✓ test 1721/1721 ✓ build ✓              |
| 2026-10-16 | Wiring commit: skills router in `app.ts`, service in `bootstrap.ts` with `workflowOf` = R-G's `workflowFor`; a startServer test.                                                                                                    | `548f871` | format ✓ lint ✓ typecheck ✓ test 1721/1721 ✓ build ✓              |
| 2026-10-16 | Web: Skills section in `lib/api.ts` and `lib/copy.ts`; `features/skills/**` (list, editor, templates, Markdown preview, Commit, Delete); 9 component tests.                                                                         | `5037716` | format ✓ lint ✓ typecheck ✓ test 1730/1730 ✓ build ✓              |
| 2026-10-16 | Rebased on main `c81e2f2` (R-A merged). Skills page plugged into the shell: the `ProjectScreen` case, `available: true`, the address follows the open skill; R-A's shell and palette tests updated; 2 tests.                        | `26c31e3` | format ✓ lint ✓ typecheck ✓ test 1765/1765 ✓ build ✓              |
| 2026-10-16 | Rebased on main `ecc58d0` (agent files added to scope). Server: shared `FileTarget` and `store.ts` core; `agents.ts`; `routes/agents.ts`; 10 agents tests (format, flows, symlinked `.claude/agents` and file, `..`, staged, home). | `c0cca80` | format ✓ lint ✓ typecheck ✓ test 1851/1851 ✓ build ✓              |
| 2026-10-16 | Wiring commit: agents router in `app.ts`, service in `bootstrap.ts`; the startServer test covers agents.                                                                                                                            | `c6664a4` | format ✓ lint ✓ typecheck ✓ test 1851/1851 ✓ build ✓              |
| 2026-10-16 | WIP (paused): web agents groundwork (api and copy sections, shared `editor-parts.tsx`, the nav label "Skills & Agents").                                                                                                            | `c2e4ef3` | not checked (completed by `9a94fff`)                              |
| 2026-10-16 | Paused (2) handoff note.                                                                                                                                                                                                            | `b0ae8ff` | docs only                                                         |
| 2026-10-16 | Resumed and rebased on main `cf2f5ab`. Agents tab: tabs in `SkillsPage` (`?tab=agents`), `AgentList`, `AgentEditor` (tool chips, "All tools"), three templates, form rules; label tests fixed; 7 tests.                             | `9a94fff` | format ✓ lint ✓ typecheck ✓ test 1858/1858 ✓ build ✓              |
| 2026-10-16 | e2e `skills.spec.ts` (3 tests) with light and dark screenshots at 1440 and 1024, and four visual fixes from looking at them.                                                                                                        | `f258c74` | check ✓ 1858/1858; e2e skills 3/3 ✓                               |
| 2026-10-16 | Rebased on main `817d61c` (R-E merged, conflicts resolved by keeping both), then on `ad81df0` (R-G Part 2). Final checks; the §9 report; status `review`.                                                                           | (this)    | format ✓ lint ✓ typecheck ✓ test 1895/1895 ✓ build ✓; e2e 27/27 ✓ |

## Handoff notes

**For the coordinator (merge):**

- **Shared-file changes, each in its own labelled commit:**
  - `packages/server/src/app.ts` and `bootstrap.ts`: the wiring commits `548f871` (skills) and
    `c6664a4` (agents);
  - `lib/api.ts` `ApiClient.delete` (`eb1f072`);
  - `SHELL_COPY.nav.pages.skills` is now "Skills & Agents", which R-A's shell test expects;
  - `e2e/playwright.config.ts` has a `skills` project.
- **`src/workflow/skill-names.ts` (R-G) swap:** left to you. `listSkillFolders(root)` and
  `listAgentFiles(root)` are exported from `src/skills/index.ts` and apply the same path rules.
  Note that they refuse a symlinked `.claude/skills` with `unsafe_path`, where `skill-names.ts`
  returns `[]`.
- **The WIP commit `c2e4ef3`** is not checked on its own. The next commit, `9a94fff`, completes it.
  Squash them if you want every commit to pass on its own.

**Decisions:**

- **Commit identity.** A skill or agent commit is an owner action on the owner's branch, so it uses
  the owner's git identity. A missing identity gives `git_failed` with "set user.name and
  user.email". Hooks are off (`SAFE_GIT_CONFIG`) and nothing is pushed.
- **Unmanaged front-matter keys are kept as they are, for both kinds.** For agents, "the app writes
  no other keys" is read as: the app never adds any, and a hand-written key is kept verbatim. Such
  keys are reported as "kept as is, not used by the app". Skills keep keys like `allowed-tools`
  silently.
- **`tools` format.** It is written in Claude Code's comma form (`tools: Read, Grep`). An empty list
  is written as `tools: []`, and "All tools" (null) omits the key. The reader accepts the comma,
  flow and block forms.
- **Delete.** Deleting a skill removes `SKILL.md`, and then its folder only when the folder is
  empty. Deleting an agent removes only its file; `.claude/agents` stays.
- **Projects at the home folder.** A project whose `.claude` is the owner's `~/.claude` (registered
  at home, or inside `~/.claude`) is refused (`unsafe_path`) before any read or write.
- **Addresses.** A skill has an address, `#/p/:id/skills/:name`. The Agents tab is
  `…/skills?tab=agents`. An agent's editor has no address of its own, because R-A's router has no
  item route for agents.
- **Stage mapping.** None on this page. R-B owns it, and skills only show "Used by" chips.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

## Completion report — R-D

1. **Summary.** R-D adds project skills (`.claude/skills/<slug>/SKILL.md`) and agent definitions
   (`.claude/agents/<slug>.md`), which the app writes under ADR-0018 and its amendment.
   - **Server:** one shared, path-safe file core, with typed refusals, git state and commits of only
     that file; the skills and agents routes are wired into the app. The Skills & Agents page has
     two tabs, each with a list, New/Edit with templates and a Markdown preview, Save, Commit and
     Delete. It is plugged into the shell.

2. **Files changed.**
   - **Server, created:**
     - `packages/server/src/skills/{paths,store,service,agents,frontmatter,errors,index}.ts`;
     - `src/routes/skills.ts` and `src/routes/agents.ts`;
     - `tests/skills/{frontmatter,service,routes,agents,server}.test.ts` and
       `tests/skills/helpers.ts`.
   - **Server, modified (wiring):** `src/app.ts` and `src/bootstrap.ts`.
   - **Web, created:**
     - `packages/web/src/features/skills/{SkillsPage,SkillList,SkillEditor,AgentList,AgentEditor,editor-parts,bits,markdown}.tsx`;
     - `features/skills/{actions,templates,agent-templates}.ts`;
     - `tests/features/{skills,agents}.test.tsx` and `tests/fixtures/skills.ts`;
     - `e2e/skills.spec.ts`.
   - **Web, modified:**
     - `src/lib/api.ts`: add-only sections, plus `ApiClient.delete`;
     - `src/lib/copy.ts`: add-only sections, plus the nav label;
     - `src/app/App.tsx` (the route case) and `src/app/project-pages.ts` (`available`);
     - `tests/app/shell.test.tsx`, `tests/features/palette.test.tsx` and `tests/lib/api.test.ts`;
     - `e2e/playwright.config.ts`.
   - **Docs:** `docs/redesign/wp/R-D.md`.

3. **Commands and actual results** (final tree, rebased on main `ad81df0`):
   - `pnpm check` exits 0: format ✓, lint ✓, typecheck ✓, build ✓, and 1895/1895 tests:

     | Package      | Tests |
     | ------------ | ----: |
     | core         |   246 |
     | demo         |    12 |
     | orchestrator |   424 |
     | claude-code  |   283 |
     | db           |   159 |
     | web          |   392 |
     | server       |   379 |

   - `ACP_E2E_PORT=7951 ACP_E2E_CONTROL_PORT=7961 pnpm --filter @acp/web test:e2e`: 27/27 passed,
     including skills 3/3.
   - Screenshots were taken with `ACP_SCREENSHOT_DIR` (scratchpad, not committed), light and dark at
     1440 and 1024: list, edit, preview, empty, agents-list, agent-edit and agent-new.

4. **Acceptance criteria.**
   - **Service: list with front matter, problems as sentences, `usedBy`, `uncommitted` and
     `lastCommittedAt`; get; create, update and delete per ADR-0018 §3:** met. Tests are in
     `service.test.ts`.
   - **Delete refused while a stage uses the skill:** met (`skill_in_use`, through `startServer` with
     R-G's saved workflow too).
   - **Commit refuses other staged files; `add`/`commit -m "chore(skills|agents): <verb> <slug>"`,
     argv only, never pushed; returns the commit and branch:** met. This also works for a subfolder
     project.
   - **Routes (201/204), CSRF on mutations, DTO-parsed responses, typed refusals:** met, for skills
     and agents.
   - **Security tests:** met. They cover:
     - a symlinked `.claude`, `.claude/skills`, `.claude/agents`, slug folder and file;
     - `..`, uppercase and slashed names;
     - oversize files, including multibyte text;
     - staged unrelated files;
     - delete while in use;
     - nothing outside the target is touched;
     - a missing CSRF token gives 403;
     - the personal `~/.claude` is refused.
   - **No file contents logged:** met. A test checks the logs.
   - **Agents (amendment): `<slug>.md`, front matter name, description, tools and model only, other
     keys reported, the `chore(agents)` message:** met (`agents.test.ts`).
   - **Page:**
     - a list with Used by, Uncommitted, last committed and problems: met;
     - New and Edit with templates and a preview: met;
     - Save and Commit with an explanation: met;
     - Delete confirmed, and disabled while in use: met;
     - the "No skills yet" empty state: met;
     - the Agents tab with tool chips and "All tools", the model, and three templates: met.
   - **Shell wiring:** met (`#/p/:id/skills[/:name]`, `?tab=agents`, `available: true`).
   - **Component tests:** met (16, with fixture DTOs).
   - **Playwright with `page.route` and screenshots in both themes at both widths:** met. I reviewed
     the screenshots and fixed four things: the New-agent button placement, the delete buttons'
     danger colour, the template picker folded away on existing files, and a width cap on new
     forms.

5. **Assumptions** (recorded under Decisions above):
   - commits use the owner's identity;
   - hand-written front-matter keys are kept;
   - the `tools` format;
   - the delete scope;
   - projects at the home folder are refused;
   - an agent's editor has no address of its own.

6. **Contract or shared-file changes needed:** none to `@acp/core`. The shared-file changes I made
   are listed under the handoff notes, each in its own commit.

7. **Known gaps and follow-ups:**
   - `skill-names.ts` could reuse `listSkillFolders` (the coordinator decides);
   - the agent editor has no URL;
   - there is no live "uncommitted" refresh when files change outside the app (it refreshes after
     each action and on load);
   - mapping stages to agent definitions is a later decision (amendment);
   - in the screenshots, the sidebar can show a hover highlight that the mouse leaves behind after a
     viewport change (test artefact, not page state).

8. **Next recommended task:** R-B (the Workflow page) can use
   `GET /api/projects/:id/skills` and `…/agents` for its pickers and its "available, not mapped"
   list. Then R-V should cover a real Save and Commit of a skill in a throwaway repository.
