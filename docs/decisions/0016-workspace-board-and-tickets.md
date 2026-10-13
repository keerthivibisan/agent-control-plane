# ADR-0016: The Agent Workspace board — tickets, plan-first runs

- **Status:** accepted (project owner, 2026-10-13)
- **Date:** 2026-10-13
- **Amends:** ADR-0009 and ADR-0015 (what text is stored)

## Context

Phase 3 M1 runs agents from a single control-panel chat. The owner wants work organised like a
Jira board: many projects, tickets per project, and each ticket worked by agents with the owner's
approval of a plan first (docs/phase-4/README.md).

## Decision

- **Internal board only.** Tickets live in the local SQLite database. There is no Jira or other
  external sync and no new network traffic (AGENTS.md §3.8 unchanged).
- **1 ticket = 1 run.** Starting a ticket creates a Phase 3 orchestration run with `ticketId`. A
  ticket can be re-run; earlier runs stay in its history.
- **Plan first.** Runs of tickets start in `PLANNING`. The lead reads the code (read-only) and calls
  `submit_plan`; the run moves to `PLAN_REVIEW`. The owner approves (→ `RUNNING`) or requests changes
  with a comment (→ `PLANNING`, comment sent to the lead, a new plan version follows). `start_agent`
  is refused with `plan_not_approved` until a plan is approved. Plans are versioned.
- **Board columns are derived,** never stored: `ticketStage(ticket, run)` in `@acp/core`
  (README §6.2). The stored ticket status is only `BACKLOG | READY | ACTIVE | DONE | CANCELLED`.
- **Stored text (amends ADR-0009/0015):** ticket titles and descriptions, owner comments, the lead's
  plans and its comments to the owner. Worker conversation content, thinking and tool input/output
  are still never stored.
- **Tickets are cancelled, never deleted.** A project with tickets cannot be removed from the app
  (409); its folder is never deleted.

## Consequences

`RunStatus` gains `PLANNING` and `PLAN_REVIEW`; `OrchestrationRun` gains `ticketId`; the lead tool
set gains `submit_plan`. Phase 3 control-panel runs (no ticket) keep working unchanged.
