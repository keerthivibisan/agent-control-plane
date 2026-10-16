# ADR-0019: Workflow stages and the planner, reviewer and tester roles

- **Status:** accepted — owner decision 2026-10-16 (docs/redesign/README.md §2, §4.2)
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
3. **Sequencing and limits.**
   - The ticket reaches **Done** only after every enabled stage has finished: the tester's change is
     merged, or discarded by the owner, and the reviewer has posted.
   - Limits come from `ProjectAgentSetup` (helpers ≤ `HARD_MAX_HELPERS`, depth ≤ 2, budget per agent).
     Reviewer and tester count as one helper each, against the same concurrency limit, and only after
     the helpers are done.
   - Stop and Stop all cover every stage.
4. **Skills.**
   - A stage with `skill` set has one line added to its agent's instructions: "Use the project skill
     `<name>`."
   - Claude Code resolves the skill from `.claude/skills` (ADR-0018).
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
