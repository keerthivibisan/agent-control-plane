# Provider adapters

> Status: the adapter contract is **[core v1 types]** in
> [`packages/core/src/adapters/contract.ts`](../packages/core/src/adapters/contract.ts). The Claude Code
> observation design below is **[planned, P1-C]**. Interface facts are labeled **verified-local** (seen
> in local data on 2026-10-10), **documented** (Claude Code docs), or **unverified**. Verify unverified
> items with sanitized fixtures before relying on them.

## 1. Contract

The adapter contract is internal. It is not a provider API. **The source of truth is
`contract.ts`.** Summary:

- `ObservationAdapter`:
  - `capabilities()`
  - `discoverCandidates(roots)`: first-`cwd` peeks only, no content
  - `poll(roots, checkpoints)`: an `AsyncIterable<IngestionBatch>`
  - `normalizeHook(body, receivedAt)`
- `IngestionBatch`: `{ sourcePath, events, nextCheckpoint }`. The pipeline commits the events and the
  checkpoint in **one transaction**. Adapters never write the database.
- `ProviderCapabilities`: observation flags, `managedExecution: false`, `providerVersionsSeen`, and
  `limitations[]` (shown in the UI).

`ManagedExecutionAdapter` (`startAgent`, `getRunState`, `cancelAgent`, `collectResult`) is **Phase 3**.
Do not add it in Phase 1. The Codex adapter (Phase 5) implements the same `ObservationAdapter` against
Codex's own interfaces. Nothing Claude-specific may leak into `@acp/core` types.

## 2. Claude Code interfaces

| Interface                                                                            | Status                                                                                          | What it gives                                                                                                                                                                                                       | Use in Phase 1                                                                       |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Transcripts `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`                     | documented path; **format documented as internal and changes between versions**; verified-local | full message stream, `message.id`, `requestId`, `model`, per-line usage, `cwd`, `gitBranch`, `version`, `entrypoint`, `cost-state` snapshots                                                                        | **Source of record** for messages, tools, usage                                      |
| Subagent files `<sessionId>/subagents/agent-<agentId>.jsonl` and `.meta.json`        | directory documented; file names verified-local only                                            | `agentType`, `description`, `toolUseId`, `spawnDepth`, sometimes `model` and worktree info                                                                                                                          | Subagent sessions and edges                                                          |
| Hooks (`type: "http"` POSTs JSON to a URL)                                           | documented                                                                                      | `session_id`, `transcript_path`, `cwd`, `hook_event_name`; SessionStart `source` and `model`; SessionEnd `reason`; SubagentStart/Stop `agent_id`, `agent_type`, `agent_transcript_path`. **No general token usage** | Live lifecycle, end-of-session evidence, faster tailing                              |
| OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, OTLP)                               | documented                                                                                      | `claude_code.token.usage` / `cost.usage` metrics; `claude_code.api_request` log events with tokens and `request_id`; `query_source` (main, subagent, auxiliary)                                                     | **Deferred** (Phase 2 candidate: second usage source and auxiliary-usage visibility) |
| Agent SDK `@anthropic-ai/claude-agent-sdk` / `claude -p --output-format stream-json` | documented                                                                                      | launch, `session_id`, abort, and a result with `usage`, `modelUsage`, `total_cost_usd` (client-side estimate)                                                                                                       | **Phase 3** managed execution only                                                   |

Versions:

- The installed CLI is **2.1.263**.
- Local transcripts contain **16 different `version` values (2.1.202 to 2.1.293)**. The desktop app runs
  its own runtime, which can be newer than the CLI, so feature availability must be checked per
  record, not from `claude --version`.
- `entrypoint` values seen: `claude-desktop`, `sdk-cli`, `claude-vscode`.

## 3. File access allowlist (security-critical)

The Claude data root is `$CLAUDE_CONFIG_DIR`, else `~/.claude` (override: `ACP_CLAUDE_DIR`). The
adapter may open **only** paths matching these patterns, after `realpath` and confirming the path stays
under `<root>/projects/`:

