# @acp/adapter-demo

**Owner:** work package P1-C (task C0) (see [docs/implementation-plan.md](/docs/implementation-plan.md)).

**Status:** **Implemented (C0).** `createDemoAdapter(options)` implements `ObservationAdapter` over the
synthetic fixtures in [`fixtures/`](fixtures/README.md).

## Responsibility

Deterministic adapter replaying synthetic fixtures, for tests and `ACP_MODE=demo` only. Emits
`provider: "demo"` and `source.channel: "demo"`. Never used against the live database (ADR-0007).

## API

```ts
createDemoAdapter({
  baseTime?: string | Date, // fixture offsets are relative to it; default 2026-10-10T08:00:00.000Z
  now?: () => Date,         // observedAt and record release; default fixed at baseTime + 1 day
  fixturesDir?: string,     // default: this package's fixtures/
}): ObservationAdapter
```

- `poll(roots, checkpoints)` yields one batch per fixture source whose `cwd` is inside a registered
  root (segment-wise containment). It resumes from the checkpoint and emits only records with
  `baseTime + t <= now()`. A server in demo mode can pass the real clock and a recent `baseTime` to
  make sessions appear over time. For demo sources, checkpoint `byteOffset`/`sizeBytes` count records.
- A checkpoint whose `fileIdentity` or `headHash` (sha256 of the fixture file) no longer matches is
  reset to 0, like the real adapter.
- `discoverCandidates(roots)` reports fixture `cwd`s outside the registered roots.
- `normalizeHook` returns `[]` for any JSON object (the demo has no hooks) and throws `DemoHookError`
  otherwise. Invalid fixtures throw `DemoFixtureError`.

## Allowed dependencies

`@acp/core` and Node built-ins. These rules are enforced by `eslint.config.js`.
