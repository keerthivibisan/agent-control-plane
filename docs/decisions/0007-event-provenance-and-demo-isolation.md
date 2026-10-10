# ADR-0007: Event provenance and demo-data isolation

- **Status:** accepted
- **Date:** 2026-10-10

## Context

The product's value is trust in its numbers. The brief requires distinguishing observed, derived,
estimated, and unavailable data, and never mixing mock data into live metrics.

## Decision

- `Provenance = observed | derived | estimated | unavailable` (`@acp/core`).
  - `Sourced<T>` carries `null` for unavailable values. The schema rejects `unavailable` with a value.
  - Events are only `observed` or `derived`.
  - Provider-reported cost is always `estimated`.
- Every event carries a `SourceRef` (channel, provider version, path, byte offset, hook event) for
  audit.
- Demo data uses `provider: "demo"` and channel `demo`, and runs only with `ACP_MODE=demo` against a
  **separate database file**. The UI shows a persistent DEMO banner. Tests use temp databases.

## Alternatives considered

- A `isDemo` flag on rows in the live database: a single bad query would mix the data. Separate files
  make mixing impossible.

## Consequences

- API DTOs (P1-D0) must carry provenance for usage, cost, status, and parent relation. The UI must
  render it.
