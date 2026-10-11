# Provider adapters

> Status: the adapter contract is **[core v1 types]** in
> [`packages/core/src/adapters/contract.ts`](../packages/core/src/adapters/contract.ts). The Claude Code
> observation adapter is **[implemented, P1-C]** in `@acp/adapter-claude-code` and verified against
> synthetic fixtures only; §10 lists everything that is still unverified against a real runtime.
> Interface facts are labeled **verified-local** (seen in local data on 2026-10-10), **documented**
> (Claude Code docs), or **unverified**. Verify unverified items with sanitized fixtures before
> relying on them.

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
| Hooks (`type: "http"` POSTs JSON to a URL)                                           | documented; shapes verified-local with 2.1.296 (§10.4)                                          | `session_id`, `transcript_path`, `cwd`, `hook_event_name`; SessionStart `source` and `model`; SessionEnd `reason`; SubagentStart/Stop `agent_id`, `agent_type`, `agent_transcript_path`. **No general token usage** | Live lifecycle, end-of-session evidence, faster tailing                              |
| OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, OTLP)                               | documented                                                                                      | `claude_code.token.usage` / `cost.usage` metrics; `claude_code.api_request` log events with tokens and `request_id`; `query_source` (main, subagent, auxiliary)                                                     | **Deferred** (Phase 2 candidate: second usage source and auxiliary-usage visibility) |
| Agent SDK `@anthropic-ai/claude-agent-sdk` / `claude -p --output-format stream-json` | documented                                                                                      | launch, `session_id`, abort, and a result with `usage`, `modelUsage`, `total_cost_usd` (client-side estimate)                                                                                                       | **Phase 3** managed execution only                                                   |

Versions:

- The installed CLI was **2.1.263** on 2026-10-10 and **2.1.296** at the hook capture on 2026-10-11.
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
   | known, ignored types (below)       | no event; counted by type in `diagnostics().ignoredRecords` (ADR-0011)                                                     |
   | **anything else**                  | `record.unrecognized` with `recordType` only                                                                               |

   Records such as `bridge-session` and `artifact-autoreact-ledger` contain account and organization
   ids. They fall into the last two rows and **their fields are never read**.

   **Known, ignored record types [implemented].** The P1-F real-data run counted 12,601
   `record.unrecognized` events across 14 types ([research note](research/p1-f-real-data-2026-10-10.md)).
   Each type was classified from its **name, its count, the fact that usage totals matched the
   reference without it, and public knowledge of Claude Code features only**. No record content was
   read to decide (assumption: the names mean what they say). A type is ignored only when it clearly
   carries no usage, no session lifecycle, and no relationship; anything uncertain stays
   unrecognized, so a change in meaning stays visible. Ignored records are read for `type` only (a
   `system` record still applies its envelope `cwd`/`version`), emit no event, and are counted in
   `recordsByVersion.total` and `ignoredRecords`.

   | Type (count in P1-F)             | Decision         | Why                                                                                                                 |
   | -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
   | `attachment` (7,860)             | ignored          | Context attached to a user turn (files, reminders, hook output): content only; the turn itself is the `user` record |
   | `last-prompt` (2,089)            | ignored          | The last prompt text kept for resume: content only                                                                  |
   | `queue-operation` (1,208)        | ignored          | Queued-input bookkeeping (enqueue/dequeue of typed input): content, no usage or lifecycle the control plane uses    |
   | `file-history-snapshot` (333)    | ignored          | File checkpoint backups for rewind: file state, no usage                                                            |
   | `file-history-delta` (267)       | ignored          | Incremental file checkpoint data, same feature as above                                                             |
   | `system:stop_hook_summary` (410) | ignored          | Summary of Stop hooks that ran; turn end is already visible from the transcript and the `Stop` hook                 |
   | `artifact-comment-monitor` (2)   | ignored          | Artifact comment subscription state; carries account ids; unrelated to sessions                                     |
   | `artifact-autoreact-ledger` (1)  | ignored          | Artifact auto-reaction ledger; carries account ids; unrelated to sessions                                           |
   | `frame-link` (401)               | **unrecognized** | Meaning unknown; a "link" may express a relationship between sessions or frames                                     |
   | `system:compact_boundary` (7)    | **unrecognized** | Marks a compaction, a session lifecycle point that a later WP may want to show                                      |
   | `relocated` (2)                  | **unrecognized** | Suggests the session or transcript moved: possible lifecycle or continuation evidence                               |
   | `agent-name` (6)                 | **unrecognized** | Possibly a session or agent name, close to titles                                                                   |
   | `mode` (5)                       | **unrecognized** | Probably a permission or plan mode switch, but not confirmed                                                        |
   | `atis-latch` (10)                | **unrecognized** | Meaning unknown                                                                                                     |

   With this list, the P1-F project would have shown 431 unrecognized records instead of 12,601
   (computed from the counts above, not re-run).

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
- A null `occurredAt` is never strictly earlier or later, so undated sightings never create a
  continuation edge.

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
- **Events to subscribe (Phase 1):** `SessionEnd`, `SubagentStart`, `SubagentStop`, `Stop`,
  `Notification` (the "needs attention" signal), `CwdChanged` over `type: "http"`. **verified-local
  (2.1.296, 2026-10-11)** for all but `Notification`
  ([capture note](research/p1-c6-hook-capture-2026-10-11.md)). `SessionStart` is **not delivered to
  http hooks** in that version (a `command` hook in the same run fired), so the snippet omits it;
  `normalizeHook` still maps a `SessionStart` body if one arrives (for example forwarded by a user's
  own command hook). Session start is otherwise known from the transcript (`session.observed`).
