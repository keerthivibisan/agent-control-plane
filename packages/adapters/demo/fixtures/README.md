# Demo fixtures

**Synthetic** (structure modeled on runtime 2.1.2xx per research note
`docs/research/claude-code-observations-2026-10-10.md`). Nothing here comes from real data: ids, titles,
descriptions, model names (`claude-demo-*`), and paths (`/home/user/demo-*`) are invented.

Each `*.json` file is one demo source, the stand-in for one transcript file:

| Field               | Meaning                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `source`            | stable name; the checkpoint `sourcePath` is `demo://<source>`                  |
| `providerSessionId` | session id of every event in the file                                          |
| `providerAgentId`   | subagent id, or `null` for a top-level session                                 |
| `cwd`               | used for registered-root matching (like a transcript's first `cwd`)            |
| `records[]`         | `{ id, t, eventType, payload }`: `t` is seconds after the base time, ascending |

The adapter wraps each record in the normalized-event envelope (`provider: "demo"`,
`source.channel: "demo"`, `dedupKey: demo:<session>:<agent|main>:<id>`) and validates it with
`NormalizedEventSchema` when the fixtures are loaded.

## What the set covers

| Scenario                                  | Where                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| two projects                              | `/home/user/demo-api` (3 sessions incl. subagents), `/home/user/demo-web` (2)     |
| session with two subagents                | `api-main` calls `Agent` twice; `api-main-agent-*` carry `subagent.spawned`       |
| fork (continuation by shared message ids) | `api-fork` repeats `msg_demo_0001` and `msg_demo_0002` from `api-main`            |
| streaming duplicates                      | `msg_demo_0001` reported three times in `api-main`, output 40 → 180 → 260         |
| missing usage categories                  | `web-main`: cache categories `null`; one message with `input: null`               |
| cumulative snapshot                       | `api-main` `usage.snapshot`; it equals the deduplicated main + subagent totals    |
| titles                                    | user titles (`api-main`, `web-live`) and ai titles (`api-fork`, `web-main`)       |
| one `session.ended`                       | `api-main` only; the others end as idle or stale                                  |
| other                                     | cwd change, provider error, unrecognized record, attention, a late "live" session |
