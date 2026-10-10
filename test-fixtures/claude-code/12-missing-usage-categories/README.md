# Scenario 12: missing usage categories

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** absent, `null`, negative, fractional, or non-numeric token fields map to `null` (unavailable), never 0. An assistant line without `usage` yields no `usage.reported` at all.
