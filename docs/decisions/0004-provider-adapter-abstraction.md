# ADR-0004: Provider adapter abstraction; observation vs managed modes

- **Status:** accepted
- **Date:** 2026-10-10

## Context

Claude Code and, later, Codex expose different runtime interfaces. Observation must work for sessions
the control plane did not start. Managed execution (Phase 3) launches work through a supported runtime
interface.

## Decision

- `@acp/core` defines `ObservationAdapter` and `ProviderCapabilities`
  (`packages/core/src/adapters/contract.ts`). Adapters translate provider data into
  `NormalizedEvent`s and report capabilities and limitations honestly.
- Observation mode (Phase 1) and managed execution mode (Phase 3) are **separate interfaces**. Phase
  1 declares `managedExecution: false`.
- Provider-specific fields live only in the adapter or in event payloads that are typed and
  provider-neutral. Core types, the database schema, and the UI must work without Claude-specific
  fields.
- A deterministic demo adapter implements the same contract for tests and labeled demo mode.

## Alternatives considered

- One combined adapter interface (the brief's illustrative `AgentProviderAdapter`): it forces
  observation-only providers to stub launch methods. Splitting the interfaces keeps Phase 1 honest.

## Consequences

- The Phase 3 ADR adds `ManagedExecutionAdapter`. The Codex adapter implements `ObservationAdapter`
  first.
