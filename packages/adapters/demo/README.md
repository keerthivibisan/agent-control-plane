# @acp/adapter-demo

A deterministic observation adapter that replays the synthetic fixtures in
[`fixtures/`](fixtures/README.md) instead of reading a real provider. It exists for tests and for
`ACP_MODE=demo` only. In demo mode the server uses its own database file (`demo.sqlite`, separate
from the live `acp.sqlite`), so demo data never mixes with real data (ADR-0007). Every event it
emits has `provider: "demo"` and `source.channel: "demo"`.

## What it contains

| Path              | What is there                                             |
| ----------------- | --------------------------------------------------------- |
| `src/adapter.ts`  | `createDemoAdapter`, its constants and `DemoHookError`    |
| `src/fixtures.ts` | loads and validates the fixture files; `DemoFixtureError` |
| `src/paths.ts`    | POSIX path containment for registered-root matching       |
| `fixtures/*.json` | one demo source per file, standing in for a transcript    |

The fixtures cover two projects (`/home/user/demo-api`, `/home/user/demo-web`), a session with two
subagents, a fork, streaming duplicates, missing usage categories, a cumulative usage snapshot,
titles and a late "live" session. Ids, titles, model names (`claude-demo-*`) and paths are invented.

## Public API (`src/index.ts`)

```ts
createDemoAdapter({
  baseTime?: string | Date, // fixture offsets are relative to it; default 2026-10-10T08:00:00.000Z
  now?: () => Date,         // observedAt and record release; default fixed at baseTime + 1 day
  fixturesDir?: string,     // default: this package's fixtures/
}): ObservationAdapter
```

- `poll(roots, checkpoints)` yields one batch per fixture source whose `cwd` is inside a registered
  root (segment-wise containment). It resumes from the checkpoint and emits only records with
  `baseTime + t <= now()`, so a server that passes the real clock and a recent `baseTime` sees
  sessions appear over time (the server does this in demo mode). For demo sources, checkpoint
  `byteOffset` and `sizeBytes` count records, not bytes.
- A checkpoint whose `fileIdentity` or `headHash` (sha256 of the fixture file) no longer matches is
  reset to 0, as in the real adapter.
- `discoverCandidates(roots)` reports fixture `cwd`s outside the registered roots.
- `capabilities()` reports `managedExecution: false` and one limitation: the data is demo data.
- `normalizeHook` returns `[]` for any JSON object (the demo has no hooks) and throws
  `DemoHookError` otherwise. `diagnostics()` is always empty: fixtures are validated on load.
- Each record is wrapped in the normalized-event envelope and checked with core's
  `NormalizedEventSchema`; an invalid fixture throws `DemoFixtureError` on the first `poll` or
  `discoverCandidates`, not in the middle of a batch.

## Testing

`pnpm --filter @acp/adapter-demo test` (Vitest). `tests/demo-adapter.test.ts` covers
determinism, schema-valid events with unique dedup keys, timestamps, the required scenarios, root
matching, candidates, checkpoints and release over time, resets, hooks, capabilities and invalid
fixtures; `tests/core-resolution.test.ts` checks that `@acp/core` resolves to its TypeScript
source. The server's tests and the web package's browser tests use it through demo-mode servers.

## Dependency rules

`@acp/core` and Node built-ins only. Never `@acp/db`, `@acp/server`, `@acp/web` or
`@acp/orchestrator` (enforced by `eslint.config.js`). The server may import this package but not
its `fixtures/` files directly.

## Read next

- [docs/provider-adapters.md](../../../docs/provider-adapters.md) §9 (the demo adapter) and §1
  (the adapter contract)
- [ADR-0004: provider adapters](../../../docs/decisions/0004-provider-adapter-abstraction.md)
- [ADR-0007: demo isolation](../../../docs/decisions/0007-event-provenance-and-demo-isolation.md)
- [START.md: demo mode](../../../START.md) and [the claude-code adapter](../claude-code/README.md)
