# P4-I — Adapter: context, nested helpers, submit_plan

> Progress file for P4-I. Only the agent working on P4-I edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value             |
| ------- | ----------------- |
| Status  | review            |
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

| Date       | What was done                                                                                                                                                                                                                               | Commit  | Checks                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-10-13 | Claimed P4-I; branch `wp/p4-i-adapter` from `main` (8c05f68)                                                                                                                                                                                | 80e33f3 | n/a (docs only)                                                                                            |
| 2026-10-13 | Context as preset `append` (capped at MAX_CONTEXT_BYTES); `canStartHelpers` gets the child-management tools only; `managedToolNames` drives both the MCP server and `canUseTool`; 15 new fake-query tests; README and provider-adapters §11 | 20c4d78 | format ✓ lint ✓ typecheck ✓ test 1382/1382 ✓ build ✓ (server suite with `--testTimeout=60000`; see report) |

## Handoff notes

- **For P4-D (server):** pass `context` (already formatted, e.g. with file-name headers) and set
  `canStartHelpers: true` plus a `leadTools` handler on a worker only when the project's `maxDepth`
  is 2 and the worker is at depth 1. A worker with `canStartHelpers` but no `leadTools` gets no
  server. The adapter does not scope calls to the caller's children; the engine (P4-A) must.
- **System prompt without context (decision needed, coordinator):** in SDK 0.3.296 an omitted
  `systemPrompt` is an empty prompt (`sdk.mjs`: `undefined` becomes `""`), so Phase 3 agents ran
  without Claude Code's own prompt. P4-I sets the preset only when there is context, so Phase 3
  runs stay unchanged. Agents with context therefore also get Claude Code's full prompt. Using
  the preset always would be a one-line change in `systemPromptFor`.
- **Parent-helper lifecycle (for P4-A/P4-D):** a worker's input still closes after a turn that ends
  with nothing queued. So a parent helper that starts children and ends its turn finishes, and a
  later `send` to it throws `ManagedAgentEndedError`. If parents must wait for their children, the
  engine has to keep them busy (for example by telling them to poll `agent_status`), or the adapter
  needs a lead-like open input for `canStartHelpers` workers. That is a decision for the
  coordinator; I did not change it.

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

1. **Summary:** managed agents get the project context appended to Claude Code's preset system
   prompt (capped at `MAX_CONTEXT_BYTES`). A worker with `canStartHelpers` gets only the five
   child-management tools; other workers get none. `submit_plan` stays lead-only.
2. **Files changed (all modified):**
   - `packages/adapters/claude-code/src/managed/{adapter,lead-tools,permissions,index}.ts`;
   - `packages/adapters/claude-code/tests/managed/{adapter,lead-tools,permissions}.test.ts`;
   - `packages/adapters/claude-code/README.md` (managed-mode section);
   - `docs/provider-adapters.md` §11;
   - this file.
3. **Commands and results (Node 22.21.1, pnpm 10.26.1):**
   - `pnpm format:check` ✓, `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm build` ✓;
   - tests: 1382/1382 (core 233, demo 12, orchestrator 308, claude-code 267, db 117, web 226,
     server 219).
   - Caveat: `pnpm check` itself failed in the server suite. Under a load average of 25 to 48
     (other agents running), 1 to 5 observation, hook and SSE tests failed by timing, a different
     set each run (for example `smoke.test.ts` and `reference-usage.test.ts`, which hit the 5 s
     timeout). None of them reaches the managed adapter; the two server tests that do
     (`verification/control/{content,guardrails}`) passed every run. The server suite passes
     219/219 with `vitest run --testTimeout=60000`. `smoke.test.ts` passed alone on both this
     branch and the base commit. Please rerun `pnpm check` on a quiet machine before merging.
4. **Acceptance:**
   - context appended via the SDK preset `append`: met (adapter tests, including the UTF-8 cap);
   - `canStartHelpers` gives the child-management tools only: met (the MCP server tool list is
     recorded in the adapter tests; `canUseTool` denies `submit_plan`, `request_review`, unknown
     names and other servers' tools without asking);
   - workers without it keep no lead tools: met (no server; every `mcp__acp__*` is denied);
   - `submit_plan` through the lead server: met (from P4-0; P4-I adds a schema and handler test);
   - fake-`query` tests only: met (the real `query` is mocked to throw).
5. **Assumptions:**
   - Blank context counts as absent.
   - Context is appended as given, with no adapter-added header (the server formats it).
   - `snapshot` keeps the SDK default.
   - `canStartHelpers` on a lead is ignored.
   - All of these are documented in provider-adapters §11.
6. **Contract or shared-file changes:** none needed. `HELPER_PARENT_TOOL_NAMES` is exported from
   `src/managed/index.ts` but not from the package root `src/index.ts`, which is outside P4-I's
   paths. Add it there if the server needs it.
7. **Known gaps:** the system prompt without context and the parent-helper lifecycle (see the
   handoff notes); no real SDK run (P4-H).
8. **Next:** P4-D wires `context` and `canStartHelpers`; the coordinator decides the two handoff
   questions.
