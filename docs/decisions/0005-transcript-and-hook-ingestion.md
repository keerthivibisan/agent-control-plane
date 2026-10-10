# ADR-0005: Transcripts as source of record; hooks as live channel

- **Status:** accepted
- **Date:** 2026-10-10

## Context

- Transcripts hold the full message stream with per-message usage. They exist for every session,
  whether or not hooks are configured. Their format is documented as internal and changes between
  versions (16 versions seen locally).
- Hooks (including a documented `http` type) give live lifecycle signals: session start and end,
  subagent start and stop, notifications. They carry **no general token usage**, and they require
  changes to user settings.
- OpenTelemetry is documented and stable, but requires the user to configure environment variables.

## Decision

- **Transcripts are the source of record** for messages, tools, and usage. They are read through a
  strict file allowlist with incremental checkpoints.
- **Hooks are optional and additive.** They provide end-of-session evidence and trigger immediate
  transcript reads. They never produce usage.
- **The app never modifies Claude Code settings.** It prints a settings snippet; the user installs it.
- **OTel is deferred to Phase 2** as a candidate second usage source. It would also give visibility of
  auxiliary requests.

## Alternatives considered

- Hooks-only: no usage data, and blind to sessions started before installation.
- OTel-only: needs user environment configuration and gives no subagent tree. Usage is otherwise good.

## Consequences

- Parser drift is the main risk. It is mitigated by tolerant parsing, per-version unknown-type
  diagnostics, and fixtures for each version.
- Without hooks, sessions end as `stale`, not `ended`, which is the truthful answer.
