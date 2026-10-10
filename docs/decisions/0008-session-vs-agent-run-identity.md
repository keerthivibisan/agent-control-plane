# ADR-0008: Session vs AgentRun identity; subagents are sessions

- **Status:** accepted
- **Date:** 2026-10-10

## Context

Most sessions are started outside the control plane. Orchestration (Phase 3) schedules agent runs that
may use one or more provider sessions. Claude Code subagents share the parent's `sessionId` and are
distinguished by `agentId`, with their own transcript and metadata files.

## Decision

- A `Session` is provider-created and observed. An `AgentRun` is control-plane-scheduled (Phase 3).
  They are linked through `AgentRunSession`. Ids are never shared.
- Session identity is `(provider, providerSessionId, providerAgentId)`. Subagents are sessions with
  `providerAgentId` set. Top-level sessions use `null` (stored as `''`).
- Parent-child relationships are `SessionEdge` rows with mandatory evidence. A session with no edge has
  parent **unknown**.

## Alternatives considered

- Treating a subagent as an event within its parent session: loses per-subagent usage, status, and
  model, which the Session Explorer needs.
- A parent column on sessions: cannot carry evidence or distinguish edge kinds.

## Consequences

- The tree, aggregation, and UI work on edges, so the Phase 3 agent-run tree can be shown alongside
  the session tree without remodeling.
