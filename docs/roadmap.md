# Roadmap

Where the project stands and what comes next. Nothing listed as planned is built, even partially
(AGENTS.md §1). Ideas outside this list are welcome as issues; larger ones need an ADR first.

## Releases

| Release | Date       | Highlights                                                                                                                                                                         |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.0.1  | 2026-10-17 | session observability, projects, the board, plan-first ticket runs, harness checks, the Workflow and Skills pages, token usage                                                     |
| v0.1.0  | 2026-10-17 | the review loop and the ticket branch, approval modes and Full auto, the new look and brand                                                                                        |
| v0.2.0  | 2026-10-21 | editable workflow graphs per project (ADR-0023)                                                                                                                                    |
| v0.3.0  | 2026-10-25 | GitHub and branching strategies, a pull-request-like ticket page, attachments and agent notes, the harness in the workflow, session names, the branch guard (ADR-0024 to ADR-0027) |
| v0.3.1  | 2026-10-26 | effort per agent, optional Checks blocks, one Finish block, easier linking in the Workflow editor, runs no longer end while waiting for you (ADR-0028; [plan](v0.3.1/README.md))   |
| v0.4.0  | merged     | conflict recovery and delivery policies, no-change ticket actions, knowledge-transfer guide and manual Pages workflow ([release scope](releases/0.4.0.md))                         |

Rework after a server restart (ADR-0029; [Q-series plan](v0.3.2/README.md)) is in development
after the merged 0.4.0 release. The earlier version assignment in that plan is historical.

Details: [CHANGELOG.md](../CHANGELOG.md). The plans of the earlier series are in
[history/](history/README.md).

## Phases

| Phase                               | Scope                                                                                                                                                                                                                | Status                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **0 — Bootstrap**                   | repo, toolchain, CI, core contracts v1, specs, ADRs, agent rules                                                                                                                                                     | **done**                                         |
| **1 — Session observability**       | project registration, the Claude Code observation adapter, pipeline, SQLite, sessions, edges and usage, live updates                                                                                                 | **done**                                         |
| 2 — Usage reliability & recovery    | source-missing detection, stale reconciliation, capability reporting in the UI, a versioned pricing table and cost estimation with provenance, optional OTel ingestion as a second usage source, purge and retention | planned                                          |
| **3 — Managed orchestration**       | runs, a lead and helpers over the Claude Agent SDK, budgets, worktree isolation, cancellation, owner review                                                                                                          | **done** (M1); carried on by Phase 4             |
| **4 — Agent workspace**             | the board per project, tickets with plan-first runs, project setup, the harness and checks, the agent tree (≤ 6 helpers, depth ≤ 2), the review loop, workflow graphs, GitHub                                        | **done** (v0.0.1 to v0.3.0), improving in v0.3.x |
| 5 — Harness Lab                     | harness experiments: baseline vs harness-assisted runs, repeated trials, comparisons with variance                                                                                                                   | planned                                          |
| 6 — Codex adapter                   | `packages/adapters/codex` against Codex's supported app-server interface; contract tests                                                                                                                             | planned                                          |
| 7 — Evidence-driven recommendations | recommendations with evidence and measurable acceptance criteria; approval before applying                                                                                                                           | research                                         |

Phase 3's validation runner (P3-G) was replaced by the Phase 4 harness checks.

## Feasibility notes (preliminary estimates, 2026-10-10, not guarantees)

- **Phase 2:** feasible. The main risk is that the transcript format is internal and changes between
  Claude Code versions.
- **Phase 5 (Harness Lab):** needs many repeated runs per variant to produce statistically
  meaningful results.
- **Phase 7 (recommendations):** a research problem.

## Open questions

| ID  | Question                                                                | Needed by                       | Notes                                                                |
| --- | ----------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| Q1  | Budget metric for orchestration runs                                    | Phase 3                         | **resolved:** ADR-0014 (output + new input tokens)                   |
| Q2  | Managed-execution interface: Agent SDK vs `claude -p` stream-json       | Phase 3                         | **resolved:** ADR-0012 (Claude Agent SDK)                            |
| Q3  | Does a `cost-state` snapshot include subagent and auxiliary usage?      | P1-F                            | determines the snapshot `scope`; cross-check in usage-accounting §8  |
| Q4  | Hook availability on each runtime version in use (2.1.202–2.1.293 seen) | P1-C                            | hooks verified on 2.1.296; `Notification` not observed               |
| Q5  | Nested subagents (`spawnDepth > 1`): how parent identity appears        | P1-C                            | not seen locally                                                     |
| Q6  | Final license                                                           | before the first public release | **resolved:** MIT (ADR-0010)                                         |
| Q7  | Should OTel become the primary usage source?                            | Phase 2                         | documented and stable, but needs user environment configuration      |
| Q8  | Which session is the origin when fork copies share timestamps?          | Phase 2                         | the adapter could report transcript file creation time; needs an ADR |
