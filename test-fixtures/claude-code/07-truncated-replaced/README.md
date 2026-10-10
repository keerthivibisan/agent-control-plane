# Scenario 7: truncated or replaced file (two versions)

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** `v1/` and `v2/` are two versions of the same transcript path. `v2` is shorter and has a different head. After reading `v1`, replacing the file with `v2` makes the checkpoint mismatch (size below the offset and a different head hash), so the reader resets to offset 0 and reads `v2` from the start. Earlier events stay (append-only); dedup keys keep a re-read idempotent.

Point the adapter at a temp copy: copy `v1/` as the Claude data root, poll, then copy `v2/` over it.
