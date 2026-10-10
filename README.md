# Agent Control Plane

**One control plane for every coding agent.** Agent Control Plane is an open-source, local-first
application for observing, orchestrating, and improving AI-assisted software development. The first
provider is Claude Code. Codex support will follow through a separate adapter.

> **Status: Phase 1 in progress: all components are implemented; verification (P1-F) is under way.**
> `ACP_MODE=demo pnpm dev` runs on demo data. Live mode (the default) reads Claude Code transcripts for
> registered projects; it is tested against sanitized fixtures only and has not yet been checked
> against real data.
>
> **Implemented and tested** (617 tests):
>
> - core contracts and the usage-accounting logic;
> - SQLite persistence;
> - the demo adapter and the Claude Code adapter (discovery, incremental reader, record
>   normalizers, subagent metadata, hook normalization);
> - the server: ingestion pipeline, scheduler, REST API, SSE stream, hook receiver, and static UI
>   serving, in demo and live mode;
> - the web UI: Command Center, Session Explorer, session detail, usage analytics, and project page.
>
> **Remaining:** P1-F verification (reference recomputation, restart checks, browser e2e, and a
> real-data run with the user's consent). Real hook payloads have not been captured, so the hook field
> names are unverified (`pnpm --filter @acp/server hooks:snippet` prints the settings to paste).
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
