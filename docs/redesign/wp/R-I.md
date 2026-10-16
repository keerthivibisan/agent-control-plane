# R-I — Stage agent files (backend: engine, server, adapter)

> Progress file for the backend part of R-I. Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope:
> `docs/redesign/README.md` §6a; spec: ADR-0019 §6 (amendment) and the ADR-0018 amendment. The web
> part (stage picker, chips, missing-file warning) is a separate agent on its own branch.

| Field   | Value                |
| ------- | -------------------- |
| Status  | review               |
| Owner   | backend agent        |
| Branch  | `wp/r-i-agent-files` |
| Started | 2026-10-16           |
| Updated | 2026-10-16           |

Owned paths: `packages/orchestrator/**`, `packages/server/**`, `packages/adapters/claude-code/**`,
their tests, this file.

## Tasks

- [x] 1. Engine: the stage's agent-file name on the `start-agent` effect; model precedence
      (stage > file > project > provider default) as a pure, tested helper
- [x] 2. Server: read and parse `<project root>/.claude/agents/<name>.md` from the owner's checkout
      with R-D's module; build `spec.profile`; missing/unsafe/oversize/unparsable → no profile,
      counted diagnostic, run not blocked; workflow PUT/GET round-trip `agent`
- [x] 3. Adapter: profile instructions appended to the system prompt; tools narrowed with the SDK
      `tools` base set and the gate; never widened; `allowedTools` never set
- [x] 4. Docs: `docs/provider-adapters.md` managed execution; proposed README text here

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                   | Commit    | Checks                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------- |
| 2026-10-16 | Claimed R-I (backend) on the branch                                                                                             | `0afe89c` | docs only                                         |
| 2026-10-16 | Engine: `agent` on `start-agent`, `stageAgentFor`, `resolveAgentModel`                                                          | `e6c4029` | pnpm check ✓: test 1,962/1,962 (orchestrator 430) |
| 2026-10-16 | Server: agent file read from the checkout (R-D path rules) → `spec.profile`; model precedence; counted `agent-file-unavailable` | `fdde056` | pnpm check ✓: test 1,978/1,978 (server 399)       |
| 2026-10-16 | Adapter: profile instructions in the system prompt; `tools` base set + gate narrow only; provider-adapters §11.1                | `248c6ca` | pnpm check ✓: test 1,995/1,995 (claude-code 300)  |
| 2026-10-16 | Rebased on `main` (`bb41899`); handoff notes and completion report; status `review`                                             | (this)    | pnpm check ✓: test 1,995/1,995                    |

## Handoff notes

### Decisions made (within the spec)

- **How the file's model reaches the engine (task 1):** the engine stays pure and never reads
  files. It keeps putting only an explicit stage model on `start-agent.model` (absent when the
  stage has none) and adds the file's name as `start-agent.agent`. The server reads the file and
  resolves the model with the engine's pure `resolveAgentModel({ stage, agentFile, project })`:
  stage > agent file > project default > null (provider default); a blank value counts as no
  choice. So the precedence lives (and is tested) in `@acp/orchestrator`, and the I/O in the
  server.
- **Which file a lead uses:** an agent gets at most one file (`stageAgentFor`). In `lead` planner
  mode the lead covers plan and orchestrate, so it uses the orchestrate stage's file, else the
  plan stage's (the same order as `stageModelFor`). An explicit model on either of its stages
  still beats the file's model.
- **Reading the file (task 2):** `packages/server/src/workflow/agent-profile.ts` uses R-D's
  `skills/paths.ts` (`realRoot`, `refusePersonalClaudeDir`, `agentTarget`, `readTargetFile`: lstat
  at every level, `O_NOFOLLOW`, 64 KiB cap, UTF-8 only) and `skills/frontmatter.ts`
  `parseAgentFile`. It always reads `project.rootPath` (the owner's checkout), for helpers and the
  tester too, never their worktree or the reviewer's checkout. Only the body, `model` (trimmed,
  at most 100 characters) and `tools` (valid `AgentToolNameSchema` names; invalid entries are
  dropped, which only narrows) are used.
- **Unparsable = any front-matter problem.** A file with no or an unclosed front matter, or any
  parser problem (duplicate key, nested value, block scalar, …), gets no profile at all, so a
  misread line can never change what `tools` means. The Skills & Agents page already shows those
  problems to the owner.