| Pattern (relative to `<root>/projects/`)                                                                 | Purpose              |
| -------------------------------------------------------------------------------------------------------- | -------------------- |
| `<dir>/<uuid>.jsonl`, where `<uuid>` is `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | top-level transcript |
| `<dir>/<uuid>/subagents/agent-<id>.jsonl`, where `<id>` is `^[A-Za-z0-9]+$`                              | subagent transcript  |
| `<dir>/<uuid>/subagents/agent-<id>.meta.json`                                                            | subagent metadata    |

**Everything else is denied**, including:

- `~/.claude/sessions/**` (contains peer tokens and `.key` files);
- `settings*.json` and `history.jsonl`;
- `memory/`, `tool-results/`, and `file-history/`;
- `custom-title.json` and other per-session files;
- `*.orphaned-*` and `*.superseded-*` (documented set-aside transcripts);
- symlinks resolving outside `<root>/projects/`;
- anything over the size cap (default 512 MiB per file; reported in diagnostics).

A hook's `transcript_path` is used only if it passes the same allowlist.

The adapter never writes to the Claude data directory and never edits Claude Code settings (ADR-0005).

## 4. Observation mode: ingestion algorithm

1. **Discovery.** List `<root>/projects/*/`. For each allowlisted transcript, peek at records until the
   first one with a `cwd`, reading at most 64 KiB. Do not decode the directory name: the encoding
   replaces non-alphanumerics with `-` and truncates long names, so it is lossy.
   - If `cwd` is inside a registered root, the file is eligible.
   - Otherwise the `cwd` is reported only as a candidate root for the "register this project?" UI.
     No further reading happens.
2. **Incremental read.** Open the file and compare it with the checkpoint (`dev:ino`, size, `headHash`).
   On a mismatch, reset the offset to 0. Read from `byteOffset` up to the last `\n`, in bounded chunks
   (default 1 MiB).
3. **Parse.** `JSON.parse` each complete line, then validate with a tolerant per-type Zod schema
   (`z.looseObject`) that reads only the fields we use. Unknown fields are ignored. On a parse failure,
   count it and skip the line.
4. **Record-type allowlist.**

   | `type`                             | Events                                                                                                                     |
   | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
   | `user`                             | `message.user`; plus `tool.result` per `tool_result` block (ids and `is_error` only)                                       |
   | `assistant`                        | `message.assistant`; `tool.called` per `tool_use` block (name and id only); `usage.reported` if `message.usage` is present |
   | `system` with `subtype: api_error` | `provider.error`                                                                                                           |
   | `cost-state`                       | `usage.snapshot` (`scope: unknown`)                                                                                        |
   | first record with `cwd`            | `session.observed`; a later different `cwd` gives `session.cwd_changed`                                                    |
   | `custom-title` / `ai-title`        | `session.titled` (redacted, at most 200 chars; `titleSource` user or ai)                                                   |
   | **anything else**                  | `record.unrecognized` with `recordType` only                                                                               |

   Records such as `bridge-session` and `artifact-autoreact-ledger` contain account and organization
   ids. They fall into the last row and **their fields are never read**.

5. **Content minimization.** Message text, thinking, tool inputs, and tool outputs are never copied
   into events (ADR-0009). Only identifiers, names, counts, model, and timestamps are copied.

## 5. Parent-child relationships

| Evidence                                                                                | Edge                                                                                                                                                                                                                            | Provenance |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Meta file `<S>/subagents/agent-<A>.meta.json` exists                                    | `subagent`: parent `(S, null)` to child `(S, A)`, evidence `subagent-metadata`                                                                                                                                                  | observed   |
| …and `meta.toolUseId` equals a `tool.called` (`Agent`/`Task`) in the parent transcript  | adds `spawn-tool-use`                                                                                                                                                                                                           | observed   |
| `spawnDepth > 1`                                                                        | Parent is the session (top-level or subagent) whose transcript contains `tool.called` with id `meta.toolUseId`. **No match means parent unknown**. Never default to the root session                                            | observed   |
| SubagentStart/SubagentStop hook with `agent_id` in session S                            | adds `subagent-hook` to the `(S, A)` edge                                                                                                                                                                                       | observed   |
| Session B's file contains message ids first seen in session A **strictly earlier** in A | `continuation` A to B, evidence `shared-message-history`. The parent is the single session holding all of B's inherited ids. **On a timestamp tie, which is normal for forks, the direction is unknown and no edge is created** | derived    |
| Subagent transcript **without** a meta file                                             | **no edge**. The child is shown with parent _unknown_                                                                                                                                                                           | —          |

Verified locally:

- 197 of 197 meta files had a matching `jsonl`;
- 197 of 197 `toolUseId` values matched an `Agent` tool call;
- every `spawnDepth` was 1.

Depth above 1 is **unverified**. P1-C must cover it with a synthetic fixture marked as such.

Implemented rules in `@acp/core` (`deriveSubagentEdge`, `deriveContinuationEdges`):

- Spawn tool calls are matched only within the same provider session, so fork copies of `Agent`
  calls are ignored.
- If a depth above 1 matches calls in more than one session, the match is ambiguous and the parent
  is unknown.
- Ambiguous parents and cycles produce no edge.

## 6. Hooks (live channel)

- **Receiver:** `POST http://127.0.0.1:<port>/api/hooks/claude-code`.
  - Requires the header `X-ACP-Hook-Token: <token>`. The token is generated on first run and stored in
    `<ACP_DATA_DIR>/hook-token` with mode 0600.
  - Requires `Content-Type: application/json` and a body of at most 256 KiB.
  - Responds `204` quickly with no body, so it never returns a decision that could block the user.
