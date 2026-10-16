# Agent SDK: resuming a saved session (2026-10-16)

Research for WP R-J (ADR-0020). Sources: the Agent SDK pages on sessions, the TypeScript
reference (Options, session functions, `SDKResultMessage`), permissions, modifying system prompts,
cost tracking and the agent loop, plus the Claude Code page on sessions (code.claude.com, read
2026-10-16). The installed SDK is 0.3.296. Nothing was run. The items marked _inference_ are checked
in the R-V real run (owner consent).

## Findings

1. **Same session id.** `resume: <id>` continues the original session and appends to its
   transcript. `forkSession` (default `false`) would create a new id with a copy of the history.
   `session_id` is on every result message. (Documented.) The init message reporting the same id
   is _inference_.
2. **Folder.** The transcript store key derives from the working directory, so resume from the
   original `cwd`, and keep `CLAUDE_CONFIG_DIR` the same. (Documented.) The lead runs in the
   project checkout, so this is the project root.
3. **Per-call options.**
   - Pass `tools`, `disallowedTools`, `permissionMode`, `canUseTool`, `mcpServers` and
     `strictMcpConfig` again on every resume. Per-call application is _inference_; plugin and MCP
     flags are documented as not restored.
   - Pass `permissionMode: 'default'` explicitly, because without it the mode can come from auto
     mode.
   - In-memory "allow for this session" grants do not carry over to a new process.
4. **The system prompt is not rebuilt.** The prompt is recorded on the session's first request and
   reused until compaction. A changed `append` is ignored unless `snapshot: false`, which the docs
   advise against. (Documented.) So the answers-only rule is enforced by the tool options. It is
   also stated in an app-written preface to the follow-up user message, not in the system prompt.
5. **Missing or aged-out session.**
   - The CLI message is "No conversation found with session ID: …".
   - Startup failures give an error result with zeroed totals and `errors`. A single-shot `query()`
     throws after yielding an error result. _Inference_ for this case: handle both.
   - Transcripts age out after 30 days by default (`cleanupPeriodDays`).
   - `getSessionInfo(id, { dir })` returns `undefined` when not found. It can be used as a
     pre-check without reading the transcript ourselves.
6. **Usage.**
   - All messages in one turn share a message id. Dedup by id, as we already do
     (usage-accounting).
   - A resumed result's `total_cost_usd` **includes the session's earlier spend**. Never sum
     results; that is our cumulative-snapshot rule.
   - The resumed stream emitting only new messages is _inference_. Dedup by `(provider, messageId)`
     covers a replay.
   - `maxBudgetUsd` counts only the call's own spend.
7. **Interrupted tool calls** in the transcript are not re-run. Claude sees them marked as cut off.
   Never resume one session id in two live processes, because the transcripts interleave.

## Consequences for R-J

- Resume with the lead's linked session id, `forkSession` false (the default) and `cwd` = project
  root. Then usage keeps flowing to the original lead agent through `agent_run_sessions` and the
  existing transcript tailer. No new session link is needed.
- Answers-only:
  - `tools: ['Read', 'Grep', 'Glob']`, plus `READ_ONLY_DISALLOWED_TOOLS`;
  - no `acp` MCP server; the gate denies everything else;
  - `allowedTools` is never set.
- Exactly one follow-up turn at a time per run; a second message waits or is refused.
- The budget for a follow-up turn is counted from per-message usage (the token budget), never from
  `total_cost_usd`.
- "Can't be continued":
  - no linked session;
  - managed agents off;
  - `getSessionInfo` undefined;
  - an error result or a throw.
