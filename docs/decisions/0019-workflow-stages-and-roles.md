# ADR-0019: Workflow stages and the planner, reviewer and tester roles

- **Status:** accepted — owner decision 2026-10-16 (docs/history/redesign/README.md §2, §4.2)
- **Date:** 2026-10-16

## Context

Phase 4 runs a ticket with one **lead** (plans, then starts helpers) and **workers** (helpers in their
own worktrees). The owner wants a visible, configurable flow with these stages:

1. plan;
2. orchestrate;
3. helpers (up to 3 or 4);
4. review and merge;
5. final code review;
6. unit tests.

Each agent stage can be mapped to a skill. The owner chose **fixed stages with options** over a
free-form graph editor.

## Decision

1. **Stages and order** (`WORKFLOW_STAGES`): `plan → orchestrate → helpers → review → code-review →
unit-tests`.
   - The first four always run, as in Phase 4.
   - `code-review` and `unit-tests` are off by default and switched on per project
     (`ProjectWorkflow`).
2. **Roles** (`AgentRoleKind`):
   - `lead` and `worker` are unchanged.
   - `planner`: read-only in the owner's tree, like the lead (ADR-0013 §2). It has only
     `submit_plan`, and it revises the plan on the owner's comments. Used when
     `plannerMode = 'separate'`.
     - In `separate` mode the lead starts only after approval, with the approved plan in its brief. It
       cannot change the plan.
     - In `lead` mode (the default) the lead plans and orchestrates, as in Phase 4.
   - `reviewer`: read-only. It reads the **merged** result on a temporary detached worktree of the main
     branch (the same mechanism as "Run checks now", ADR-0017). It has no edit or Bash tools. Its
     findings are posted as ticket comments (a new comment author, `reviewer`; ADR-0016's stored scope
     is widened to these comments). It never blocks or merges anything.
   - `tester`: a worker with its own worktree, started after the merge, with the brief "write unit
     tests for the merged change". Its change goes through the same review, checks and merge. Its
     allowlist and budget are the helpers'.
   - (Amended by ADR-0021 §3, §5: a `reviewer` can also review one helper's change before the lead
     decides (`submit_review`); the final code review and the tester work on the ticket branch tip
     before the owner's merge, not on the merged base branch.)
3. **Sequencing and limits.**
   - The ticket reaches **Done** only after every enabled stage has finished: the tester's change is
     merged, or discarded by the owner, and the reviewer has posted.
   - Limits come from `ProjectAgentSetup` (helpers ≤ `HARD_MAX_HELPERS`, depth ≤ 2, budget per agent).
     Reviewer and tester count as one helper each, against the same concurrency limit, and only after
     the helpers are done.
   - Stop and Stop all cover every stage.
   - (Amended by ADR-0021 §5: the final stages run while the run stays RUNNING and the lead stays
     live; the run reaches REVIEW for the owner's single merge only when no stage is left.)
4. **Skills.**
   - A stage with `skill` set has one line added to its agent's instructions: "Use the project skill
     `<name>`."
   - **How the skill reaches the agent (amended 2026-10-16, decision E).** Managed agents run with
     `settingSources: []`. That is deliberate: a project's checked-in `.claude/settings.json` could
     auto-approve tools before our `canUseTool` gate, because allow rules are evaluated before the
     callback. With `settingSources: []`, though, Claude Code loads **no** filesystem skills. Turning
     on the `project` source to get skills is rejected, because it brings settings, hooks and
     CLAUDE.md with it. The documented skills-only route is used instead (Agent SDK docs: Skills,
     Plugins):
     - At each agent start, the **server** builds a run-scoped plugin directory under the data dir:
       `runs/<runId>/skills-plugin/` with `.claude-plugin/plugin.json` (`{"name": "acp-skills"}`) and
       `skills/<name>/SKILL.md`.
       - Each file is a copy of the mapped skill from the **project's checkout**, never an agent
         worktree, so an agent's uncommitted skill edit can't change what runs. This matches the
         harness rule in ADR-0017.
       - The front matter is reduced to `name` and `description`, so a repo skill's `allowed-tools`
         (or anything else) cannot grant tools that skip our gate.
       - The directory has no `hooks/`, `.mcp.json`, `agents/` or settings.
     - The **adapter** passes `plugins: [{ type: 'local', path }]` and `skills: ['acp-skills:<name>']`,
       keeping `settingSources: []` and `permissionMode: 'default'`. The instruction line names
       `acp-skills:<name>`.
     - The server removes the directory with the run's other temporary files.
     - It must be verified in the R-V real smoke run (with the owner's consent) that the init message
       lists the skill and that the agent uses it.
   - A mapped skill that no longer exists is shown as a problem on the Workflow page. The agent starts
     without it, and the run is not blocked.
5. **Live state.** `RunWorkflowDto` reports each stage's state for the ticket page graph. It is derived
   from the run and agent statuses and never stored.

## Alternatives considered

- **A free-form graph editor.** More flexible, but an arbitrary graph cannot keep the plan-first, owner-
  gated and worktree-isolated guarantees without a much larger engine. The owner rejected this.
- **A reviewer that can block the merge.** It would make an agent's opinion a gate. Rejected: the owner
  merges, and the harness checks are the automated gate.

## Consequences

- Engine work (R-C): the new roles and transitions, the post-merge stages, and their refusals and
  tests. The adapter gives each role its toolset.
- Migration 0004 (R-G): `project_workflow`, `agent_runs.stage`, `approvals.decided_by`,
  `orchestration_runs.limits`, and the comment author `reviewer`.
- The default workflow equals Phase 4, so existing projects behave exactly as before until the owner
  changes their workflow.

## Amendment (2026-10-16): a stage uses one agent file

Owner decision A (docs/history/redesign/README.md §6a). WP R-I builds it.

6. **Stage agent files.**
   - Each agent stage (plan, orchestrate, helpers, code-review, unit-tests) may name one project
     agent file `.claude/agents/<name>.md` (`agent` in `ProjectWorkflow`; absent or null means none).
   - The **server** reads the file from the owner's project checkout under ADR-0018's path rules,
     never from an agent worktree, and builds `ManagedAgentSpec.profile`.
   - **Instructions:** the body is appended to the system prompt after the project context files.
   - **Model:** stage model > file model > project model > provider default.
   - **Tools only narrow** (docs/research/sdk-tool-narrowing-2026-10-16.md):
     - the adapter sets the SDK `tools` base set to the file's built-in tools, kept only where the
       role allows them, plus `Skill` when the run has a skills plugin;
     - read-only roles keep their `disallowedTools`;
     - the gate denies any built-in not in the list;
     - the role's `mcp__acp__*` control tools always stay;
     - `allowedTools` is never used, because it auto-approves;
     - a null `tools` list keeps the role's normal set.
   - **Ignored keys:** every other front-matter key (`permissionMode`, `hooks`, `mcpServers`,
     `skills`, `memory`, `initialPrompt`, …) is ignored, because several of them can widen
     permissions. Skills come only from the stage's skill mapping (§4).
   - **A missing, unsafe or unparsable file** is a problem on the Workflow page. The agent starts
     without a profile and the run is not blocked.
   - **Verification:** the R-V real smoke run (owner consent) checks the init message's tool list.

## Amendment (2026-10-16): a fixed tool base set per role

The R-V real run (docs/research/r-v-real-run-2026-10-16.md) showed what happens to a role without
an SDK `tools` base set. It gets every tool the local Claude Code install offers: 28–37 tools,
for example `SendMessage`, `CronCreate`, `RemoteTrigger`, `WebFetch` and `Task`. The lead also had
`Bash`, `Edit` and `Write`, held back only by the approval gate, although ADR-0013 §2 says it is
read-only. Owner decision (2026-10-16): fix it before v0.0.1 (WP R-K).

7. **Role toolsets.** Every managed agent gets an explicit SDK `tools` base set. An agent file
   (§6) and the follow-up turn (ADR-0020) can only narrow it.
   - **Base sets:**

     | Role           | Built-in tools                                  |
     | -------------- | ----------------------------------------------- |
     | lead, planner  | `Read`, `Grep`, `Glob`                          |
     | reviewer       | `Read`, `Grep`, `Glob`                          |
     | worker, tester | `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash` |
     | follow-up turn | `Read`, `Grep`, `Glob` (ADR-0020, as built)     |
     - The lead's control tools (`mcp__acp__*`) are unchanged.
     - `Skill` is added only when the run has a skills plugin.
     - `MultiEdit` and `NotebookEdit` are added only if the installed Claude Code still offers
       them as separate tools; check in `system/init`.

   - **Never in a base set:** `Task`/`Agent` (subagents), web tools, cron/scheduling, messaging
     (`SendMessage`, `ListAgents`), remote triggers, notifications, artifacts, worktree and
     plan-mode tools. Each needs its own decision.
   - **Skill gate:** the gate also denies a `Skill` call for any skill other than the run's
     `acp-skills:*` names, because bundled skills load even with `settingSources: []`.
   - **Kept as before:** read-only roles keep `disallowedTools`, and `allowedTools` is never used.
