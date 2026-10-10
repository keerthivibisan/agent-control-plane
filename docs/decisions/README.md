# Architecture decision records

An ADR records a decision that is costly to reverse or that constrains other work packages. Agents must
not make such decisions on their own. They propose an ADR (status `proposed`), and the coordinator
accepts or rejects it. Copy [0000-template.md](0000-template.md).

| ADR                                                 | Title                                                      | Status      |
| --------------------------------------------------- | ---------------------------------------------------------- | ----------- |
| [0001](0001-pnpm-workspace-and-toolchain.md)        | pnpm workspace and pinned toolchain                        | accepted    |
| [0002](0002-modular-monolith.md)                    | Modular monolith with enforced dependency directions       | accepted    |
| [0003](0003-sqlite-local-first.md)                  | SQLite via better-sqlite3 for the local-first MVP          | accepted    |
| [0004](0004-provider-adapter-abstraction.md)        | Provider adapter abstraction; observation vs managed modes | accepted    |
| [0005](0005-transcript-and-hook-ingestion.md)       | Transcripts as source of record; hooks as live channel     | accepted    |
| [0006](0006-usage-deduplication.md)                 | Usage deduplication and cumulative snapshots               | accepted    |
| [0007](0007-event-provenance-and-demo-isolation.md) | Event provenance and demo-data isolation                   | accepted    |
| [0008](0008-session-vs-agent-run-identity.md)       | Session vs AgentRun identity; subagents are sessions       | accepted    |
| [0009](0009-content-minimization.md)                | No conversation content persisted in Phase 1               | accepted    |
| [0010](0010-license.md)                             | MIT license (provisional)                                  | provisional |
