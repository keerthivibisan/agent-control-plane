# Orchestration lifecycle (Phase 3 design — NOT IMPLEMENTED)

> Nothing in this document exists in code. It records the intended design so that Phase 1 avoids
> decisions that block it. Phase 3 starts with an ADR that confirms or revises it. **Do not implement
> any of this during Phase 1.**

## 1. Principles

- The LLM plans and recommends. **The engine enforces** concurrency, budgets, permissions, workspace
  isolation, cancellation, and validation. The model is never trusted to enforce its own limits.
- Success means the integrated result passes its required validation checks. A successful child does
  not mean the run succeeded.
- Every state transition is persisted before it is published.

## 2. Run state machine

```mermaid
stateDiagram-v2
  [*] --> QUEUED
  QUEUED --> PLANNING
  PLANNING --> POLICY_CHECK
  POLICY_CHECK --> WAITING_APPROVAL: needs approval
  POLICY_CHECK --> PLANNING: plan rejected (revise once)
  POLICY_CHECK --> RUNNING_PARENT: single-agent plan
  POLICY_CHECK --> RUNNING_CHILDREN: delegated plan
  WAITING_APPROVAL --> RUNNING_PARENT
  WAITING_APPROVAL --> RUNNING_CHILDREN
  WAITING_APPROVAL --> CANCELLED
  RUNNING_PARENT --> VALIDATING
  RUNNING_CHILDREN --> INTEGRATING
  INTEGRATING --> VALIDATING
  INTEGRATING --> NEEDS_REVIEW: unresolved conflict
  VALIDATING --> COMPLETED: all required checks pass
  VALIDATING --> RUNNING_PARENT: one bounded repair cycle
  VALIDATING --> FAILED
  RUNNING_PARENT --> BLOCKED: budget soft limit / missing decision
  RUNNING_CHILDREN --> BLOCKED
  BLOCKED --> RUNNING_PARENT
  BLOCKED --> CANCELLING
  QUEUED --> CANCELLING
  PLANNING --> CANCELLING
  RUNNING_PARENT --> CANCELLING
  RUNNING_CHILDREN --> CANCELLING
  INTEGRATING --> CANCELLING
  VALIDATING --> CANCELLING
  CANCELLING --> CANCELLED
  RUNNING_PARENT --> TIMED_OUT
  RUNNING_CHILDREN --> TIMED_OUT
```

Guarantees:

- Cancellation first stops new scheduling, then aborts active work (the Agent SDK uses
  `AbortController`). Cancelling a parent cancels its children.
- After a restart the engine resumes from persisted state. It **never automatically relaunches**
  non-idempotent agent work; it marks that work `NEEDS_REVIEW` instead.
- A missing heartbeat never implies success.

## 3. Structured plan (validated before execution)

Required fields:

- summary;
- strategy (`single` | `delegated`) and the rationale;
- child tasks, each with id, role, objective, expected outputs, read/write scope, and dependencies;
- integration strategy;
- validation strategy.

The engine rejects a plan that has:

- more than 3 children;
- a delegation depth above 1;
- a dependency cycle;
- overlapping write scopes without isolation;
- missing required fields.

## 4. Budget (open question Q1 — must be resolved before Phase 3)

The draft brief proposes a 50,000-token soft budget per run. **Local data shows cache-read tokens in the
billions for long sessions.** A single turn re-reads the full context. A budget that counts cache reads
would be used up almost at once. Options to decide by ADR, using Phase 1 and 2 measurements:

1. Budget output plus uncached input tokens. Track cache reads separately.
2. Budget estimated USD from a versioned pricing table (all categories priced correctly).
3. Separate per-category limits.

Whichever option is chosen, the budget is a _soft_ limit. Calls already in flight may overshoot, and
the overshoot is reported.

## 5. Workspace isolation

- Each concurrent child that can write gets its own `git worktree`. Exploration agents get read-only
  workspaces where feasible.
- The main workspace stays protected during parallel work.
- The engine collects a patch and a changed-file manifest from each child. It detects overlapping
  files and integrates deliberately.
- Final validation runs on the integrated tree.

## 6. Provider-internal subagents

A parent may use Claude Code's own subagents. The engine **observes** them through the Phase 1
observation pipeline (subagent edges, usage), but does not claim to control them.
