# ADR-0013: Execution and guardrail policy for managed runs

- **Status:** accepted (project owner, 2026-10-11)
- **Date:** 2026-10-11
- **Amends:** AGENTS.md §3.8 ("no shell execution from any input"), for Phase 3 managed runs only

## Context

Phase 1 never executed anything. Phase 3 must start agents that edit code and may run commands. The
model may plan, but must never be trusted to enforce its own limits (orchestration-lifecycle §1).

## Decision

The engine (`@acp/orchestrator`) and server enforce, and tests prove:

1. **Processes.** Only two binaries ever run: `git` through `execFile` with argument arrays, and the
   `claude` process the Agent SDK spawns. Text from the chat, the model, or any file never reaches a
   shell or a command line.
2. **Workspaces.** Agents run only for registered projects. Each worker gets its own `git worktree`
   under `<ACP_DATA_DIR>/worktrees/<run>/<agent>` on branch `acp/<run>/<agent>`. The lead runs
   read-only in the project root. The owner's working tree is never written by an agent.
3. **Limits.** At most 3 concurrent workers, delegation depth 1, a per-agent budget (ADR-0014), a run
   timeout, Stop and Stop all (abort, then kill after a grace period).
4. **Approvals.** Read-only tools (Read, Glob, Grep, and the lead's own tools) are allowed. Every
   other tool use (edits, writes, shell commands, web access) creates an Approval shown in the panel
   with a short redacted summary (tool name and target, max 200 characters). Approve or Deny; no
   answer within `APPROVAL_TIMEOUT_MS` means deny.
5. **Review before merge.** Agent changes stay on their branches. The panel shows the diff and changed
   files; the owner clicks Merge (only into a clean base branch; otherwise refused with a reason) or
   Discard. Nothing merges automatically.
6. **Local only.** 127.0.0.1, the existing local-only guard, plus a per-page CSRF token
   (`X-ACP-CSRF`, from `GET /api/control/token`) on every mutating control-panel route.
7. **Restart.** Live work interrupted by a restart becomes `NEEDS_REVIEW`; it is never relaunched
   automatically.
   (ADR-0020: an owner chat message may resume an ended lead for one read-only follow-up turn. That
   is an owner action, never an automatic relaunch.)

## Consequences

AGENTS.md §3.8 now reads "no shell execution from any input; Phase 3 managed runs follow ADR-0013".
Every guardrail has a refusal test (a 4th worker, a project outside the registered roots, an
over-budget agent, a non-read-only tool without approval, a merge into a dirty base).

## Amendment (project owner, 2026-10-13, Phase 4)

- **Configurable limits.** Each project's agent setup chooses `maxConcurrentHelpers` (1–6) and
  `maxDepth` (1–2); hard ceilings `HARD_MAX_HELPERS = 6`, `HARD_MAX_DEPTH = 2` in `@acp/core`. Defaults
  stay 3 helpers, depth 1. At depth 2 a helper can start, message and stop its own children only;
  Stop all stops descendants first; budgets roll up for display but stay per agent.
- **Per-project allowlist** (pre-approved safe actions; everything else still asks):
  - `editInOwnWorktree`: Edit/Write/MultiEdit/NotebookEdit auto-approved when the target resolves
    (realpath, no symlink escape) inside the agent's own worktree;
  - `runHarnessChecks`: a Bash call auto-approved only when its command string exactly equals one of
    the harness checks' argv joined by single spaces, with no shell metacharacters.
    Auto-approvals are recorded as approvals with `decidedBy: allowlist`.
- **Checks** are a third allowed process kind, under ADR-0017's execution policy.
