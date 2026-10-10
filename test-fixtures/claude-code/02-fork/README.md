# Scenario 2: fork

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** session `c0ffee00-0000-4000-8000-000000000002` copies the first four lines of `c0ffee00-0000-4000-8000-000000000001` (same uuids and message ids, new `sessionId`) and continues. Both files yield `usage.reported` for `msg_fake0201` and `msg_fake0202` with different dedup keys (the key uses the file's session id); usage dedup by message id and the continuation edge are core's job.
