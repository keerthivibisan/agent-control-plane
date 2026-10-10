# P1-C6: real hook payload capture (shape only) — 2026-10-11

The project owner approved this capture in chat with these conditions, all of which were followed:
a throwaway directory from `mktemp` (outside the repo and `~/.claude`), hook configuration only in
that directory's project-level `.claude/settings.local.json`, a receiver on `127.0.0.1` (random port)
that records **shape only**, one or two short `claude -p` runs, and deletion of the throwaway
directory afterwards. No existing settings file was edited. The transcripts these runs created under
`~/.claude/projects/` were not read and not deleted.

## Setup

- Claude Code **2.1.296** (`claude --version`), non-interactive `claude -p --model haiku`, tools
  allowed: `Bash(cd:*)`, `Agent`, `Task`. The prompt asked it to run `cd sub` and use the Agent tool
  once. Model output was discarded unread.
- `.claude/settings.local.json` was the exact output of the adapter's
  `hookSettingsSnippet({ port, tokenEnvVar: 'ACP_HOOK_TOKEN' })` (all 7 subscribed events as
  `type: "http"`). Run 2 added a `command` hook for `SessionStart` that forwarded stdin with `curl`
  to a distinct URL path, to tell whether `SessionStart` fires at all.
- The receiver kept: header names, whether the token header equalled the expected token, key names
  in order, value types, string lengths, literal values only for `hook_event_name`, `source`,
  `reason`, `notification_type`, `agent_type`, `stop_hook_active`, `permission_mode`; ids replaced by
  an in-memory alias (`id#1`, …) to show equality; paths replaced by `<path>` plus layout flags.
  Free-text fields (`last_assistant_message`, `prompt`, `message`, `title`, tool fields) were reduced
  to type and length. Raw bodies were never written or printed.

## Results

Run 1 (http only): `CwdChanged`, `SubagentStart`, `SubagentStop`, `Stop`, `Stop`, `SessionEnd`.
Run 2 (http + command `SessionStart`): `SessionStart` (command path only), `CwdChanged`,
`SubagentStart`, `SubagentStop`, `Stop`, `Stop`, `SessionEnd`.

- **Snippet shape works.** Every http delivery was `POST` to the configured path with
  `Content-Type: application/json`, and the `X-ACP-Hook-Token` header held the expanded value of
  `$ACP_HOOK_TOKEN` (`allowedEnvVars`), not the literal `$…`.
- **`SessionStart` is not delivered to `type: "http"` hooks** in this version: in run 2 the command
  hook fired and the http hook for the same event did not. The snippet now omits `SessionStart`.
- **`Notification` did not fire** (expected for `-p`, which has no prompts or idle state), so its
  payload stays unverified.

Field names per event (keys in delivery order):

| Event           | Keys                                                                                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`  | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`=`startup`                                                                                                                                                                                                                                    |
| `CwdChanged`    | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `old_cwd`, `new_cwd`                                                                                                                                                                                                                     |
| `SubagentStart` | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `agent_id`, `agent_type`=`general-purpose`, `hook_event_name`                                                                                                                                                                                               |
| `SubagentStop`  | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`=`default`, `agent_id`, `agent_type`, `effort` (object with `level`, string), `hook_event_name`, `stop_hook_active`=false, `agent_transcript_path`, `last_assistant_message` (string), `background_tasks` (array), `session_crons` (array) |
| `Stop`          | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`                                                                                                                           |
| `SessionEnd`    | `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `reason`=`other`                                                                                                                                                                                                                         |

- `session_id`, `prompt_id`: 36-character UUIDs. `agent_id`: 17 characters, alphanumeric.
- `transcript_path`: absolute, `.jsonl`, top-level transcript layout. `agent_transcript_path`:
  absolute, `subagents/agent-<id>.jsonl` layout. Whether the ids inside these paths equal
  `session_id`/`agent_id` was not checked (the receiver did not compare them).
- `CwdChanged`: `old_cwd` was the throwaway directory, `new_cwd` and `cwd` were inside it.
- `SessionStart` (command hook) had **no `model` field** and no `prompt_id`.

## Comparison with the adapter's assumptions (provider-adapters §10.2)

| Assumption                                              | Result                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `old_cwd` / `new_cwd` on `CwdChanged`                   | confirmed                                                  |
| `agent_id`, `agent_type` on Subagent events             | confirmed; `agent_id` matches the allowlist pattern        |
| `agent_transcript_path` on `SubagentStop`               | confirmed (not on `SubagentStart`)                         |
| `source` on `SessionStart`, `reason` on `SessionEnd`    | confirmed                                                  |
| `model` on `SessionStart`                               | **not present** in the captured `startup` payload          |
| `notification_type` on `Notification`                   | not observed                                               |
| Snippet shape (`type: "http"`, headers, allowedEnvVars) | confirmed for 5 events; **`SessionStart` never delivered** |

## Hook dedup key

The usage-accounting §3 key is `cc:hook:{session_id}:{event}:{tool_use_id or sha256(body)}`. The
payloads carry **no delivery id and no timestamp**, but every event except `SessionStart` carries
`prompt_id`. Within one prompt all events shared one `prompt_id`. Run 2 delivered two `Stop`s with
**different** `prompt_id`s (aliases `id#2` and `id#4`; the second turn probably followed the
background subagent's completion, since `SubagentStop` listed one background task). In run 1, before
id aliasing was added, the two `Stop` bodies also differed. No delivery body in either run was
identical to an earlier body of the same event. So consecutive turns already get distinct keys, and the existing key needs no discriminator
for `Stop`. What still collapses is a delivery identical in every field within one prompt (for
example two identical `Notification`s in one turn, unobserved) and repeated `SessionStart` bodies
(no `prompt_id`; not delivered over http anyway). No code change was made to the key.

## Changes made from this evidence

- `hookSettingsSnippet` registers only `SessionEnd`, `SubagentStart`, `SubagentStop`, `Stop`,
  `Notification`, `CwdChanged` (`SNIPPET_HOOKS`).
- Scenario 13 fixtures follow the captured key sets with synthetic values; goldens regenerated.
- Capability limitations and provider-adapters §6, §10.2–§10.4 updated.
