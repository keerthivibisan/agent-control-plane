# R-D — Skills & Agents: server module and page

> Progress file for R-D. Only the agent working on R-D edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7. Scope grew on 2026-10-16 to agent definition files (ADR-0018 amendment).

| Field   | Value            |
| ------- | ---------------- |
| Status  | in-progress      |
| Owner   | full-stack agent |
| Branch  | `wp/r-d-skills`  |
| Started | 2026-10-16       |
| Updated | 2026-10-16       |

## Work log (append-only; newest last)

Commit hashes are the current ones after the rebases onto main `59c56c4`, `c81e2f2` and `ecc58d0`.

| Date       | What was done                                                                                                                                                                                                                       | Commit    | Checks                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| 2026-10-16 | Claimed R-D. Read ADR-0018, redesign §4.3 and §7, the skill contracts and the server git helpers. Paused by the coordinator before any code.                                                                                        | `4130035` | docs only; format:check ✓                            |
| 2026-10-16 | Resumed and rebased on main `4261740`. Server module `src/skills/**` (front matter, ADR-0018 path layer, service, typed refusals) and 26 security and flow tests.                                                                   | `ab32bf8` | format ✓ lint ✓ typecheck ✓ test 1687/1687 ✓ build ✓ |
| 2026-10-16 | Router `routes/skills.ts` (`createSkillsRouter`) and 4 supertest tests: the full flow, CSRF 403 on every mutation, typed refusals, not_a_git_repo.                                                                                  | `60fb201` | format ✓ lint ✓ typecheck ✓ test 1691/1691 ✓ build ✓ |
| 2026-10-16 | Shared-file addition: `ApiClient.delete` for 204 responses in `lib/api.ts`, with 3 tests.                                                                                                                                           | `f7b2d40` | format ✓ lint ✓ typecheck ✓ test 1694/1694 ✓ build ✓ |
| 2026-10-16 | Rebased on main `59c56c4` (R-G part 1). Refuse a project whose `.claude` is the owner's `~/.claude` (home-folder project), with a test.                                                                                             | `dd1e1cd` | format ✓ lint ✓ typecheck ✓ test 1721/1721 ✓ build ✓ |
| 2026-10-16 | Wiring commit: skills router in `app.ts`, service in `bootstrap.ts` with `workflowOf` = R-G's `workflowFor`; a startServer test.                                                                                                    | `ea04ff8` | format ✓ lint ✓ typecheck ✓ test 1721/1721 ✓ build ✓ |
| 2026-10-16 | Web: Skills section in `lib/api.ts` and `lib/copy.ts`; `features/skills/**` (list, editor, templates, Markdown preview, Commit, Delete); 9 component tests.                                                                         | `7fb2035` | format ✓ lint ✓ typecheck ✓ test 1730/1730 ✓ build ✓ |
| 2026-10-16 | Rebased on main `c81e2f2` (R-A merged). Skills page plugged into the shell: the `ProjectScreen` case, `available: true`, the address follows the open skill; R-A's shell and palette tests updated; 2 tests.                        | `f5ff03c` | format ✓ lint ✓ typecheck ✓ test 1765/1765 ✓ build ✓ |
| 2026-10-16 | Rebased on main `ecc58d0` (agent files added to scope). Server: shared `FileTarget` and `store.ts` core; `agents.ts`; `routes/agents.ts`; 10 agents tests (format, flows, symlinked `.claude/agents` and file, `..`, staged, home). | `6b6e5f0` | format ✓ lint ✓ typecheck ✓ test 1851/1851 ✓ build ✓ |
| 2026-10-16 | Wiring commit: agents router in `app.ts`, service in `bootstrap.ts`; the startServer test covers agents.                                                                                                                            | `5b08511` | format ✓ lint ✓ typecheck ✓ test 1851/1851 ✓ build ✓ |
| 2026-10-16 | WIP (paused): web agents groundwork (api and copy sections, shared `editor-parts.tsx`, the nav label "Skills & Agents").                                                                                                            | `86fb1f8` | not checked (see Paused (2))                         |

## Handoff notes

### Paused (2) (2026-10-16)

**Done and checked:**

- **Server (complete).**
  - Skills and agents share `src/skills/paths.ts` (`FileTarget`, the ADR-0018 §3 rules, never
    `~/.claude`) and `src/skills/store.ts` (read, atomic write, git state, the staged-files refusal,
    `chore(<skills|agents>): <verb> <slug>`).
  - `service.ts` handles skills, with the "used by" delete guard. `agents.ts` handles agents: other
    front-matter keys are kept and reported as "kept as is, not used by the app".
  - Routes are `routes/skills.ts` and `routes/agents.ts`. Both are mounted in `app.ts` and
    `bootstrap.ts`.
