# @acp/adapter-claude-code

The Claude Code provider adapter. It has two halves: **observation**, which reads Claude Code's
session transcripts, subagent metadata and hook payloads and turns them into core
`NormalizedEvent`s, and **managed mode** (`src/managed/`), which runs agents through the Claude
Agent SDK for the control panel. It never writes the database, the Claude data directory or Claude
Code settings, and it copies no conversation content into events (ADR-0009).

## Observation (`src/*.ts`)

| Module            | What it does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `allowlist.ts`    | the only file shapes that may be opened under `<claudeDir>/projects/` |
| `discovery.ts`    | lists allowlisted files (realpath checked), peeks the first `cwd`     |
| `reader.ts`       | incremental JSONL reading against a checkpoint                        |
| `ingestor.ts`     | per-file state, root matching, transcripts and meta files to batches  |
| `records.ts`      | transcript records to events                                          |
| `record-types.ts` | which record types are read beyond their `type`                       |
| `meta.ts`         | a subagent `.meta.json` to one `subagent.spawned` event               |
| `hooks.ts`        | hook payload normalization and the settings snippet                   |
| `dedup.ts`        | record keys for deduplication (usage-accounting §3)                   |
| `diagnostics.ts`  | file issues, ignored and unknown record counts                        |
| `capabilities.ts` | the capability report and its known limitations                       |
| `redact.ts`       | redaction and length caps for titles and subagent descriptions        |

- **Allowlist.** Only `<dir>/<uuid>.jsonl`, `<dir>/<uuid>/subagents/agent-<id>.jsonl` and
  `<dir>/<uuid>/subagents/agent-<id>.meta.json` under `projects/` can be read. `sessions/`,
  settings, `history.jsonl`, `memory/`, `tool-results/` and every other file are denied by
  construction (provider-adapters §3). A symlink out of `projects/`, a non-regular file or a file
  over the size cap is skipped and reported as a file issue, with a path relative to the data root.
- **Incremental reading.** The reader compares the file with its checkpoint (`dev:ino`, size, a
  hash of the first bytes). On a mismatch (a replaced or truncated file) it starts again at offset
  0; dedup keys make the re-read idempotent. It reads in chunks, only up to the last newline (a
  partial last line waits for the next poll) and counts unparseable lines instead of failing.
- **Hooks.** `normalizeHook` accepts the subscribed hooks (`SUBSCRIBED_HOOKS`); other hook names
  give `[]`, and a malformed body throws `HookPayloadError`. `hookSettingsSnippet` returns JSON text
  for the user to paste into their own settings; the app never writes it (ADR-0005).

## Managed mode (`src/managed/`)

`createManagedClaudeCode({ query?, env? })` implements core's `ManagedExecutionAdapter` with one SDK
`query()` per agent and streaming input. It is the only code in the repo that imports
`@anthropic-ai/claude-agent-sdk` (ADR-0012). `start(spec, callbacks)` returns a handle whose
`events` yield `started`, `activity`, `usage`, `lead-text` and exactly one `finished`; `send`,
`interrupt` and `abort` control it.

- **Options** (`adapter.ts`, `buildOptions`): `permissionMode: 'default'` (never bypass),
  `settingSources: []` (no settings files, so no repository rules or hooks and no CLAUDE.md),
  `strictMcpConfig: true`, an explicit built-in tool set per role, Claude Code's own system prompt
  with the project context and the stage agent file appended, and the block's model and effort.
- **Permission bridge** (`permissions.ts`): `canUseTool` lets read-only tools inside the agent's
  folder and the agent's own control-plane tools run; everything else goes to the owner through
  `callbacks.requestPermission` with a redacted, content-free summary (`summary.ts`). Planners and
  reviewers get no edit or shell tools.
- **Control-plane tools** (`lead-tools.ts`): one in-process MCP server (`mcp__acp__*`) carrying
  the role's tools: the lead's set, the planner's `submit_plan`, a final reviewer's `post_review`,
  a change reviewer's `submit_review`, and `report_work` for helpers and the tester (plus child
  management for a helper allowed to start helpers). The engine checks every call again.
- **Branch guard** (`branch-guard.ts`): for helpers and the tester, in every approval mode, a
  PreToolUse hook, the gate and `GIT_DENY_RULES` refuse git commands that could change a ref,
  `HEAD` or history. The app owns branches and commits (ADR-0021, ADR-0025).