- **Configuration is opt-in and manual.** The app _prints_ a settings snippet (`"type": "http"`,
  `"timeout": 2`, header via `allowedEnvVars`). The user pastes it into their own settings. The app
  never writes `~/.claude/settings.json` or a project's `.claude/settings*.json`. Verified with
  2.1.296: the POST carries `Content-Type: application/json`, keeps the URL path, and the
  `$ACP_HOOK_TOKEN` header value is expanded from the environment.
- **Failure behavior (documented):** a non-2xx response or connection failure is a non-blocking hook
  error. When the server is not running, the user may see hook error notices. This must be documented
  in the UI next to the snippet.

## 7. Status and staleness

The pipeline records evidence: `lastEventAt`, plus `endedAt` and `endReason` from `SessionEnd`. Status is
derived on read by `deriveSessionStatus` in `@acp/core` **[implemented]**. Without hooks, sessions never reach `ended`; they become `stale`, which is the
truthful answer. Stale never means completed.

## 8. Errors and version drift

- Any per-file error (permission, size cap, symlink escape, invalid meta) is surfaced in diagnostics
  (`adapter.diagnostics()`, §10), because the core `Checkpoint` has no error field. Schema-invalid
  lines are counted in the checkpoint's `parseErrors`. Other files continue.
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

## 10. Claude Code adapter: implementation notes and unverified assumptions **[implemented, P1-C]**

`createClaudeCodeAdapter({ claudeDir, now?, maxFileBytes?, chunkBytes? })` returns an
`ObservationAdapter` plus `diagnostics()`. `hookSettingsSnippet({ port, tokenEnvVar })` returns the
settings JSON as text. Both come from `src/index.ts`. Goldens for scenarios 1-16 are in
`test-fixtures/claude-code/*/expected/`.

### 10.1 Implemented behavior worth knowing

- **Identity comes from the path, not the line.** `providerSessionId` and `providerAgentId` are
  taken from the allowlisted file name. A forked file therefore yields events under its own session
  even though its copied lines carry the old `sessionId`.