- **Failure handling:** problem codes `invalid-name`, `missing`, `unsafe`, `too-large`,
  `not-text`, `unparsable`, `unreadable`. Any of them: the agent starts without a profile (the
  role's normal tools, the stage or project model), `counters.diagnostics['agent-file-unavailable']`
  is incremented, and one warn line `project agent file unavailable` carries `runId`,
  `agentRunId`, `agentFile` (the slug, schema-checked, not free text) and `problem`. Never the
  file's contents.
- **Tools (task 3), `profileToolNames`:** the SDK `tools` base set is the file's built-in names
  (anything starting `mcp__` is dropped), minus `READ_ONLY_DISALLOWED_TOOLS` for the planner and
  reviewer, plus `Skill` exactly when the run has a skills plugin (a file-listed `Skill` without
  a plugin is dropped: skills come only from the stage mapping). For the lead and workers the
  role allows every built-in (the lead's tool uses are still denied by the server), so the file's
  list is the intersection. `[]` disables all built-ins. The gate denies a built-in not in the
  list with "This stage's agent file does not list this tool." before the in-folder read rule;
  `Task` and `Agent` count as one tool. `disallowedTools` for read-only roles is unchanged;
  `allowedTools` is never set; null `tools` leaves the options and the gate exactly as before.
- **System prompt:** preset `claude_code`; `append` = project context (at most 32 KiB), a blank
  line, then `=== Stage agent file .claude/agents/<name>.md (the owner's instructions for this
stage) ===` and the body (at most 64 KiB). Blank instructions add nothing.
- **Workflow routes:** PUT/GET round-trip `agent` (absent, null or a slug) with no migration; the
  workflow is JSON in `project_workflow` and the run snapshot in `orchestration_runs.limits`, both
  parsed with `ProjectWorkflowSchema`. A mapped file that does not exist is accepted (like
  skills). An invalid slug is a 400.
- **Missing-file problem on the Workflow page:** `ProjectWorkflowDto` lists only `skills`, and
  `@acp/core/api` is not mine, so no DTO field was added. The web part can already flag a missing
  file from `GET /api/projects/:id/agents` (the names, plus each file's `problems`, which include
  the front-matter problems that make the server skip a file). See proposal 1 below for a server
  field if the coordinator prefers it.
- `skills/agents.ts`: only its stale header comment changed ("not mapped to workflow stages
  yet"). Deleting an agent file that a stage uses is not guarded (a missing file never blocks a
  run).

### Proposed doc text (coordinator-owned files)

For `docs/redesign/README.md` §6a, the Engine, Server and Adapter rows:

> **Done (R-I backend, `wp/r-i-agent-files`):** the engine names the stage's file on
> `start-agent` (`agent`) and resolves the model stage > file > project; the server reads the
> file from the owner's checkout under ADR-0018's path rules and builds `profile` (a missing,
> unsafe, oversize or unparsable file starts the agent without one, counted as
> `agent-file-unavailable`); the adapter appends the instructions and narrows built-in tools with
> the SDK `tools` base set and the gate, never `allowedTools`.

For `docs/redesign/STATUS.md`: R-I backend → `review` on `wp/r-i-agent-files`.

## Blockers / proposed contract changes

None blocking. Optional, not made (coordinator decision):

1. **`ProjectWorkflowDto.agents: SkillName[]`** (the project's agent-file names, like `skills`),
   so the Workflow page can flag a mapped file that is gone from the same response.
   - Why: one request instead of the extra `GET /api/projects/:id/agents`.
   - Diff (`packages/core/src/api/redesign.ts`): next to `skills: z.array(SkillNameSchema),` add
     `agents: z.array(SkillNameSchema).default([]),`; the server's `workflow/service.ts` `dto()`
     would add `(await listAgentFiles(await realRoot(p.rootPath))).names`.
   - Affects: core api, the server workflow service, the web Workflow page (R-I web).
2. **`AgentDefinitionSummaryDto.usedBy: WorkflowStageId[]`** (like skills), from core's
   `stagesUsingAgent`, for "Used by" chips on the Skills & Agents page. The web can compute it
   from the workflow today.

## Completion report (AGENTS.md §9)

## Completion report — R-I (backend)

1. **Summary:** a workflow stage's project agent file now applies to that stage's agent. The
   engine names it on `start-agent`, with the model precedence stage > file > project. The server
   reads it safely from the owner's checkout and builds `ManagedAgentSpec.profile`, never blocking
   the run. The adapter appends its instructions to the system prompt and narrows built-in tools
   with the SDK `tools` base set and the gate, never widening and never using `allowedTools`.
2. **Files changed:**
   - created: `packages/server/src/workflow/agent-profile.ts`,
     `packages/server/tests/workflow/agent-profile.test.ts`,
     `packages/adapters/claude-code/tests/managed/profile.test.ts`, this file;
   - modified: `packages/orchestrator/src/{stages,state,index}.ts`,
     `packages/orchestrator/tests/{workflow.test,workflow-helpers}.ts`,
     `packages/server/src/control/service.ts`, `packages/server/src/skills/agents.ts` (comment),
     `packages/server/tests/board/helpers.ts`,
     `packages/server/tests/workflow/{stages,routes}.test.ts`,
     `packages/adapters/claude-code/src/managed/{adapter,permissions,index}.ts`,
     `docs/provider-adapters.md` (§11.1).
3. **Commands run and actual results** (worktree root, Node 22.21.1, pnpm 10.26.1, after the
   rebase on `main` `bb41899`): `pnpm check` exit 0: format:check ✓, lint ✓, typecheck ✓,
   build ✓; tests 1,995 passed (core 247, demo 12, orchestrator 430, claude-code 300, db 168,
   web 439, server 399).
4. **Acceptance criteria:**
   - Engine: agent-file name on `start-agent` next to `skills`: **met** (workflow.test.ts: lead,
     planner and worker; lead and separate mode choice).
   - Model precedence stage > file > project > provider default: **met** (`resolveAgentModel`
     unit test; server tests: file over project, stage over file, project when the file is
     unusable, null with nothing set).
   - No agent file = unchanged behaviour: **met** (absent and null give an identical effect; no
     `profile`; adapter null tools unchanged for every role; all existing tests pass).
   - Server reads from the owner's checkout with R-D's path rules, never a worktree: **met** (a
     helper gets the owner's uncommitted copy while its worktree holds the committed one;
     symlinked file, folder and `.claude`, the personal `~/.claude`, oversize and non-UTF-8
     files are refused).
   - Only body, model and tools used; other keys ignored: **met** (`permissionMode`,
     `mcpServers`, `hooks` absent from the profile).
   - Missing, unsafe, oversize or unparsable → starts without a profile, counted, logged without
     content, run not blocked: **met** (stages.test.ts: diagnostic count, log fields, the body
     text never in the logs, the lead's plan still submitted).
   - Workflow PUT/GET round-trip `agent`, no migration: **met** (routes.test.ts).
   - Missing-file problem exposed where the stage skill problems are: **partly met**. No server
     DTO field can carry it without a contract change; the existing agents route already gives
     the web what it needs (proposal 1).
   - Adapter: instructions appended after the context, preset kept, capped and labelled: **met**.
   - Tools narrowed, never widened (a reviewer whose file lists Bash and Edit stays read-only);
     `Skill` with a plugin; the gate denies an unlisted built-in (new message); `mcp__acp__*`
     kept; null unchanged; `allowedTools` never set: **met** (profile.test.ts).
5. **Assumptions:** see "Decisions made": unparsable means any front-matter problem; the lead
   uses the orchestrate file first; `Skill` only with a plugin; MCP entries in `tools` are
   dropped; `Task` and `Agent` are one tool in the gate. Recorded here and in
   `docs/provider-adapters.md` §11.1.
6. **Contract or shared-file changes needed:** none required. Two optional DTO fields are
   proposed above (not made).
7. **Known gaps / follow-ups:**
   - Unverified until the R-V real smoke run (owner consent): the init message's tool list
     matches the `tools` base set; `Task` in `tools` enables `Agent` on current CLIs; the profile
     text reaches the system prompt.
   - `server/src/workflow/{skill-files,skill-names,skills-plugin}.ts` still duplicate R-D's path
     rules (noted in R-H too); the new agent-profile reader uses R-D's module directly.
   - Deleting an agent file a stage uses is not refused (skills are); a later guard could reuse
     `stagesUsingAgent`.
8. **Next recommended task:** merge with R-I web, then R-V (browser e2e and the consented smoke
   run that checks skills, agent files and the read-only roles' tool limits).
