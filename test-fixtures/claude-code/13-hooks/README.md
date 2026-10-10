# Scenario 13: hook payloads — SYNTHETIC (real capture pending user approval)

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** one payload per subscribed hook event (`SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `Stop`, `Notification`, `CwdChanged`) plus an unsubscribed `PreToolUse`, which normalizes to `[]`. Built from the documented fields (common: `session_id`, `transcript_path`, `cwd`, `hook_event_name`); per-event fields such as `notification_type`, `old_cwd`, and `new_cwd` are **unverified**. Task C6 calls for capturing real payloads from runtime 2.1.263 with explicit user approval; that capture has not been done.

The `transcript_path` values point at `/home/user/.claude/...`, which is outside the test's Claude data root, so they are ignored. Tests also rewrite them to this scenario's `projects/` to cover the allowlisted case.
