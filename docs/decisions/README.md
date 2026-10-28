# Architecture decision records

An ADR records a decision that is costly to reverse or that constrains other work packages. Agents must
not make such decisions on their own. They propose an ADR (status `proposed`), and the coordinator
accepts or rejects it. Copy [0000-template.md](0000-template.md).

| ADR                                                        | Title                                                          | Status   |
| ---------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-pnpm-workspace-and-toolchain.md)               | pnpm workspace and pinned toolchain                            | accepted |
| [0002](0002-modular-monolith.md)                           | Modular monolith with enforced dependency directions           | accepted |
| [0003](0003-sqlite-local-first.md)                         | SQLite via better-sqlite3 for the local-first MVP              | accepted |
| [0004](0004-provider-adapter-abstraction.md)               | Provider adapter abstraction; observation vs managed modes     | accepted |
| [0005](0005-transcript-and-hook-ingestion.md)              | Transcripts as source of record; hooks as live channel         | accepted |
| [0006](0006-usage-deduplication.md)                        | Usage deduplication and cumulative snapshots                   | accepted |
| [0007](0007-event-provenance-and-demo-isolation.md)        | Event provenance and demo-data isolation                       | accepted |
| [0008](0008-session-vs-agent-run-identity.md)              | Session vs AgentRun identity; subagents are sessions           | accepted |
| [0009](0009-content-minimization.md)                       | No conversation content persisted in Phase 1                   | accepted |
| [0010](0010-license.md)                                    | MIT license                                                    | accepted |
| [0011](0011-adapter-diagnostics.md)                        | Adapters report their own diagnostics                          | accepted |
| [0012](0012-managed-execution-agent-sdk.md)                | Managed execution through the Claude Agent SDK                 | accepted |
| [0013](0013-managed-execution-guardrails.md)               | Execution and guardrail policy for managed runs                | accepted |
| [0014](0014-orchestration-budget-metric.md)                | Budget metric for managed runs                                 | accepted |
| [0015](0015-orchestrator-chat-storage.md)                  | Store the orchestrator chat locally                            | accepted |
| [0016](0016-workspace-board-and-tickets.md)                | The Agent Workspace board: tickets, plan-first runs            | accepted |
| [0017](0017-project-creation-harness-and-checks.md)        | Project creation, the harness manifest, and running checks     | accepted |
| [0018](0018-project-skills-written-by-the-app.md)          | Project skills written by the app                              | accepted |
| [0019](0019-workflow-stages-and-roles.md)                  | Workflow stages and the planner, reviewer and tester roles     | accepted |
| [0020](0020-resume-the-lead-chat.md)                       | Resume the lead's chat on an owner message                     | accepted |
| [0021](0021-approval-modes-review-loop-ticket-branch.md)   | Approval modes, the review loop and the ticket branch          | accepted |
| [0022](0022-full-auto-mode.md)                             | Full auto mode                                                 | accepted |
| [0023](0023-editable-workflow-graphs.md)                   | Editable workflow graphs                                       | accepted |
| [0024](0024-session-names-and-run-summaries.md)            | Session names and run summary comments                         | accepted |
| [0025](0025-code-hosting-and-branching.md)                 | Code hosting (GitHub) and branching strategies                 | accepted |
| [0026](0026-comments-conversation-and-attachments.md)      | Comments, Conversation and attachments                         | accepted |
| [0027](0027-harness-setup-and-check-blocks.md)             | Harness setup steps and check blocks in the workflow graph     | accepted |
| [0028](0028-agent-effort-optional-checks-finish-block.md)  | Effort per agent, optional Checks blocks, one Finish block     | accepted |
| [0029](0029-owner-rework-after-restart.md)                 | The owner may send a change back for rework after a restart    | proposed |
| [0030](0030-conflict-resolution-and-delegated-delivery.md) | Conflict resolution, adaptive verification, delegated delivery | proposed |
