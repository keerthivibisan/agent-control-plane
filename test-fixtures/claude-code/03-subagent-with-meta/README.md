# Scenario 3: subagent with meta and a matching Agent tool use

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** the meta file yields `subagent.spawned` (child `(S1, afake0301)`, `spawnToolUseId` `toolu_fake0301`), the parent transcript yields `tool.called` with the same id, and the subagent transcript yields events with `providerAgentId: afake0301`.
