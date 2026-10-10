# Scenario 5: nested subagent (spawnDepth 2) — SYNTHETIC, not observed in real data

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** agent `afake0502` (`spawnDepth: 2`) was spawned by tool use `toolu_fake0511`, which appears as a `tool.called` event of subagent `afake0501`, not of the top-level session. Core derives the parent from that match; without a match the parent must stay unknown. The nested file layout (flat under the top-level session's `subagents/`) is an assumption.
