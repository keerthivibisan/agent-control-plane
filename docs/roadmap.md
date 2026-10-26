# Roadmap

Each phase starts only after the previous phase's acceptance criteria pass. Task-level detail for the
early phases is in [implementation-plan.md](implementation-plan.md).

**Releases:** v0.0.1 (2026-10-17), v0.1.0 (2026-10-17), v0.2.0 (2026-10-21): editable workflow
graphs per project ([docs/workflow-graph/README.md](workflow-graph/README.md), ADR-0023), and
v0.3.0 (2026-10-25): GitHub and branching, a pull-request-like ticket page, attachments and agent
notes, the harness in the workflow, session names and a GitHub-like look
([docs/v0.3.0/README.md](v0.3.0/README.md), ADR-0024 to ADR-0027). See
[CHANGELOG.md](../CHANGELOG.md).

| Phase                               | Scope                                                                                                                                                                                                                                                                      | Status                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **0 — Bootstrap**                   | repo, toolchain, CI, core contracts v1, specs, ADRs, agent rules                                                                                                                                                                                                           | **done**                      |
| **1 — Session observability**       | project registration, Claude Code observation adapter, pipeline, SQLite, sessions/edges/usage, Command Center, Session Explorer, usage summaries, SSE                                                                                                                      | **done**                      |
| 2 — Usage reliability & recovery    | source-missing detection, stale reconciliation, capability reporting in the UI, versioned pricing table and cost estimation with provenance, optional OTel ingestion as a second usage source, purge and retention                                                         | planned                       |
| 3 — Managed orchestration           | tasks, runs, planning, adaptive delegation (at most 3 children, depth 1), budget manager, worktree isolation, cancellation, result aggregation, validation runner, Orchestration Studio                                                                                    | **M1 done** (2026-10-13)      |
| **4 — Agent workspace**             | Jira-like board per project, tickets with plan-first runs, project creation and AI work environment setup, harness manifest and checks before merge, configurable agent tree (≤ 6 helpers, depth ≤ 2), per-project allowlist ([docs/phase-4/README.md](phase-4/README.md)) | **done** (v0.1.0, 2026-10-17) |
| 5 — Harness Lab                     | harness experiments: baseline vs harness-assisted runs, repeated trials, comparisons with variance                                                                                                                                                                         | planned                       |
| 6 — Codex adapter                   | `packages/adapters/codex` against Codex's supported app-server interface; contract tests                                                                                                                                                                                   | planned                       |
| 7 — Evidence-driven recommendations | recommendations with evidence and measurable acceptance criteria; approval before applying                                                                                                                                                                                 | research                      |

## Feasibility notes (preliminary estimates, 2026-10-10 — not guarantees)

- **Phase 1:** high. Every required field was seen in local data.
- **Phase 2:** feasible. The main risk is that the transcript format is internal and changes between
  versions.
- **Phase 3:** feasible but much harder. The hard parts are plan quality, merge conflicts, and
  budget semantics.
- **Phase 5 (Harness Lab):** needs many repeated runs per variant to produce statistically meaningful results.
- **Phase 7 (recommendations):** a research problem.

## Open questions

| ID  | Question                             | Needed by | Notes                                              |
| --- | ------------------------------------ | --------- | -------------------------------------------------- |
| Q1  | Budget metric for orchestration runs | Phase 3   | **resolved:** ADR-0014 (output + new input tokens) |

| Q2 | Managed-execution interface: Agent SDK vs `claude -p` stream-json | Phase 3 | **resolved:** ADR-0012 (Claude Agent SDK) |
| Q3 | Does a `cost-state` snapshot include subagent and auxiliary usage? | P1-F | determines the snapshot `scope`; cross-check in usage-accounting §8 |
| Q4 | Hook availability on each runtime version in use (2.1.202–2.1.293 seen) | P1-C | capture real payloads |
| Q5 | Nested subagents (`spawnDepth > 1`): how parent identity appears | P1-C | not seen locally |
| Q6 | Final license | before the first public release | **resolved:** MIT accepted (ADR-0010) |
| Q7 | Should OTel become the primary usage source? | Phase 2 | documented and stable, but needs user env configuration |
| Q8 | Which session is the origin when fork copies share timestamps? | Phase 2 | the adapter could report transcript file creation time; needs an ADR |
