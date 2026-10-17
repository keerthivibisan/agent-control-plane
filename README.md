<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/control-plane-logo-on-dark.svg">
    <img src="docs/brand/control-plane-logo.svg" alt="Agent Control Plane" width="390">
  </picture>
</p>

# Agent Control Plane

**One control plane for every coding agent.** Agent Control Plane is an open-source, local-first
application for observing, orchestrating, and improving AI-assisted software development. The first
provider is Claude Code. Codex support will follow through a separate adapter.

> **Status: v0.1.0 (preview).** Session monitoring, projects and tickets with managed agent runs,
> approval modes, a review loop on a ticket branch, the workflow, skills and agent files, harness
> checks and token reports are implemented and verified. The latest real runs against Claude Code
> passed on 2026-10-17 ([docs/research/rl-v-real-run-2026-10-17.md](docs/research/rl-v-real-run-2026-10-17.md)).
>
> **Implemented and tested** (about 2,500 unit and integration tests, plus 60 browser end-to-end
> tests):
>
> - **Observing Claude Code sessions:**
>   - discovery and incremental reading;
>   - usage accounting with dedup by message id;
>   - subagent and fork relationships;
>   - optional hooks.
> - **A workspace per project in the browser:**
>   - **Board** of tickets;
>   - **Workflow:** the fixed stages, each with its own model, skill and agent file;
>   - **Skills & Agents:** edit `.claude/skills` and `.claude/agents` files, then commit them;
>   - **Harness** checks;
>   - **Tokens:** new work vs cache reuse;
>   - **Sessions**, **Settings** and **Data health**.
> - **Managed runs per ticket:**
>   1. A planner proposes a plan, and you approve it or ask for changes. Approving it creates the
>      ticket's own branch (`acp/<KEY>`).
>   2. A lead starts helper agents for the plan's steps, each in its own git worktree.
>   3. Approval modes per project, changeable per run: **Manual** (everything asks), **Auto edits**
>      (edits in the helper's own worktree and exact harness checks run unasked; the default for
>      new projects) or **Auto** (plus a command allowlist). Auto-approved requests show the rule.
>   4. Each finished change is reviewed (by a read-only review agent, or the lead). The lead merges
>      it into the ticket branch once the required checks pass, sends it back for rework (2 rounds
>      by default), discards it, or asks you.
>   5. An optional read-only code reviewer and a unit-test writer run on the ticket branch. Then you
>      merge the ticket branch into main once (or merge anyway with a reason, request changes, or
>      discard it).
>   6. After a run ends, you can still ask its lead questions (answers only).
> - **Guardrails:** every role has a fixed tool set; budgets, Stop and Stop all, and safe restarts
>   apply throughout.
> - **Local only:** the server binds 127.0.0.1, and no conversation content is stored except the
>   owner's chat with the lead (ADR-0015) and the plans, reviewer findings and lead notes kept as
>   ticket comments (ADR-0016, ADR-0021). Diffs and tool output are never stored.
>
> See [CHANGELOG.md](CHANGELOG.md), [docs/redesign/README.md](docs/redesign/README.md) and
> [docs/implementation-plan.md](docs/implementation-plan.md).

## The problem

Developers now run many coding-agent sessions across many repositories: terminals, the desktop app,
IDEs, and subagents spawned by other agents. It is hard to answer basic questions:

- Which sessions are active, which project do they belong to, and what are they doing?
- Which agent spawned which subagent?
- How many input, output, and cache tokens did each session use, without double-counting?
- Did the work actually pass validation?

## Goals

- **Observe**: discover sessions, show parent-child relationships, track status and usage.
  Every number is labeled observed, derived, estimated, or unavailable.
- **Orchestrate** (later): delegate tasks to agents within enforced limits, isolate workspaces, and
  validate the integrated result.
- **Improve** (later): compare harness configurations with reproducible evidence.

## Non-goals (for now)

- Cloud hosting or multi-tenant deployment.
- Uploading any transcript, code, or credential.
- Distributed infrastructure.
- Cost figures presented as authoritative.
- Modifying your Claude Code settings.

## Principles

- **Local-first:**
  - the server binds to `127.0.0.1`;
  - data stays in `~/.agent-control-plane/`;
  - no telemetry.
- **Evidence over assumptions:**
  - an unknown parent stays unknown;
  - missing usage shows as _unavailable_, never 0.
- **Privacy:**
  - Phase 1 stores no conversation content, only ids, names, models, timestamps, and token counts;
  - credential files such as `~/.claude/sessions/` are never read.