- **Record keys.** `cc:tx:{sid}:{agentId|main}:{uuid}` or `…:h:{sha256(line bytes)}` when a line has
  no uuid (every unrecognized record, `cost-state`, and title records without a uuid). Event suffixes:
  `#session #cwd #user #assistant #tool:{id} #result:{id} #usage #snapshot #title #error
#unrecognized`. Meta: `cc:meta:{sid}:{aid}:h:{sha256(file bytes)}#spawned`. Hook:
  `cc:hook:{sid}:{event}:{tool_use_id|sha256(canonical body)}`. Two identical lines in one file
  share a hash key and are stored once.
- **Subagent meta** (`subagent.spawned`, channel `subagent-meta`, `occurredAt` null) is read whole
  (at most 1 MiB), only for `agentType`, `description` (redacted, 200 chars), `toolUseId`,
  `spawnDepth`, and `model`. The parent field is the session directory; the adapter never guesses a
  deeper parent (core matches `spawnToolUseId`). Invalid JSON gives an `invalid-meta` diagnostic and
  no event, and is retried on the next poll.
- **Hooks** (`normalizeHook`): `session_id` must be a UUID. Unknown `hook_event_name` gives `[]`.
  `SubagentStart/Stop` need a valid `agent_id`. `source.path` is the real path of the hook's
  transcript only when it passes the allowlist **and** names the same session (SubagentStop prefers
  `agent_transcript_path` and requires the same agent id); otherwise null. Only short
  identifier-like values are copied (`source`, `reason`, `notification_type`, `agent_type`, `model`);
  `last_assistant_message`, `message`, `title`, `prompt_id`, `effort`, `background_tasks`,
  `session_crons`, and tool fields are never read (they still enter the body hash of the key).
- **Titles and descriptions** use the core `redact()`, whitespace collapse, and a 200 code point cap.
- **Non-`user`/`assistant`/`system` records** are identified by `type` only. Their other fields,
  including a `cwd`, are never read. A `system` record that is not `api_error` becomes
  `record.unrecognized` with `recordType: system:<subtype>`, unless the type is a known, ignored one
  (§4.4).
- **Diagnostics** (core `AdapterDiagnostics`, ADR-0011). The core `Checkpoint` has no error field, so
  per-file issues (size cap, symlink escape, I/O error, `invalid-meta`) are exposed through
  `adapter.diagnostics()`, with paths relative to the Claude data root. It also returns
  `ignoredRecords` (counts by type, §4.4), `parseErrors`, and the Claude-specific
  `recordsByVersion`. Schema-invalid complete lines are added to the checkpoint's `parseErrors`.
  Counts are in memory since the adapter was created.
- **Meta and unchanged files** are skipped by checkpoint (identity, size, mtime).

### 10.2 Unverified assumptions (all synthetic-fixture based)

