# Scenario 11: api_error record, assistant line without requestId, <synthetic> model line

**Provenance:** synthetic (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Record `version`: `2.1.263`. All ids, paths, and text are fake; text is `<redacted>`.

**Proves:** `system`/`api_error` yields `provider.error` (`kind` from the error type identifier, `httpStatus` from `status`; an error without them gives `kind: api_error`, `httpStatus: null`). The `error` shape is **unverified**. An assistant line without `requestId` gives `requestId: null`. The `<synthetic>` placeholder message is emitted as observed; core excludes it from usage records.