See [docs/security.md](docs/security.md).

## Planned features

| Feature                                                                                                   | Phase | Status                    |
| --------------------------------------------------------------------------------------------------------- | ----- | ------------------------- |
| Core contracts (events, usage, sessions, provenance, adapter interface)                                   | 0     | **implemented**           |
| Session observability: discovery, subagent tree, usage accounting, live updates                           | 1     | **implemented, verified** |
| Usage reliability, pricing table, OpenTelemetry, purge                                                    | 2     | planned                   |
| Managed orchestration: lead and helpers, budgets, worktrees, approvals                                    | 3     | **M1 implemented**        |
| Agent workspace: board, tickets, plan-first runs, harness checks, workflow stages, skills and agent files | 4     | **implemented, verified** |
| Harness Lab                                                                                               | 5     | planned                   |
| Codex adapter                                                                                             | 6     | planned                   |
| Evidence-driven recommendations                                                                           | 7     | research                  |

See [docs/roadmap.md](docs/roadmap.md).

## Requirements

- Node.js **22.x, at least 22.12** (`.nvmrc`)
- pnpm **10.26.x**
- A C/C++ toolchain, which `better-sqlite3` may need to compile

## Development

```bash
nvm use
```

```bash
corepack enable
```

```bash
pnpm install
```

```bash
pnpm check
```

To run the app (server on 127.0.0.1:7420, web UI on http://127.0.0.1:5173):

```bash
pnpm dev
```

It reads your Claude Code data (`~/.claude/projects`) read-only. Set `ACP_MODE=demo` for sample
data in a separate database, or `ACP_MANAGED=off` to turn managed agents off.

`pnpm check` runs format check, lint, typecheck, tests, and build. Details are in
[docs/development.md](docs/development.md).

## Brand

The mark is the **Control Core**: a dominant centre square (the control plane), four smaller
square nodes at the corners (the managed agents) and straight diagonal connectors (coordination
and delegated work). The files are in [docs/brand/](docs/brand/) (the app serves the same files
from `packages/web/public/brand/`).

| File                             | Use                                                            |
| -------------------------------- | -------------------------------------------------------------- |
| `control-plane-logo.svg`         | primary: the mark and the AGENT CONTROL PLANE wordmark, light  |
| `control-plane-logo-on-dark.svg` | the same on dark backgrounds                                   |
| `control-plane-mark.svg`         | the symbol alone (navigation, avatar), lime centre, light      |
| `control-plane-mark-on-dark.svg` | the symbol on dark backgrounds                                 |
| `control-plane-*-mono-dark.svg`  | one color, graphite, for light backgrounds                     |
| `control-plane-*-mono-light.svg` | one color, ivory, for dark backgrounds                         |
| `favicon.svg`                    | the browser tab: a 16-pixel grid, follows the light/dark theme |

- **Colors:** graphite `#171717` and warm ivory `#F4F0E8` are the identity; signal lime
  `#D8FF64` is the accent, used as a fill (the logo's centre, primary buttons, active and selected
  markers), never as a large background and never as small text on ivory.
- **Fonts:** Inter for the interface and the wordmark (uppercase, semibold, tracked), JetBrains
  Mono for ids, keys and other technical labels. Both are bundled; nothing loads from a CDN. In
  the standalone SVGs the wordmark is live text in a system-safe stack (Inter, Helvetica Neue,
  Arial) whose width is fixed, so the lockup keeps its proportions with any of them.
- **Usage:** keep the mark square and undistorted, with clear space of at least one corner node
  around it; don't recolor it beyond the variants above, add effects, or use it as decoration.
  In the app, `BrandMark` and `BrandLogo` (`packages/web/src/components/BrandMark.tsx`) draw it
  from the theme's tokens.

## Documentation

- [Architecture](docs/architecture.md)
- [Domain model](docs/domain-model.md)
- [Event and usage accounting](docs/usage-accounting.md)
- [Provider adapters](docs/provider-adapters.md)
- [Orchestration lifecycle (Phase 3 design)](docs/orchestration-lifecycle.md)
- [Security model](docs/security.md)
- [Implementation plan](docs/implementation-plan.md)
- [Decision records](docs/decisions/README.md)
- [Research notes](docs/research/)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents must follow [AGENTS.md](AGENTS.md)
([CLAUDE.md](CLAUDE.md) for Claude Code).

## License

MIT (provisional; see [ADR-0010](docs/decisions/0010-license.md)).
