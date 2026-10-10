# Scenario 16: session titles

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** `ai-title` gives `session.titled` with `titleSource: ai` and `custom-title` gives `titleSource: user`. Titles are redacted (the fake `sk-ant-…` key becomes `[REDACTED]`), whitespace-collapsed, and capped at 200 characters. A whitespace-only title yields no event, and a title record without a title field counts as a parse error. Title texts are neutral synthetic placeholders. The field names `customTitle` and `aiTitle` are **unverified**.
