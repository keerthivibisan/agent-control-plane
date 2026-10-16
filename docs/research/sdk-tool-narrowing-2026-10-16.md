# Agent SDK: narrowing a managed agent's tools (2026-10-16)

Research for WP R-I (docs/redesign/README.md §6a): how the adapter can apply a project agent file's
`tools` list so it only **narrows** a role's tools. Sources: the Agent SDK TypeScript reference,
the SDK permissions page, the Claude Code subagents page and the tools reference (code.claude.com
docs, read 2026-10-16), plus the JSDoc in the installed `@anthropic-ai/claude-agent-sdk` 0.3.296
(`sdk.d.ts`). Nothing was run against Claude; the claims marked _inference_ must be checked in the
R-V real smoke run (owner consent).

## Findings

1. **`allowedTools` does not restrict** ("This does not restrict Claude to only these tools") and
   auto-approves matching calls, which would skip our `canUseTool` gate. Never use it. (Documented.)
2. **`disallowedTools`** with a bare name removes the tool from the model's context ("removed from
   the model's context and cannot be used, even if they would otherwise be allowed", sdk.d.ts). A
   scoped rule such as `Bash(rm *)` keeps the tool and denies matching calls. Deny rules are
   evaluated before permission mode, allow rules and `canUseTool`. (Documented.) A bare
   `mcp__server__tool` removing one MCP tool is _inference_; server-level specs are documented for
   `AgentDefinition.disallowedTools`.
3. **`tools: string[]`** sets "the base set of available built-in tools" (`[]` disables them all).
   It narrows and does not approve anything. It covers built-ins only, so our in-process `acp` MCP
   control tools are unaffected. If skills are used, `Skill` must be in the list. Native builds may
   offer search through Bash, so `Grep`/`Glob` must be listed to get them. (Documented in sdk.d.ts.)
4. **Applying a file with the SDK `agent` option is unsafe for us.** It replaces the system prompt
   and brings in the file's hooks, `mcpServers` and `initialPrompt`. We parse the file ourselves
   instead. (Documented behaviour of `--agent`; applying it to the SDK `agent` option is _inference_.)
5. **Front-matter keys that can widen permissions**, which we therefore ignore: `permissionMode`
   (`acceptEdits` auto-approves edits and skips `canUseTool`), `mcpServers` (adds tools), `hooks` (a
   PreToolUse allow short-circuits the flow, _inference_), `skills` (adds `Skill`), `memory` (adds
   Read/Write/Edit), `initialPrompt`. Neutral or narrowing: `tools`, `disallowedTools`, `model`,
   `maxTurns`, `effort`. (Documented list.)
6. **Gotchas.**
   - `Task` was renamed `Agent` (Claude Code 2.1.63). `Task` still works as an alias.
   - `Agent`, read-only Bash and reads inside the working directory run without `canUseTool` in
     default mode, so the gate alone cannot narrow them. A base set or deny rule can.
   - Omitting `permissionMode` can start in auto mode. Keep passing `'default'` explicitly.

## Decision for the adapter (recorded in ADR-0019 §6)

When `profile.tools` is set:

- `options.tools` = the file's tools, kept only where the role allows them, plus `Skill` when the
  run has a skills plugin.
- A read-only role keeps its `disallowedTools`.
- The `canUseTool` gate also denies any built-in that is not in the list, as a second layer.

The role's `mcp__acp__*` control tools are never removed, because they are the stage's contract,
for example `submit_plan` and `post_review`. `allowedTools` is never set. With `profile.tools` null,
nothing changes.
