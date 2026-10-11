# ADR-0009: No conversation content persisted in Phase 1

- **Status:** accepted
- **Date:** 2026-10-10

## Context

Transcripts contain prompts, model output, thinking, tool inputs and outputs, file contents, and
possibly secrets. Phase 1's questions (which sessions, how related, what status, how much usage) do not
need content.

## Decision

- Persist identifiers, names (tool names, agent types), models, timestamps, counts, and usage only.
- The free-text fields allowed are session titles, subagent `description`, and error kinds. They are
  redacted and length-capped.
- Record types not in the allowlist are stored as `record.unrecognized` with the type name only.
- "Show me what the agent said" is handled later by reading the source transcript **on demand**,
  without copying it into our database (Phase 2+, behind an ADR).

## Alternatives considered

- Storing raw records "for debugging": it duplicates sensitive data into a second store with different
  retention.

## Consequences

- Debugging parser issues relies on `source.path` and `byteOffset` pointing back to the original line.
- Result summaries in the Session Explorer are limited to tool names and counts until on-demand
  reading exists.

**Amended by ADR-0015 (2026-10-11):** the control-panel chat between the owner and the lead agent
(and worker task texts) is stored locally. Nothing else changes.
