# @acp/adapter-claude-code

**Owner:** work package P1-C (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Not implemented.** Dependencies are pinned.

## Responsibility

Claude Code observation adapter: allowlisted discovery, incremental JSONL reading with checkpoints, record normalization, subagent metadata, hook payload normalization, and the capability report. Spec: docs/provider-adapters.md.

## Allowed dependencies

`@acp/core`, `zod`, Node built-ins. **Never** `@acp/db` or `@acp/server`; adapters do not persist. These rules are enforced by `eslint.config.js`.
