# Scenario 10: cwd change within a session

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** the first `cwd` yields `session.observed`; moving into `packages/a` and later to `/home/user/elsewhere` yields two `session.cwd_changed` events. The session stays in the project of its first `cwd`.