- **Full auto** (`full-auto.ts`, ADR-0022): a helper or tester on a Full auto block runs in Claude
  Code's auto mode inside the OS sandbox. If the sandbox or auto mode is unavailable the agent ends
  with an error before anything runs (fail closed).
- **Follow-ups and rework.** A follow-up turn resumes the ended lead's session with read-only tools
  (ADR-0020). A rework turn resumes the helper's own session in its worktree (ADR-0021).
- **Rework fallback.** If a rework turn's resume ends in an error before the session answered (no
  usage, no tool activity), for example because the saved transcript is gone, the adapter starts the
  turn once more without `resume`, in the same worktree with otherwise the same options, and
  prefixes the prompt with `REWORK_NEW_SESSION_NOTE` (exported from `src/managed/index.ts`). It
  never does this after the session answered, after an abort, when Full auto could not run
  protected, for a first turn, a fresh rework or a follow-up, and does it at most once per turn
  (`tests/managed/rework-lost-session.test.ts`).

## Public API (`src/index.ts`)

`createClaudeCodeAdapter({ claudeDir, now?, maxFileBytes?, chunkBytes? })` returns the core
`ObservationAdapter` (`capabilities`, `discoverCandidates`, `poll`, `normalizeHook`) plus
`diagnostics()`. `claudeDir` must be absolute; defaults are a 512 MiB size cap
(`DEFAULT_MAX_FILE_BYTES`), 1 MiB chunks and the system clock. Also exported: `hookSettingsSnippet`,
`HookPayloadError`, `SUBSCRIBED_HOOKS`, `SNIPPET_HOOKS`, `CLAUDE_CODE_LIMITATIONS`,
`createManagedClaudeCode`, `ManagedAgentEndedError`, `ManagedFollowUpSendError`,
`LEAD_MCP_SERVER_NAME`, `READ_ONLY_TOOLS`, `summarizeToolUse`, `MAX_SUMMARY_LENGTH`, and the
diagnostics types.

## Testing

`pnpm --filter @acp/adapter-claude-code test` (Vitest). Tests never read the real `~/.claude`:

- Observation tests run against the sanitized, synthetic scenarios in
  [`test-fixtures/claude-code/`](../../../test-fixtures/claude-code/README.md) (each one a fake
  Claude data root) or temporary directories, and compare with hand-reviewed golden events in
  `<scenario>/expected/`. After an intentional change, regenerate them with
  `UPDATE_GOLDEN=1 pnpm --filter @acp/adapter-claude-code test` and review the diff by hand.
- Managed tests inject a scripted fake `query` (`tests/managed/fake-query.ts`); most also mock the
  SDK's real `query` to throw, so no test can start Claude. `adversarial-commands.test.ts` is part
  of the [adversarial suite](../../../docs/testing/adversarial.md).
- `pnpm --filter @acp/adapter-claude-code sanitize-fixture --out <dir> <file>...` turns a transcript
  or meta file into a fixture: structure, numbers and a few enum-like values are kept; ids become
  deterministic fakes, paths `/home/user/project…`, every other string `<redacted>`. Review its
  output by hand before committing it.

## Dependency rules

`@acp/core`, `zod`, Node built-ins, and `@anthropic-ai/claude-agent-sdk` in managed mode
(`package.json` also pins `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk`, which `src/` does
not import directly). Never `@acp/db`, `@acp/server`, `@acp/web` or `@acp/orchestrator`: adapters
do not persist (enforced by `eslint.config.js`).

## Read next

- [docs/provider-adapters.md](../../../docs/provider-adapters.md): §3 allowlist, §4 ingestion,
  §6 hooks, §10 implementation notes and unverified assumptions, §11 managed mode and SDK facts
- [docs/usage-accounting.md](../../../docs/usage-accounting.md),
  [docs/security.md](../../../docs/security.md),
  [docs/architecture.md](../../../docs/architecture.md)
- ADRs in [docs/decisions](../../../docs/decisions/README.md): 0004 adapter abstraction, 0005
  transcript and hook ingestion, 0008 session vs agent run identity, 0009 content minimization,
  0011 adapter diagnostics, 0012 the Agent SDK, 0013 guardrails, 0020 the lead's follow-up turns,
  0021 review loop and ticket branch, 0022 Full auto, 0028 agent effort
