# Scenario 15 (usage-accounting scenario 10): unparseable complete lines

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** a complete line that is not JSON, a JSON array, and an assistant record without `message.id` are skipped and counted (`parseErrors: 3` on the checkpoint); the lines after them are still read.
