# Scenario 1: streaming duplicates

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** one `message.id` (`msg_fake0101`) is written on three lines (one per content block) with growing `output_tokens` 8 → 120 → 345. The adapter emits one `usage.reported` per line with the same `messageId` and distinct dedup keys; core selection (max output) picks 345.
