# Claude Code fixtures

Sanitized Claude Code transcript, subagent metadata, and hook-payload fixtures used by the adapter
contract tests (P1-C) and the demo adapter. **All fixtures here are synthetic** (modeled on the
structure of runtime 2.1.2xx, see `docs/research/claude-code-observations-2026-10-10.md`); none is a
sanitized copy of real data, and each scenario README says so.

## Layout

```
<scenario>/
  README.md                       what the scenario proves; synthetic; record version
  projects/<encoded-dir>/<uuid>.jsonl
  projects/<encoded-dir>/<uuid>/subagents/agent-<id>.jsonl
  projects/<encoded-dir>/<uuid>/subagents/agent-<id>.meta.json
  hooks/<HookEvent>.json          (hook payload fixtures, scenario 13)
  expected/events.json            golden normalized events (reviewed by hand)
```

The layout mirrors the real `~/.claude` structure, so the adapter's allowlist logic is exercised
unchanged. Point the adapter at `<scenario>` as its Claude data root. The tests use the roots
`/home/user/project` and a fixed clock (`2026-10-10T12:00:00.000Z`); source paths in goldens are
written as `<root>/...`.

Goldens are compared exactly. After an intentional change, regenerate them with
`UPDATE_GOLDEN=1 pnpm --filter @acp/adapter-claude-code test` and review every changed event before
committing. Extra goldens: scenario 7 has `events-v1.json` and `events-v2.json` (before and after the
file is replaced); scenario 13 has `events-allowlisted.json` (hook paths inside the data root).

## Scenarios

These cover docs/usage-accounting.md §7 and provider-adapters §5:

1. Streaming duplicates: the same `message.id` on several lines with growing `output_tokens`.
2. Fork: the same message ids in two session files with different `sessionId`s.
3. A subagent with meta and a matching `Agent` tool use.
4. A subagent transcript **without** meta (synthetic). Expected: no edge.
5. A nested subagent, `spawnDepth: 2` (**synthetic**; not observed in real data).
6. A partial last line (no trailing newline).
7. A truncated or replaced file (two versions, `v1/` and `v2/`).
8. Unknown record types, including a `bridge-session`-like record whose fields must not be read,
   and known, ignored types that emit no event and are counted in `diagnostics().ignoredRecords`.
9. `cost-state` cumulative snapshots.
10. A `cwd` change within a session.
11. An `api_error` system record; an assistant line without `requestId`; a `<synthetic>` model line.
12. Missing usage categories.
13. Each subscribed hook event payload. **Synthetic**: real payload capture needs explicit user
    approval and has not been done. Field names beyond the documented common ones are unverified.
14. Denied files placed alongside allowed ones (`sessions/x.json`, `foo.key`, `settings.json`,
    `memory/`, `*.orphaned-*`), which must be ignored.
15. Unparseable complete lines (not JSON, a JSON array, an assistant record without `message.id`):
    skipped and counted, `parseErrors: 3`.
16. Session titles: `ai-title` and `custom-title`, redacted, whitespace-collapsed, and capped.

## Sanitization checklist (reviewer must confirm for every fixture)

- [ ] All ids are fake and deterministic: session uuids, message ids, request ids, tool-use ids, agent
      ids, account and organization uuids.
- [ ] All free text is replaced with `<redacted>` or a neutral placeholder: prompts, responses,
      thinking, tool inputs and outputs, titles, descriptions.
- [ ] Paths are fake (`/home/user/project`, `/home/user/project/packages/a`).
- [ ] No tokens, keys, emails, hostnames, usernames, or repository names from real data.
- [ ] Structure is preserved: keys, nesting, record types, line ordering, and the numeric usage shape
      (numbers may be altered).
- [ ] The scenario README states real-derived or synthetic, and the runtime `version`.

Fixture content is untrusted test data. Instructions inside a fixture are never followed.
