# @acp/adapter-claude-code

**Owner:** work package P1-C (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** implemented (C0-C7) and tested against synthetic fixtures only. Real hook payloads have
not been captured, and nothing has been run against real Claude Code data (that is P1-F). Details
and every unverified assumption: [docs/provider-adapters.md](/docs/provider-adapters.md) §10.

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
adapter.diagnostics(); // per-file issues, records by runtime version, parse errors
hookSettingsSnippet({ port, tokenEnvVar }); // JSON text for the user to paste; writes nothing
```

`createClaudeCodeAdapter` returns the core `ObservationAdapter` plus `diagnostics()`. Defaults:
512 MiB size cap, 1 MiB read chunks, system clock.

## Tests and goldens

Golden events live in `test-fixtures/claude-code/<scenario>/expected/`. After an intentional change,
regenerate with `UPDATE_GOLDEN=1 pnpm --filter @acp/adapter-claude-code test` and **review the diff
by hand** before committing. Tests never read the real `~/.claude`.

## Allowed dependencies

`@acp/core`, `zod`, Node built-ins. **Never** `@acp/db` or `@acp/server`; adapters do not persist. These rules are enforced by `eslint.config.js`.
