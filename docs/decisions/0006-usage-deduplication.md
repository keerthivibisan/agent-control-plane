# ADR-0006: Usage deduplication and cumulative snapshots

- **Status:** accepted
- **Date:** 2026-10-10

## Context

Local data (research note, 2026-10-10):

- 52% of assistant lines repeat a `message.id` in the same file, with `output_tokens` growing across
  repeats.
- 1,715 message ids are copied into other sessions' files by forks.
- `cost-state` records are cumulative running totals.

Naive summing would inflate usage by about 2×. "First line wins" would undercount output.

## Decision

- **Fact identity for usage is `(provider, messageId)`, global across files and sessions.**
- Selection: the observation with the greatest `output`. All categories come from that observation,
  and disagreement is flagged as a `conflict`.
- Attribution: the session with the earliest occurrence. Order-independent, recomputed as data arrives.
- `<synthetic>` model observations are excluded.
- Missing categories are `null` (unavailable). Sums preserve null when every value is null.
- Cumulative snapshots are a separate kind (`cumulative-snapshot`) in a separate table. They are
  **never summed** with anything.
- Phase 1 has exactly one usage channel (transcripts). Hook-reported usage is ignored.
- Full rules: docs/usage-accounting.md §5–§6.

## Alternatives considered

- Dedup per session: double-counts forks.
- Last line wins: equivalent in observed data, but max-output is robust to out-of-order reads.
- Trusting `cost-state` totals: scope unknown, present in only 20% of sessions.

## Consequences

- Usage for a fork's copied history appears under the original session. The UI must explain this
  ("inherited history").
- If the provider ever reuses message ids, this breaks. P1-C contract tests watch for it.
