# P4-I — Adapter: context, nested helpers, submit_plan

> Progress file for P4-I. Only the agent working on P4-I edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value             |
| ------- | ----------------- |
| Status  | in-progress       |
| Owner   | adapter agent     |
| Branch  | `wp/p4-i-adapter` |
| Started | 2026-10-13        |
| Updated | 2026-10-13        |

## Tasks

- [x] ManagedAgentSpec.context appended to the system prompt (SDK preset append)
- [x] canStartHelpers: depth-2 parents get child-management tools only
- [x] submit_plan exposed via the lead tool server (done by the coordinator in P4-0 to keep `main` green)
- [x] Fake-query tests; pnpm check green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                                                                               | Commit      | Checks                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-10-13 | Claimed P4-I; branch `wp/p4-i-adapter` from `main` (8c05f68)                                                                                                                                                                                | 80e33f3     | n/a (docs only)                                                                                            |
| 2026-10-13 | Context as preset `append` (capped at MAX_CONTEXT_BYTES); `canStartHelpers` gets the child-management tools only; `managedToolNames` drives both the MCP server and `canUseTool`; 15 new fake-query tests; README and provider-adapters §11 | feat commit | format ✓ lint ✓ typecheck ✓ test 1382/1382 ✓ build ✓ (server suite with `--testTimeout=60000`; see report) |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
