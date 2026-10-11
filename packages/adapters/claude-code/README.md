# @acp/adapter-claude-code

**Owner:** work package P1-C (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** implemented (C0-C7), tested against synthetic fixtures, checked against one real
project in P1-F, and hook payload shapes captured from Claude Code 2.1.296 (shape only;
`Notification` not observed). Details and every unverified assumption:
[docs/provider-adapters.md](/docs/provider-adapters.md) §10.

## Responsibility

Claude Code observation adapter: allowlisted discovery, incremental JSONL reading with checkpoints,
record normalization, subagent metadata, hook payload normalization, and the capability report.
Spec: docs/provider-adapters.md. It only reads `<claudeDir>/projects/` and never writes the
database, the Claude data directory, or Claude Code settings. No conversation content is copied into
events (ADR-0009).

## Public API (`src/index.ts`)

```ts
import { createClaudeCodeAdapter, hookSettingsSnippet } from '@acp/adapter-claude-code';

const adapter = createClaudeCodeAdapter({ claudeDir, now?, maxFileBytes?, chunkBytes? });
await adapter.capabilities();
await adapter.discoverCandidates(roots);
for await (const batch of adapter.poll(roots, checkpoints)) { /* commit events + nextCheckpoint */ }
adapter.normalizeHook(body, receivedAt); // throws HookPayloadError on a bad body
adapter.diagnostics(); // core AdapterDiagnostics (file issues, ignored records by type, parse errors) + records by version
hookSettingsSnippet({ port, tokenEnvVar }); // JSON text for the user to paste; writes nothing
```

`createClaudeCodeAdapter` returns the core `ObservationAdapter` plus `diagnostics()`. Defaults:
512 MiB size cap, 1 MiB read chunks, system clock.

## Managed mode (`src/managed/**`, P3-B)

`createManagedClaudeCode({ query? })` implements core's `ManagedExecutionAdapter` over the Claude
Agent SDK (ADR-0012, ADR-0013). It is the only code in the repo that imports
`@anthropic-ai/claude-agent-sdk`.

```ts
import { createManagedClaudeCode } from '@acp/adapter-claude-code';

const adapter = createManagedClaudeCode(); // tests: createManagedClaudeCode({ query: fake })
const handle = adapter.start(spec, { requestPermission });
for await (const event of handle.events) {
  /* started | activity | usage | lead-text | finished */
}
await handle.send(text); // throws ManagedAgentEndedError once finished
await handle.interrupt();
handle.abort(); // ends the iterator now, with finished: cancelled
```

- **Permissions.**
  - The SDK options use `permissionMode: 'default'`, `settingSources: ['project']` and
    `strictMcpConfig: true`.
  - Read-only tools (Read, Glob, Grep, LS) inside the agent's directory, and the lead's own
    `mcp__acp__*` tools, run without asking. Everything else asks the owner with a redacted,
    content-free summary of at most 200 characters.
  - Workers never get the lead tools.
- **Events.**
  - Activity is the tool name plus its target path or command name.
  - Usage is reported per assistant message id.
  - Lead text is the lead's main-thread text only; worker text is never emitted.
  - A worker ends after a turn with nothing queued; the lead runs until `abort()`.

Details and SDK facts: [docs/provider-adapters.md](/docs/provider-adapters.md) §11. Tests use a
scripted fake `query` (`tests/managed/fake-query.ts`). The real SDK `query` is mocked to fail, so
no test can start Claude.

## Tests and goldens

Golden events live in `test-fixtures/claude-code/<scenario>/expected/`. After an intentional change,
regenerate with `UPDATE_GOLDEN=1 pnpm --filter @acp/adapter-claude-code test` and **review the diff
by hand** before committing. Tests never read the real `~/.claude`.

## Allowed dependencies

`@acp/core`, `zod`, Node built-ins, and `@anthropic-ai/claude-agent-sdk` (managed mode only).
**Never** `@acp/db` or `@acp/server`; adapters do not persist. These rules are enforced by `eslint.config.js`.
