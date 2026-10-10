# Claude Code data observations (2026-10-10)

This is a read-only structural scan of one developer machine's `~/.claude/projects`. Only key names,
counts, and booleans were collected. No message content, ids, or credentials were recorded.
`~/.claude/sessions/` was **not** read. These are observations of one machine and one point in time,
not guarantees. Re-verify them against new runtime versions with sanitized fixtures.

## Environment

- CLI: `claude --version` reports `2.1.263 (Claude Code)` at `~/.local/bin/claude`.
- Transcript `version` values: **16 distinct values, 2.1.202 to 2.1.293**. The desktop app writes with
  its own, sometimes newer, runtime.
- `entrypoint` values: `claude-desktop` (89,791 lines), `sdk-cli` (70), `claude-vscode` (10).

## Files

- 16 project directories, 100 top-level transcripts, 197 subagent transcripts, 197 meta files.
- Every subagent `jsonl` had a matching `meta.json`, and the reverse.
- Other per-session entries exist and are **out of scope** for the adapter: `tool-results/`, memory
  markdown files, `custom-title.json`, and others.
- No `*.orphaned-*` or `*.superseded-*` files were present. The docs say they can exist.
- The longest project directory name was 168 characters. The docs say names over 200 characters
  are truncated with a hash.

## Records

- Top-level record types:
  - `user`, `assistant`, `attachment`, `system`;
  - `cost-state`;
  - `custom-title`, `ai-title`, `agent-name`, `last-prompt`, `mode`;
  - `queue-operation`;
  - `file-history-snapshot`, `file-history-delta`;
  - `bridge-session` (contains account and organization uuids);
  - `artifact-autoreact-ledger` (contains `accountUuid`), `artifact-comment-monitor`;
  - `frame-link`, `relocated`, `atis-latch`.
- Subagent transcripts contain only `user`, `assistant`, and `attachment` records, and carry
  `agentId`.
- `isSidechain: true` never appears in top-level files.
- `system.subtype` values: `stop_hook_summary`, `api_error`, `compact_boundary`,
  `model_refusal_fallback`, `local_command`.
- No file ended with a partial line, and no line failed to parse. The partial-line handling is
  therefore untested on real data; it must be covered by synthetic tests.
- 50 files contain more than one `cwd`: 42 moved into a subdirectory, 8 moved elsewhere. In 99 of
  100 top-level files, the first `cwd` encodes to the project directory name.

## Usage

- Usage keys:
  - always present: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
    `cache_read_input_tokens`, `cache_creation`, `service_tier`, `inference_geo`;
  - sometimes present: `server_tool_use`, `iterations`, `speed`, `output_tokens_details`,
    `fallback_credit`.
- 44,467 assistant lines, all of which have `message.id` and `usage`. 28 have no `requestId`.
- **23,287 lines repeat an earlier `message.id` in the same file.** In 2,499 of them the usage
  differs, and in every one of those 2,499 cases `output_tokens` _grew_.
- **1,715 message ids appear in two or more top-level files under different `sessionId`s.** None
  appear across a top-level/subagent pair. The final `output_tokens` matched in 1,714 cases. This is
  consistent with the documented behavior that forks copy history.
- Models in assistant lines include several Opus, Sonnet, Haiku, and Fable ids, plus `<synthetic>`
  (28 lines).
- `cost-state` records appear in 20 of 100 top-level files, between 1 and 10 times per file. Each
  holds a cumulative `modelUsage` per model, `totalCostUSD`, and durations. Snapshots list models
  that the main thread did not use, so they likely include subagent or auxiliary usage. This is
  **unverified** (open question Q3).

## Subagents

- Meta keys:
  - always present: `agentType`, `description`, `toolUseId`, `spawnDepth`;
  - sometimes present: `model`, `requestShape`, `requestNonInteractive`, `stoppedByUser`,
    `spawnedWithWorktree`, `worktreePath`, `worktreeBranch`, `worktreeCleanlyRemoved`.
- In 197 of 197 meta files, `toolUseId` matched an `Agent` `tool_use` block in the scanned
  transcripts.
- `spawnDepth` was 1 for all 197. Nested subagents were never observed.

## Documented interfaces (from the Claude Code docs, via research on 2026-10-10)

- **Hooks:**
  - The docs list 33 events and an `http` hook type that POSTs JSON. Non-2xx responses and connection
    failures are non-blocking.
  - The common payload carries `session_id`, `transcript_path`, `cwd`, and `hook_event_name`.
  - SubagentStart/Stop carry `agent_id` and `agent_type`; SubagentStop also carries
    `agent_transcript_path`.
  - There is no general token usage in hook payloads.
  - Per-version availability on 2.1.263 is unverified.
- **Transcript format:** documented as internal and changing between versions. Retention is
  `cleanupPeriodDays` (default 30).
- **OpenTelemetry:**
  - `claude_code.token.usage` with `type` ∈ {input, output, cacheRead, cacheCreation}, plus `model`,
    `query_source`, and `session.id`.
  - `claude_code.api_request` log events carry per-request tokens and `request_id`.
  - Prompts and responses are redacted by default.
  - `cost_usd` is documented as an estimate.
- **Agent SDK:**
  - `@anthropic-ai/claude-agent-sdk` `query()` with `abortController`, `sessionId`, `resume`, and
    `forkSession`.
  - The result message has `usage` (which excludes subagents), plus `modelUsage` and `total_cost_usd`
    (which include them; client-side estimates).
