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

## CX-1 spike results (2026-11-07)

Real `codex app-server` runs with the owner's consent: model `gpt-6.1-sol`, effort `low`, the
owner's ChatGPT login, six short prompts in throwaway repos (a main checkout plus a linked
worktree, the same layout ACP uses). The spike client logged only methods, counts, commands and
exit codes. The repos were deleted afterwards.

Spawn arguments used: `--disable` for `hooks`, `multi_agent`, `plugins`, `apps`, `remote_plugin`,
`goals`, `memories`, `image_generation`, `browser_use`, `computer_use`, `guardian_approval`,
`tool_suggest`, `skill_mcp_dependency_install`, `daemon_auto_start`, `in_app_browser`; and
`-c project_doc_max_bytes=0 -c mcp_servers={} -c web_search="disabled"`. `initialize` declared
`experimentalApi: true`.

1. **Login.** `account/read` returned `account.type = "chatgpt"`. That is enough for an
   availability check; ACP needs no other account data.
2. **Instructions are isolated.** With `project_doc_max_bytes=0`, `thread/start` returned
   `instructionSources: []` although the repo had an `AGENTS.md` (a canary instruction that never
   showed in replies). `developerInstructions` reached the model.
3. **Usage: one notification per model request.** Each `thread/tokenUsage/updated` carries `last`
   (that one request) and `total` (cumulative for the thread). For every consecutive pair,
   `total[n] − total[n−1] = last[n]` exactly. `total` continues across turns and after
   `thread/resume`. `inputTokens` includes `cachedInputTokens` (for example 11074 input with
   10624 cached). A steered turn produced an extra short request (1 output token).
4. **Resume replays the last usage notification.** Right after `thread/resume`, the server sent the
   previous turn's last notification again with identical `turnId`, `total` and `last`. A dedup key
   must therefore be stable across that replay.
5. **Dynamic tools work.** A `function` dynamic tool given on `thread/start` was called through
   `item/tool/call` with schema-valid arguments; the `{ contentItems, success }` answer was
   accepted and the turn went on.
6. **Manual mode intercepts writes.** With sandbox `read-only` and policy `on-request`, the model
   tried a shell write; the server sent `item/commandExecution/requestApproval` with the command
   and cwd before running it. `decline` was honoured (item status `declined`, no file written).
   The edit came as a command, not a `fileChange`, so ACP must screen both request kinds.
7. **Steer works.** `turn/steer` with `expectedTurnId` was accepted mid-turn and the model followed
   it in the same turn.
8. **Git protection holds, except under temp dirs.** In `workspace-write`, with the repo under the
   home directory, `git add`, `git commit`, `git branch` and `git checkout -b` all exited 128 from
   a linked worktree, and nothing changed. With the repo under `/tmp`, a branch was created: the
   default `workspaceWrite` policy also makes `/tmp` and `$TMPDIR` writable
   (`excludeSlashTmp: false`, `excludeTmpdirEnvVar: false`), and that includes any `.git` there.
   ACP must refuse a writing Codex agent whose repository's common git directory is inside a
   writable root (the worktree, `/tmp`, `$TMPDIR`), or pass a `sandboxPolicy` that excludes them.

Not verified: `turn/interrupt` timing, whether a model ever uses `fileChange` approvals in manual
mode, and whether the overrides also stop native subagents (none were attempted).

## CX-1b: permission profiles deny reads (2026-11-07)

Owner-requested follow-up, same model and login, three short prompts, a throwaway repo and a
secret file under the home directory (deleted afterwards). Docs:
[Codex permissions](https://learn.chatgpt.com/docs/permissions.md) (beta).

Profiles are defined at spawn with `-c` and selected per thread with the experimental
`thread/start` field `permissions` (no `sandbox` field: a legacy `sandbox` setting overrides
profiles):

```
-c 'permissions.acp-write.extends=":workspace"'
-c 'permissions.acp-write.filesystem={"<secret dir>"="deny", ":tmpdir"="deny", ":slash_tmp"="deny"}'
-c 'permissions.acp-read.extends=":read-only"'
-c 'permissions.acp-read.filesystem={...same...}'
-c 'default_permissions="acp-read"'
```

1. `permissionProfile/list` listed both profiles as allowed. `thread/start` answered with
   `activePermissionProfile { id, extends }` and the matching sandbox; for `acp-write` it reported
   `excludeTmpdirEnvVar: true, excludeSlashTmp: true` (the `:tmpdir`/`:slash_tmp` denies).
2. **Reads are denied on macOS.** Reading the secret through a symlink inside the worktree
   (`cat notes.txt`, `wc -c notes.txt`) exited 1 in `acp-write`; the secret text never appeared in
   any output. When the path was named directly, the model saw the policy and did not try.
3. Inside the profiles: reading the worktree worked (exit 0); `acp-write` could write the worktree
   (exit 0) but `git commit` exited 128 (`:workspace` keeps `.git` read-only); `acp-read` could not
   write (exit 1).

Consequence: ADR-0022's `denyRead` can be enforced for Codex by a per-agent profile built from the
spec's `denyRead` (each agent has its own app-server process, so the `-c` flags are per agent), and
the same deny list can protect every Codex agent, not only Full auto. Writes outside the worktree
and run temp dir stay blocked.
