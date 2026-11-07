# Codex app-server protocol (CLI 0.166.0), 2026-11-07

Evidence for [ADR-0031](../decisions/0031-codex-provider.md) and
[ADR-0032](../decisions/0032-codex-usage-accounting.md). Source: TypeScript bindings and JSON
Schema generated locally with `codex app-server generate-ts --out <dir>` (and `--experimental`)
and `codex app-server generate-json-schema --out <dir>`, Codex CLI `codex-cli 0.166.0`. Generating
the bindings makes no network call and reads no session data. The protocol is marked
experimental by Codex and may change between versions: pin the CLI version in tests and record
the version the adapter was checked against.

## Transport

`codex app-server` speaks JSON-RPC 2.0 over stdio, one JSON message per line. The client sends
`initialize`, then requests. The server sends responses, notifications, and its own requests that
the client must answer (approvals, dynamic tool calls).

## Requests ACP needs (client → server)

| Method                  | Use in ACP                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`            | handshake, client info, capabilities                                                                                                  |
| `account/read`          | availability check: is the owner signed in                                                                                            |
| `thread/start`          | one agent: `model`, `cwd`, `approvalPolicy`, `sandbox`, `config`, `developerInstructions`, `ephemeral`, `dynamicTools` (experimental) |
| `thread/resume`         | follow-up and rework on a thread of the same provider                                                                                 |
| `turn/start`            | a message when no turn is active: `input`, `effort`, `model`, `sandboxPolicy`, `approvalPolicy`                                       |
| `turn/steer`            | a message during an active turn (`expectedTurnId` precondition)                                                                       |
| `turn/interrupt`        | stop an agent                                                                                                                         |
| `skills/extraRoots/set` | give Codex ACP's skill directories                                                                                                    |

## Server requests ACP must answer (server → client)

- `item/commandExecution/requestApproval`: `command`, `cwd`, `reason`, `itemId`, `turnId`. Allows
  ACP to screen a command (branch guard) and route it to the owner in manual mode.
- `item/fileChange/requestApproval`: `itemId`, `reason`, `grantRoot` (unstable).
- `item/permissions/requestApproval`, `item/tool/requestUserInput`,
  `mcpServer/elicitation/request`: answered with a refusal in managed runs unless mapped later.
- `item/tool/call` (`threadId`, `turnId`, `callId`, `namespace`, `tool`, `arguments`): a dynamic
  tool call; answered with `{ contentItems, success }`. This is how ACP's lead tools are served.
- Legacy `applyPatchApproval` and `execCommandApproval`: refused.

## Notifications ACP maps

- `thread/started`, `turn/started`, `turn/completed`: lifecycle (`started`, `finished`).
- `item/started`, `item/completed`: activity (summarised and redacted; no content stored).
- `item/agentMessage/delta`: the lead's text (`lead-text`), never stored.
- `thread/tokenUsage/updated { threadId, turnId, tokenUsage: { total, last, modelContextWindow } }`
  with breakdown `{ totalTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens,
outputTokens, reasoningOutputTokens }`. No message id.
- `error`, `process/exited`: failure.

## Settings

- `AskForApproval`: `untrusted` | `on-request` | `never` | `{ granular: {...} }`.
- `SandboxMode` (thread): `read-only` | `workspace-write` | `danger-full-access`.
- `SandboxPolicy` (turn): `readOnly{networkAccess}` | `workspaceWrite{writableRoots,
networkAccess, excludeTmpdirEnvVar, excludeSlashTmp}` | `externalSandbox` | `dangerFullAccess`.
- `-c key=value` overrides any `config.toml` value at spawn time.

## Not yet verified (CX-1 spike)

- Whether `total` is cumulative per thread and survives `thread/resume`; notifications per turn.
- Whether `dynamicTools` works with the owner's ChatGPT login and this model set.
- Whether manual mode (read-only sandbox) raises `item/fileChange/requestApproval` for every edit.
- Whether the sandbox blocks writes to a linked worktree's git directory (commit, branch).
- Which `-c` overrides disable project `AGENTS.md` loading, user MCP servers, plugins, native
  subagents and web search.
- Steer and interrupt timing.
