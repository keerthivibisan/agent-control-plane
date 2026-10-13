# Agent Control Plane

**One control plane for every coding agent.** Agent Control Plane is an open-source, local-first
application for observing, orchestrating, and improving AI-assisted software development. The first
provider is Claude Code. Codex support will follow through a separate adapter.

> **Status: Phase 1 (session observability) is done and verified on real data. Phase 3 milestone M1
> (the control panel for managed Claude agents) is done and passed a real smoke run.** CI has not run
> yet (nothing is pushed).
>
> **Implemented and tested** (1,315 unit and integration tests, plus 11 browser end-to-end tests):
>
> - observing Claude Code sessions: discovery, incremental reading, usage accounting with dedup,
>   subagent and fork relationships, hooks (optional);
> - the server: ingestion pipeline, REST API, live updates, hook receiver, in demo and live mode;
> - the web UI in plain language: Overview, Sessions with a family tree, session detail, Tokens,
>   Projects, Setup and Data health;
> - **Control panel** (`#/control`): chat with a lead Claude agent that starts up to 3 helper agents,
>   each in its own git worktree; you approve every edit or command, review each diff and merge or
>   discard. Budgets, Stop and Stop all, safe restarts.
>
> See [HANDOFF.md](HANDOFF.md) and [docs/implementation-plan.md](docs/implementation-plan.md).

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

| Feature                                                                                                                              | Phase | Status                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------- |
| Core contracts (events, usage, sessions, provenance, adapter interface)                                                              | 0     | **implemented**                                                   |
| Project registration, Claude Code session discovery, subagent tree, usage accounting, Command Center, Session Explorer, live updates | 1     | **in progress** (server and demo mode done; live adapter pending) |
| Usage reliability, cost estimation with provenance, restart recovery                                                                 | 2     | planned                                                           |
| Managed orchestration (planning, at most 3 children, budgets, worktrees, validation)                                                 | 3     | planned                                                           |
| Harness Lab                                                                                                                          | 4     | planned                                                           |
| Codex adapter                                                                                                                        | 5     | planned                                                           |
| Evidence-driven recommendations                                                                                                      | 6     | research                                                          |

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

`pnpm check` runs format check, lint, typecheck, tests, and build. Details are in
[docs/development.md](docs/development.md).

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
