# Scenario 4: subagent transcript without meta

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** a subagent transcript with no `.meta.json` yields its events (with `providerAgentId`) but no `subagent.spawned`, so no edge can be derived: the child's parent stays unknown. Not observed in real data (197 of 197 had meta).
