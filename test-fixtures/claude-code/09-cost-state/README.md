# Scenario 9: cost-state cumulative snapshots

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** two `cost-state` records become two `usage.snapshot` events with `scope: unknown`. They are stored and shown, never summed. The second snapshot lacks one per-model category, which stays `null`. The per-model key names (`inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`) follow the Agent SDK `modelUsage` shape and are **unverified** for transcripts.