- **Web, Skills (complete and in the shell).** The Skills page (list, New/Edit with templates and
  preview, Save, Commit, Delete with the in-use guard), `#/p/:id/skills[/:name]`, and
  `available: true`.

**In the WIP commit `86fb1f8` (not checked):**

- `lib/api.ts`: the agents section (`agentsPaths`, `agentsSchemas`, `isAgentsPath`, `createAgent`,
  `updateAgent`, `deleteAgent`, `commitAgent`) and a shared `controlDelete`.
- `lib/copy.ts`:
  - `AGENTS_COPY`;
  - `SKILLS_COPY.page` with the title "Skills & Agents" and the tab labels;
  - `csrf_*` refusal words;
  - `SHELL_COPY.nav.pages.skills` changed to "Skills & Agents".
- `features/skills/editor-parts.tsx`: `TemplatePicker`, `InstructionsField` and `FileSide`, shared
  by both editors. `SkillEditor` already uses them.
- `useSkillAction(projectId, fn, scope?)`: the cache scope that is refetched afterwards.
- `RefusalNotice` takes a `refusals` map.

**Open problem:** the nav-label change breaks the tests that find the link by "Skills":

- `tests/features/skills.test.tsx` ("opens from the sidebar address");
- probably `tests/app/shell.test.tsx` (`navLink('Skills')`).

Update them to "Skills & Agents", or revert the label in `SHELL_COPY.nav.pages`.

**Next steps (the agent-files web scope), in order:**

1. In `features/skills/actions.ts`, add `AgentForm` (`name`, `description`, `tools: string[] |
null`, `model: string`, `instructions`), `agentFileBytes` and `validateAgentForm`. Validation
   covers the slug, a required description, tool names (`AgentToolNameSchema`, at most 50), a model
   of at most 100 characters, and the 64 KiB cap.
2. Add `features/skills/agent-templates.ts` with code reviewer (`reviewer`: Read, Grep, Glob),
   test writer (`test-writer`: Read, Grep, Glob, Edit, Write, Bash) and planner (`planner`: Read,
   Grep, Glob). Each gets a short description and instructions.
3. Add `features/skills/AgentList.tsx`. Cards show the name, the description, tools chips (or "All
   tools"), the model (or "Default model"), the Uncommitted badge, last committed, and problems.
   The empty state offers the templates.
4. Add `features/skills/AgentEditor.tsx`, modelled on `SkillEditor`:
   - name, description, and an "All tools" checkbox (null);
   - a chip input with Enter to add, × to remove, and quick-add buttons for common tools;
   - model, with suggestions sonnet, opus, haiku and inherit;
   - `InstructionsField`, Save, and `FileSide` with `commitAgent`, `deleteAgent`, `isAgentsPath`,
     `AGENTS_COPY`, and no `usedBy`.
5. In `SkillsPage.tsx`, add two tabs (`role="tablist"`): Skills and Agents. Make the tab state a
   prop from `App` (`route.params.get('tab')`), and navigate with
   `href.projectPage(projectId, 'skills', { tab: 'agents' })`. Agents edit state stays inside the
   page (no route). Show `AGENTS_COPY.page.intro` on the Agents tab. **No stage mapping** (R-B owns
   it).
6. Tests: agents component tests (list, New from a template, tools chips and "All tools" sending
   `null`, Save, Commit, Delete, the other-keys problem) and the tab switch. Fix the nav-label
   tests.
7. Run `pnpm check`, commit, and fold or reword the WIP commit.
8. Add an e2e spec `packages/web/e2e/skills.spec.ts` with `page.route` fixtures for
   `/api/projects/:id/skills*` and `/agents*`, plus a `skills` project in `e2e/playwright.config.ts`
   on the demo server. Run `ACP_E2E_PORT=7951 ACP_E2E_CONTROL_PORT=7961 ACP_SCREENSHOT_DIR=<scratch>
pnpm --filter @acp/web test:e2e`. Take screenshots light and dark at 1440 and 1024, and look at
   them.
9. Write the §9 report and set the status to `review`.

**Decisions recorded:**

- Commits use the owner's git identity. A missing identity is a `git_failed` with a plain message.
- Agent files keep hand-written keys verbatim. "Writes no other keys" means the app never adds
  them.
- `tools: []` is written as `tools: []`, and null omits the key.
- Delete removes an empty skill folder but never `.claude/agents`.
- `src/workflow/skill-names.ts` (R-G) can call `listSkillFolders` from `src/skills/index.ts`; this
  is left to the coordinator.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
