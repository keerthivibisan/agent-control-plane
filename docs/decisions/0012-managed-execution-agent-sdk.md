# ADR-0012: Managed execution through the Claude Agent SDK

- **Status:** accepted (project owner, 2026-10-11)
- **Date:** 2026-10-11
- **Resolves:** roadmap Q2

## Context

Phase 3 starts and steers Claude Code runs from the control panel: a lead agent the owner chats
with, and up to three worker agents it starts. ADR-0004 reserved a separate managed-execution
interface. Two engines were possible: spawning `claude -p` with stream-json, or the official Claude
Agent SDK.

## Decision

- Use `@anthropic-ai/claude-agent-sdk` (pinned, 0.3.296 at adoption), only inside
  `@acp/adapter-claude-code` (`src/managed/**`), behind core's `ManagedExecutionAdapter`
  (`packages/core/src/adapters/managed.ts`).
- One `query()` per agent, with streaming input (`prompt` as an async iterable) so the owner's chat
  and `message_agent` reach a running agent; `abortController` for stop; `interrupt()` to stop a turn.
- The lead agent gets an in-process MCP server (`createSdkMcpServer`) exposing exactly the tools in
  `LeadToolInputs`: `start_agent`, `list_agents`, `message_agent`, `stop_agent`, `agent_status`,
  `request_review`. Their handlers call the engine, which validates every call (ADR-0013). Workers
  never get these tools (depth 1).
- `permissionMode: 'default'` with a `canUseTool` callback (ADR-0013). `bypassPermissions` is never
  used.
- `settingSources: ['project']`: the project's own Claude settings and CLAUDE.md apply; the owner's
  user-level settings and hooks are not loaded into managed runs.
- Tests never call the real SDK: the adapter takes an injectable `query` function.

## Alternatives considered

- `claude -p --input-format stream-json --output-format stream-json`: no new dependency, but we
  would parse the stream, manage processes and permission prompts ourselves.

## Consequences

A new pinned dependency and its peers (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`). SDK
upgrades are deliberate coordinator changes. Managed sessions still write normal transcripts, so the
Phase 1 observation pipeline sees them.
