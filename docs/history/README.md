# History: how this app was built with coding agents

Agent Control Plane was built mostly by AI coding agents (Claude Code), working in parallel git
worktrees under a coordinating agent, with a human owner making every product decision and merging
every release. Each series of work had a plan, split into work packages (WPs) with owned paths,
tests and a definition of done. The plans are kept here **for provenance**: they explain why the
code looks the way it does, and code comments, migrations and ADRs still cite their sections.

They are not maintained. Where a plan and a spec or ADR disagree, the spec or ADR wins. For the
current design start at [docs/README.md](../README.md).

## The plans

| Series                       | Released in | Plan                                                                                   | What it built                                                                                                    |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Phases 0–3 (P0, P1-_, P3-_)  | v0.0.1      | [phase-1-3/implementation-plan.md](phase-1-3/implementation-plan.md)                   | bootstrap, session observability, the first managed runs (the control panel)                                     |
| Phase 4 (P4-*)               | v0.0.1      | [phase-4/README.md](phase-4/README.md)                                                 | the Agent Workspace: projects, the board, tickets with plan-first runs, the harness                              |
| Redesign (R-*)               | v0.0.1      | [redesign/README.md](redesign/README.md)                                               | the project-first UI, Workflow, Skills, Harness and Tokens pages; planner, reviewer and tester roles             |
| UI refresh (U-*)             | v0.1.0      | [ui-refresh/README.md](ui-refresh/README.md), [brand brief](ui-refresh/brand-brief.md) | a visual refresh and the Control Core brand                                                                      |
| Review loop (RL-*)           | v0.1.0      | [review-loop/README.md](review-loop/README.md)                                         | approval modes, the review loop, the ticket branch, Full auto                                                    |
| Workflow graphs (WG-*)       | v0.2.0      | [workflow-graph/README.md](workflow-graph/README.md)                                   | editable workflow graphs per project                                                                             |
| v0.3.0 (S, G, C, D, H, F, T) | v0.3.0      | [v0.3.0/README.md](v0.3.0/README.md)                                                   | session names, GitHub and branching, the ticket page, attachments, the harness in the workflow, the branch guard |

[v0.3.0/wp/T-1.md](v0.3.0/wp/T-1.md) and [v0.3.0/wp/F-2.md](v0.3.0/wp/F-2.md) are kept as the
record behind [the adversarial test suite](../testing/adversarial.md). The current release's plan is
in [docs/v0.3.1/](../v0.3.1/README.md).

## Old paths

Code comments and SQL migrations still cite the old locations. Applied migrations are never edited,
so read the old path through this table:

| Old path                        | Now                                             |
| ------------------------------- | ----------------------------------------------- |
| `docs/implementation-plan.md`   | `docs/history/phase-1-3/implementation-plan.md` |
| `docs/phase-4/README.md`        | `docs/history/phase-4/README.md`                |
| `docs/redesign/README.md`       | `docs/history/redesign/README.md`               |
| `docs/ui-refresh/README.md`     | `docs/history/ui-refresh/README.md`             |
| `docs/review-loop/README.md`    | `docs/history/review-loop/README.md`            |
| `docs/workflow-graph/README.md` | `docs/history/workflow-graph/README.md`         |
| `docs/v0.3.0/README.md`         | `docs/history/v0.3.0/README.md`                 |

The series' status logs (`STATUS.md`), their per-WP progress files (`wp/*.md`), the v0.2.0 resume
note (`docs/workflow-graph/RESUME.md`) and the coordinator's `HANDOFF.md` were removed in v0.3.1.
They were only meaningful to the private coordination setup. Every one of them is still in git at
tag `v0.3.0`, for example:

```bash
git show v0.3.0:docs/review-loop/STATUS.md
```

```bash
git show v0.3.0:docs/workflow-graph/wp/WG-V.md
```

## What the process looked like

- **One WP per agent, one worktree per WP.** Branches were named `wp/<id>-<slug>`; an agent edited
  only the paths its WP owned. Shared files (root configs, the lockfile, the v1 contracts,
  migrations, ADRs) changed only through the coordinator.
- **A progress file per WP**, edited only by its agent, with a log line at every checkpoint, so a
  paused or crashed agent could be resumed by another without repeating work.
- **Checks at every checkpoint.** Every commit carried a `Checks:` line with the real results of
  `pnpm check`.
- **Decisions as ADRs.** Anything costly to reverse became an ADR in
  [docs/decisions/](../decisions/README.md), accepted by the owner before code was written.
- **Real runs only with consent.** Fake agents drive the tests; each real run against Claude Code
  was approved by the owner in chat, used throwaway folders, and is written up with aggregates only
  in [docs/research/](../research/).

The rules the agents followed are today's [AGENTS.md](../../AGENTS.md), trimmed for outside
contributors.
