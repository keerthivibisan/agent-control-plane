# Scenario 13: hook payloads — synthetic values, shapes from a real capture

**Provenance:** synthetic values. The key sets and value types of `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `Stop`, and `CwdChanged` follow the shape-only capture from Claude Code **2.1.296** on 2026-10-11 (`docs/research/p1-c6-hook-capture-2026-10-11.md`); no captured value is used. All ids, paths, and text are fake; text is `<redacted>`. `effort.level` (`medium`) and the empty `background_tasks`/`session_crons` arrays are invented values for fields whose keys and types were observed.

**Proves:** one payload per subscribed hook event plus an unsubscribed `PreToolUse`, which normalizes to `[]`. Free-text fields (`last_assistant_message`, `message`, `title`, `tool_input`) are never copied. `Notification.json` and `PreToolUse.json` are **not** from the capture (Notification does not fire in `claude -p` runs; PreToolUse was not subscribed), so `notification_type` stays unverified.

The `transcript_path` values point at `/home/user/.claude/...`, which is outside the test's Claude data root, so they are ignored. Tests also rewrite them to this scenario's `projects/` to cover the allowlisted case.
