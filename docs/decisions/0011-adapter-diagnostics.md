# ADR-0011: Adapters report their own diagnostics

- **Status:** accepted (project owner, 2026-10-10)
- **Date:** 2026-10-10

## Context

An adapter meets problems the core `Checkpoint` cannot describe: files skipped by the size cap,
symlink escapes, invalid subagent meta files, and record types it skips on purpose. The P1-F real-data
run also showed 12,601 `record.unrecognized` events for record types that are well known and simply
carry nothing the control plane uses, which drowns the diagnostics view.

## Decision

`ObservationAdapter` gains a required `diagnostics(): AdapterDiagnostics` with `fileIssues` (latest
scan, paths relative to the provider data root, no content), `ignoredRecords` (counts by record
type of known, deliberately skipped records) and `parseErrors`. Known no-use record types are counted
there instead of being emitted as `record.unrecognized`; only genuinely unknown types remain events.

## Alternatives considered

- An optional `lastError` on `Checkpoint`: one error per file, persisted, but no place for skipped
  record counts and it mixes read position with reporting.

## Consequences

Every adapter (demo, Claude Code, later Codex) implements `diagnostics()`. The server exposes it in
`GET /api/diagnostics/ingestion` (DTO change in `@acp/core/api`). The values are in-memory and reset
on restart; persisted per-file errors can be added later if needed.