| Assumption                                                                                                                                                                                           | Where it matters                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `cost-state` per-model keys are `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, plus `totalCostUSD`                                                               | `usage.snapshot` payload              |
| Title records use `customTitle` / `aiTitle` (fallback `title`)                                                                                                                                       | `session.titled`                      |
| `system`/`api_error` `error` mirrors the Anthropic SDK error (`status`, nested `error.error.type`)                                                                                                   | `provider.error` kind and status      |
| Hook field names `notification_type` (Notification) and `model` (SessionStart; absent in the captured `startup` payload). All other hook fields the adapter reads were verified with 2.1.296 (§10.4) | Notification, SessionStart            |
| A hook's `transcript_path` / `agent_transcript_path` names the same session / agent as `session_id` / `agent_id` (the layout was verified, the id equality was not)                                  | `source.path` of hook events          |
| Nested (depth above 1) subagent files live flat under the top-level session's `subagents/`                                                                                                           | discovery of nested subagents         |
| A subagent's `cwd` may be in a worktree, so a subagent file is eligible when its parent transcript is                                                                                                | eligibility                           |
| A candidate root's `lastSeenAt` is the transcript file mtime (no content read)                                                                                                                       | `discoverCandidates`                  |
| Lines without a `uuid` (and unrecognized lines) are keyed by line hash, so identical duplicate lines collapse                                                                                        | dedup keys                            |
| Identical hook bodies without `tool_use_id` share a key. With 2.1.296 bodies carry a per-prompt `prompt_id`, so only a repeat within one prompt collapses (§10.4)                                    | "needs attention" freshness           |
| Records without a `version` inherit the last `version` seen earlier in the same file                                                                                                                 | `providerVersion`, per-version counts |
| `cost-state`, title, and unrecognized records carry no usable timestamp, so `occurredAt` is null                                                                                                     | ordering                              |
| Hooks never carry usage; `PostToolUse` usage is ignored on purpose                                                                                                                                   | usage-accounting scenario 2           |

### 10.3 Known gaps

- Hook payloads were captured from one runtime version (2.1.296) in two non-interactive `claude -p`
  runs. `Notification` (never fires in `-p`), interactive-only values (other `source`/`reason`
  values, `permission_mode` other than `default`) and SessionStart `model` were not observed.
- Depth above 1 is covered by a synthetic fixture only (scenario 5).
- Transcript ingestion was verified against one real project in P1-F
  ([F2 note](research/p1-f-real-data-2026-10-10.md)); the field-name assumptions in §10.2 that the
  F2 totals do not exercise (titles, `cost-state` per-model keys, `api_error`) remain unverified.

### 10.4 Hook payloads observed with 2.1.296 **[verified-local, 2026-10-11]**

Shape-only capture (key names, value types, string lengths; no values), approved by the project
owner, in a throwaway directory with project-level `.claude/settings.local.json` generated by
`hookSettingsSnippet` ([research note](research/p1-c6-hook-capture-2026-10-11.md)).

| Event           | Keys (in delivery order)                                                                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`  | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source` (`startup`). Only via a `command` hook; never delivered to the `http` hook                                                                                                        |
| `CwdChanged`    | `session_id`, `transcript_path`, `cwd` (the new directory), `prompt_id`, `hook_event_name`, `old_cwd`, `new_cwd`                                                                                                                                      |
| `SubagentStart` | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `agent_id`, `agent_type`, `hook_event_name`                                                                                                                                                      |
| `SubagentStop`  | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `agent_id`, `agent_type`, `effort` (`{level}`), `hook_event_name`, `stop_hook_active`, `agent_transcript_path`, `last_assistant_message`, `background_tasks`, `session_crons` |
| `Stop`          | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`                                                                |
| `SessionEnd`    | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `reason` (`other` for a `-p` exit)                                                                                                                                            |

