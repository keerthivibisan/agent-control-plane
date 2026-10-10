# Scenario 8 (usage-accounting scenario 11): unknown record types

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** every non-allowlisted record type becomes `record.unrecognized` with only `recordType`. The `bridge-session`, `artifact-autoreact-ledger`, and `artifact-comment-monitor` records carry fake account and organization ids and a fake `cwd` (`/home/user/never-read`); none of these values may appear in any event, and the never-read `cwd` must not become the session `cwd`. `system` records other than `api_error` are reported as `system:<subtype>`.
