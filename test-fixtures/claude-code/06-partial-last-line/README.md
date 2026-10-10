# Scenario 6: partial last line

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** the file ends in the middle of a record (no trailing newline). Only the three complete lines produce events; the checkpoint stops after the last `\n`, and the partial line is never parsed.