- **Hook to event mapping:**
  - `SessionStart` → `session.started`
  - `SessionEnd` → `session.ended`
  - `SubagentStart` → `subagent.spawned` (hook evidence)
  - `SubagentStop` → `subagent.stopped`
  - `Stop` → `session.turn_ended`
  - `Notification` → `session.attention` (type only)
  - `CwdChanged` → `session.cwd_changed`
- **Events to subscribe (Phase 1):** `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`,
  `Stop`, `Notification` (the "needs attention" signal), `CwdChanged`. Availability per runtime
  version is unverified; P1-C captures real payloads.
- **Configuration is opt-in and manual.** The app _prints_ a settings snippet (`"type": "http"`,
  `"timeout": 2`, header via `allowedEnvVars`). The user pastes it into their own settings. The app
  never writes `~/.claude/settings.json` or a project's `.claude/settings*.json`.
- **Failure behavior (documented):** a non-2xx response or connection failure is a non-blocking hook
  error. When the server is not running, the user may see hook error notices. This must be documented
  in the UI next to the snippet.

## 7. Status and staleness

The pipeline records evidence: `lastEventAt`, plus `endedAt` and `endReason` from `SessionEnd`. Status is
derived on read by `deriveSessionStatus` in `@acp/core` **[implemented]**. Without hooks, sessions never reach `ended`; they become `stale`, which is the
truthful answer. Stale never means completed.

## 8. Errors and version drift

- Any per-file error (permission, decode, size cap) is recorded on the checkpoint and in diagnostics.
  Other files continue.
- `capabilities().limitations` lists known gaps, for example:
  - "hooks not configured: end-of-session not observable";
  - "transcript format is internal to Claude Code";
  - "cumulative snapshot scope unknown".
- When a new `version` value appears with more than 5% unrecognized records, the diagnostics endpoint
  flags it.

## 9. Demo adapter (`@acp/adapter-demo`)

- It replays committed sanitized fixtures deterministically, with fixed clock offsets.
- It emits `provider: "demo"` and `source.channel: "demo"`, and runs only in `ACP_MODE=demo` (separate
  `demo.sqlite`) or in tests.
- The UI shows a persistent **DEMO DATA** banner (ADR-0007).
