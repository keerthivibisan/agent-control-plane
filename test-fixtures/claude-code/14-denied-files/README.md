# Scenario 14: denied files next to allowed ones

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** only `projects/-home-user-project/<S1>.jsonl` is allowlisted. Every other file (peer `sessions/`, `*.key`, settings, `history.jsonl`, `memory/`, `tool-results/`, `custom-title.json`, and orphaned or superseded transcripts) must be ignored. The denied transcripts contain a session `c0ffee00-0000-4000-8000-000000000002` that must never appear in events. Symlink escapes are covered by temp-dir tests, since symlinks are not committed.