- `session_id` and `prompt_id` are UUIDs; `agent_id` is 17 alphanumeric characters (matches the
  allowlist's agent id pattern). `transcript_path` has the top-level transcript layout,
  `agent_transcript_path` the `subagents/agent-<id>.jsonl` layout.
- **Dedup key finding.** No delivery id or timestamp exists. `prompt_id` is the same for every event
  of one prompt and changes with the next prompt: one session delivered two `Stop`s with different
  `prompt_id`s, and their bodies differed, so they got different keys. A `Stop` body also contains
  `last_assistant_message`. A repeated delivery that is identical in every field (same event, same
  prompt) still collapses; none was seen. **No discriminator was added**; the §3 key is unchanged.

## 11. Managed mode: Claude Agent SDK **[implemented, P3-B; fake-query tests only]**

`createManagedClaudeCode({ query? })` in `@acp/adapter-claude-code` (`src/managed/**`) implements
core's `ManagedExecutionAdapter` (ADR-0012, ADR-0013). Everything below was read from the pinned
SDK's type declarations (`@anthropic-ai/claude-agent-sdk` 0.3.296, `sdk.d.ts`) and is exercised
only against a scripted fake `query`. **No real run has happened yet** (that is P3-F).

### 11.1 How the adapter uses the SDK

- One `query({ prompt, options })` per agent. `prompt` is an async iterable of `SDKUserMessage`
  (streaming input); the first message is `spec.prompt`, and `send()` pushes more.
- Options: `cwd`, `abortController`, `permissionMode: 'default'`, `settingSources: ['project']`,
  `canUseTool`, `strictMcpConfig: true`, `model` only when the spec names one, and `mcpServers`
  that holds `{ acp: createSdkMcpServer(...) }` for the lead and nothing for workers. It never sets
  `bypassPermissions`, `allowDangerouslySkipPermissions` or `allowedTools`.
- `canUseTool`:
  - Allows `Read`, `Glob`, `Grep` and `LS` when their target path is inside the agent's `cwd`
    (lexically) and Claude Code did not flag a `blockedPath`.
  - Allows the lead's own `mcp__acp__<tool>` when `mcpServer.source === 'sdk'`, or when the field is
    absent (older CLIs). The SDK says trust is keyed on `source`, not on the name.
  - Denies any `mcp__acp__*` to a worker without asking.
  - Everything else goes to `requestPermission`, with a summary of the tool name plus its target path
    (or, for `Bash`, only the command name), redacted and at most 200 characters.
  - A rejected request, or an aborted signal, gives a deny.
- Message mapping:
  - `system/init` → `started` (once; the CLI re-sends `init` on each turn of a headless run).
  - Assistant `tool_use` blocks → `activity` with the same summary.
  - Assistant `message.usage` → `usage` for each frame, keyed by `message.id`.
  - The lead's main-thread `text` blocks → `lead-text`.
  - `result` marks the end of a turn.
  - Worker text, thinking, tool input and output, and the result text are never emitted.
- `finished`:
  - **Lead:** the input stays open for chat; `finished` comes only on abort or an SDK failure.
  - **Worker:** the input is closed after a `result` whose `queued_turn_count` is 0 or absent, so
    the query ends and `finished` follows. After that, `send()` throws `ManagedAgentEndedError`.
  - `abort()` aborts the controller, calls `Query.close()`, and ends the event stream at once with
    `finished: cancelled`. Messages that are still in flight are dropped; the transcript still has
    them for observation.
  - `reportedCostUsd` is the latest result's `total_cost_usd`.

### 11.2 SDK facts from the 0.3.296 declarations (unverified at runtime)

- **Streamed assistant frames share `message.id`.** The CLI emits one assistant message per finished
  content block, and they share `message.id`. Their `usage` is not final, so the engine has to keep
  one observation per id (usage-accounting §4).
- **`total_cost_usd` is a running total.** In streaming-input sessions it is cumulative across turns.
  Read the latest result; never sum results. Crash and startup-error results "may carry zeroed
  values", so the adapter reports a 0 cost on an error result as unavailable (`null`).
- **`modelUsage` covers more than `usage`.** It includes subagents and internal calls, while
  `result.usage` covers the main loop only. The adapter uses neither: budget usage comes from
  per-message `usage`.
- **What subagent frames carry.** They have `parent_tool_use_id` set. By default only their
  `tool_use`/`tool_result` blocks are forwarded (`forwardSubagentText` is off).
- **Permission rules can skip `canUseTool`.** The callback runs only when the permission system would
  prompt. With `settingSources: ['project']`, a project's `.claude/settings.json` `permissions.allow`
  rules (and its hooks) apply, and an allow rule approves a tool without asking the owner. See the
  P3-B report for the proposal.
- **`strictMcpConfig` ignores other MCP configuration.** It ignores project `.mcp.json`, user
  settings, plugins and agent frontmatter MCP servers, so only `mcpServers` from the options load.
- **`env` is inherited.** When `env` is omitted, the CLI subprocess inherits `process.env`.
- **The binary comes from an optional dependency, not a script.** The SDK ships its platform binary
  as an optional dependency (`@anthropic-ai/claude-agent-sdk-darwin-arm64` here). It has no install
  script, so pnpm 10's build-script block does not affect it.
