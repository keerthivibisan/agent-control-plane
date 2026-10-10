# HANDOFF — continue Agent Control Plane on another machine / account

> Written by the coordinator agent on 2026-10-10 when the original session ended. **Start here.**
> Then read `CLAUDE.md` and `AGENTS.md`, which are binding, and `docs/implementation-plan.md`.

## 1. Where things stand

| WP         | What                                                                                                        | State                                                                                                   | Branch                           |
| ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| P0         | Bootstrap: tooling, CI, docs, ADRs, core contracts v1                                                       | **done, on `main`**                                                                                     | `main`                           |
| P1-D0      | API DTO contract (`@acp/core/api`)                                                                          | **done, on `main`**                                                                                     | `main`                           |
| P1-A (+A9) | Core logic: usage selection/attribution, aggregation, status, edges, paths, redaction. A9 handles fork ties | **done, on `main`** (212 tests)                                                                         | merged                           |
| P1-B       | SQLite persistence (B1–B6)                                                                                  | **done, on `main`** (81 db tests)                                                                       | merged                           |
| P1-C       | Demo adapter + Claude Code adapter + fixtures                                                               | **partial.** C0–C3 are on `main`; the demo adapter is complete. C4 WIP is on an unmerged branch. See §4 | WIP `wp/p1-c4-wip`               |
| P1-E       | Web UI                                                                                                      | **partial.** E0–E2 (shell, Command Center, Session Explorer) are on `main`. See §4                      | merged; continue on a new branch |
| P1-D       | Server: pipeline, REST, SSE, hooks, `pnpm dev`                                                              | **not started. Unblocked:** B and C0 are on `main`. **Do this next**                                    | —                                |
| P1-F       | Integration and verification                                                                                | not started                                                                                             | —                                |

`pnpm check` passes on `main`: core 212, db 81, adapter-claude-code 51, adapter-demo 12, web 55, for **411 tests** in total. Each unmerged branch was committed only at passing checkpoints. Unfinished work was converted from stashes into clearly labeled `wip` branches, so it travels with
the repo.

## 2. Restore on a new machine

You received the repo either as a GitHub remote or as a bundle file
(`agent-control-plane.bundle`, which contains every branch):

```bash
git clone agent-control-plane.bundle agent-control-plane
```

```bash
cd agent-control-plane && git branch -a
```

Only one branch matters besides `main`: the WIP branch for P1-C. Create it locally:

```bash
git branch wp/p1-c4-wip origin/wp/p1-c4-wip
```

The bundle contains only `main` and `wp/p1-c4-wip`. Every other work branch was merged into `main`.

## 3. Toolchain (read this, it bit us)

- **Node 22.x, at least 22.12 and below 23.** `.nvmrc` pins 22.21.1, and `engine-strict` rejects other
  versions. Node 18 and 20 fail.
- **pnpm 10.26.x.** Run `corepack enable` under Node 22. **Gotcha:** some nvm Node installs ship pnpm 8.
  Root scripts call `pnpm -r …`, which picks up whatever `pnpm` is first on `PATH`. Check
  `pnpm --version` _inside_ a script run as well (`pnpm exec pnpm --version`). If you see 8.x, put
  pnpm 10 first on `PATH`.
- **C/C++ toolchain** (Xcode CLT or build-essential). `better-sqlite3@13.0.3` may compile from source;
  on the original Mac it did.
- **jsdom is pinned to 29.1.1** because 30 needs Node 22.22 or later. **TypeScript is pinned to 6.0.3**
  because typescript-eslint does not support TS 7 yet (ADR-0001).

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm check
```

Claude Code creates agent worktrees under `.claude/worktrees/`. Git, ESLint, and Prettier ignore
them. Never commit them.

## 4. Unmerged branches — status at handoff

The coordinator fills this in from the agents' final reports. If a section is missing, run
`git log --oneline main..<branch>` and read the commit bodies. Every commit says which task it
implements and what was tested.

### `wp/p1-b-persistence` (P1-B)

**Done and merged** (B1–B6, last commit `ddf30aa`). The full public API is in
`packages/db/README.md`. Points the server agent needs:

- **Connection:** `openDatabase(path, { migrate })` opens the database, and `withTransaction(db, fn)`
  wraps work in a transaction. It is synchronous, uses BEGIN IMMEDIATE, and turns nested calls into
  savepoints.
- **Repositories:** `createRepositories(db)` returns `projects`, `sessions`, `edges`, `events`,
  `usage`, `snapshots`, and `checkpoints`. `checkpoints` implements core's `CheckpointStore`.
  `createQueries(db)` returns `listSessions` (keyset), `sessionTree`, `directUsage`/`aggregateUsage`
  (null-preserving), `ambiguousAttributionCount`, `usageSummary`, `projectStats`,
  `childCountBySession`, and `diagnosticsCounts`.
- **Pipeline recipe for D2**, run inside `withTransaction`:
  1. `events.insertIfNew`; continue only if the event was inserted;
  2. `sessions.upsert`;
  3. `edges.upsert`;
  4. `usage.insertObservation`;
  5. `buildUsageRecord(usage.listObservationsByMessage(…))`, then `upsertRecord`, or `deleteRecord`
     if it returns null;
  6. `snapshots.insert`;
  7. `checkpoints.set`.
- **Null keys:** `usageSummary` returns null keys, and the server must label them, because
  `UsageSummaryDto` requires a non-empty key.
- **Contract proposals:** add `SessionMetadataSchema` and `SessionOriginSchema` to core.

### `wp/p1-c-adapters` (P1-C)

**Committed (checks passed):**

| Commit    | Task    | Contents                                                                                                                                                                                                                                                                                                                          |
| --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6a1ee12` | C0      | **Demo adapter is complete.** `createDemoAdapter({ baseTime?, now?, fixturesDir? }): ObservationAdapter`. Fixtures: 2 projects, a session with 2 subagents, a fork, missing usage, a snapshot, titles, an end. Checkpoints count records; `sourcePath` is `demo://…`                                                              |
| `7b416f4` | C1 + C2 | `scripts/sanitize-fixture.ts`; file allowlist (`classifyRelative`, `listSources`: realpath containment, symlink-escape rejection, size caps); `peekFirstCwd` (64 KiB); `toCandidates`; `resolveAllowedTranscriptSync` (for hook paths); a local `isPathInside` (duplicates core; swap it for `@acp/core`); `DiagnosticsCollector` |
| `4ff7f61` | C3      | `readIncrement`: `dev:ino`, size, and `headHash` change → reset; 1 MiB chunks up to the last `\n`; parse errors counted and skipped; `FileTooLargeError`. Tests for scenarios 6, 7, and 10. 95/95 tests at this point                                                                                                             |

**WIP branch `wp/p1-c4-wip`** (`cfbbec8`, on top of `4ff7f61`) is **untested; checks were not run.**
It holds the stashed C4 work:

- `src/redact.ts` (duplicates core; switch to the core `redact`);
- `src/dedup.ts`, `src/records.ts`, `src/ingestor.ts`;
- `tests/helpers/scenarios.ts`;
- synthetic fixtures `test-fixtures/claude-code/01…16` (no `expected/` goldens yet).

Start from this branch, not from scratch.

**Remaining work, in order:**

1. **C4 golden and unit tests.** Run the ingestor per scenario with roots `/home/user/project` and a
   fixed `now`, generate `expected/events.json` with `UPDATE_GOLDEN=1`, and **review each golden by
   hand**. Assert:
   - every event passes `NormalizedEventSchema`;
   - no event JSON contains `<redacted>`, and scenario 08 does not contain `acc00000`, `0rg00000`,
     `never-read`, or `SECRET`;
   - scenario 15 gives `parseErrors: 3`;
   - in scenario 06 the checkpoint excludes the partial line;
   - scenario 14 never shows session `…0002`;
   - scenario 07 copies v1, polls, overwrites with v2, polls again, and resets;
   - a second poll emits nothing new;
   - a restart with small `chunkBytes` produces the same keys.

   Also unit-test `redact`, `dedup`, and `records`.

2. **C5 meta.** Read the whole file (at most 1 MiB) and emit `subagent.spawned`:
   - key `cc:meta:{sid}:{aid}:h:{sha256}#spawned`, envelope on the child key `(sid, agentId)`;
   - channel `subagent-meta`, `occurredAt` null, description redacted and capped at 200;
   - invalid JSON raises an `invalid-meta` diagnostic.

   Remove the temporary `continue` in `ingestor.ts`. Write goldens for 03, 04, and 05.

3. **C6 `normalizeHook`.**
   - Requires `session_id` and `hook_event_name`; unknown events return `[]`.
   - Key: `cc:hook:{sid}:{event}:{tool_use_id|sha256(canonical body)}`.
   - `occurredAt` is null; `observedAt` is `receivedAt`.
   - `source.path` is the allowlisted transcript only; SubagentStop uses `agent_transcript_path`.

   Also `hookSettingsSnippet({ port, tokenEnvVar })`, which returns a JSON string only. Test with
   scenario 13.

4. **C7 `capabilities()`.** Set `providerVersionsSeen` and honest `limitations`: internal format;
   hooks are opt-in and real payloads are not captured; snapshot scope unknown; cost is an estimate;
   auxiliary usage invisible; depth above 1 unverified; retention; size cap.
5. **Assemble.**
   - Write `src/adapter.ts` and `src/index.ts`: `createClaudeCodeAdapter({ claudeDir, now?,
maxFileBytes?, chunkBytes? })` returns an `ObservationAdapter` plus `diagnostics()`.
   - Update the package README and `test-fixtures/claude-code/README.md` (scenarios 15 and 16 were
     added).

**Unverified assumptions to record in `docs/provider-adapters.md`:**

- `providerSessionId` comes from the file path, not the line.
- Lines without a uuid and unrecognized lines use a line-hash key.
- Key suffixes: `#session #cwd #user #assistant #tool: #result: #usage #snapshot #title #error
#unrecognized #spawned`.
- These field names are guesses: `cost-state` models (`inputTokens`, `outputTokens`,
  `cacheReadInputTokens`, `cacheCreationInputTokens`), titles (`customTitle`/`aiTitle`), the
  api_error shape, and the hook fields `notification_type`, `old_cwd`/`new_cwd`, `agent_id`.
- Other system subtypes become `system:<subtype>`.
- Nested subagent files are stored flat under the top-level session's `subagents/`.
- A candidate's `lastSeenAt` is the file mtime.

**Contract proposals (need a coordinator decision):**

1. Add either an optional `lastError` to `Checkpoint`, or `diagnostics()` to `ObservationAdapter`.
   This affects P1-B and P1-D.
2. Widen the `SourceRef.path` doc comment to cover hook events, which carry the allowlisted
   transcript path.

### `wp/p1-e-web` (P1-E)

**Committed (checks passed; 254/254 tests at `267228f`). There is no stash.**

| Commit    | Task          | Contents                                                                                                                                                                                                                                      |
| --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `15f2736` | E0            | Vite/React/Tailwind scaffold; typed API client that parses every response with the DTOs; query store; `useEventStream` (SSE invalidation); hash router; theme; app shell with the DEMO banner; a clear "server not reachable" state           |
| `62f7203` | E1            | Command Center: status counts, active and needs-attention lists, recent events, totals, register-project form, candidate roots, capabilities and diagnostics panels                                                                           |
| `267228f` | E2 + E3 Gantt | Session Explorer: filters, session-id search, list, a React Flow graph built only from `SessionTreeDto.edges` (subagent vs continuation edges styled differently, expand/collapse, explicit parent unknown), and a concurrency Gantt timeline |

**Remaining work.** The agent's detailed design is in that branch's last commit body. In short:

1. **E3 session detail, `#/sessions/:id`.** Create `features/session-detail/SessionDetail.tsx` using
   the existing components: `StatusPill`, `ParentInfo`, `UsageComparison` (already shows the
   ambiguity note), `EstimatedCost`, `EventList`, `Pager` with `useCursorStack`. It covers metadata
   with provenance, the snapshot by-model table, "no provider snapshot observed", and a "show in
   graph" link. Add `case 'session'` to `App.tsx`.
2. **E4 usage, `#/usage`.**
   - Build two Recharts charts from `groupBy=day`, one for input and output and one for cache
     creation and cache read. `null` must show as a gap, never 0, and the charts are not stacked.
   - Add a group table and totals labeled "Groups and totals sum DIRECT usage".
   - Test the pure `toChartRows`, and stub `ResizeObserver` if anything renders Recharts.
3. **E5 project page, `#/projects/:id`.** Show metadata, usage totals from
   `usageSummary({groupBy:'session', projectId})`, and a paginated `SessionTable`.

**Endpoints the UI calls (P1-D must match them exactly):**

- `GET /api/health`, `/api/capabilities`, `/api/projects`, `/api/overview`,
  `/api/discovery/candidates`, `/api/diagnostics/ingestion`
- `POST /api/projects {name, rootPath}`. A 400 must return an `ErrorDto`.
- `GET /api/sessions?model&projectId&provider&q&status&cursor&limit=50` (empty parameters are
  omitted)
- `GET /api/sessions/:id/tree`
- `GET /api/usage/summary?groupBy=model`
- `GET /api/events/stream`
- For E3–E5: `/api/sessions/:id`, `/api/sessions/:id/events?cursor`,
  `/api/usage/summary?groupBy&from&to&projectId`, `/api/projects/:id`,
  `/api/projects/:id/sessions?cursor`

The Vite dev server runs on `127.0.0.1:5173` and proxies `/api` to `127.0.0.1:7420`.
`pnpm --filter @acp/web dev` works without a server and shows the unreachable state.

**Assumptions the server must honor:**

- `/tree` is rooted at the topmost ancestor.
- "Unreachable" means a fetch failure, or a 502, 503, or 504 response whose body is not an
  `ErrorDto`.
- The DEMO banner keys off `capabilities.mode`.

**Contract proposal (needs a coordinator decision).** `OverviewDto` has no cost field, but task E1
asks for the latest cost, labeled estimated. Either:

- add `latestSnapshots: {sessionId, occurredAt, reportedCostUsd}[]` (the most recent N, never
  summed), or
- drop that item from E1.

## 5. What to do next, in order

These three can run **in parallel**, one agent each:

1. **P1-D (server):** prompt §6.3. It is unblocked now and on the critical path. Wire the demo adapter
   first; the Claude adapter's `createClaudeCodeAdapter` arrives when P1-C is finished.
2. **Finish P1-C:** prompt §6.2, starting from `wp/p1-c4-wip`.
3. **Finish P1-E:** prompt §6.4, on a new branch from `main`.

**Coordinator role.** One person or agent acts as coordinator. For each branch they:

- rebase it on `main`;
- run `pnpm check`;
- merge it with `git merge --ff-only`;
- update the Status table in `docs/implementation-plan.md`.

The coordinator also owns the shared files (AGENTS.md §5) and decides on contract proposals. 4. **Integrate.**

- Run `ACP_MODE=demo pnpm dev`, open http://localhost:5173, and check the Command Center, Session
  Explorer, and usage views against the demo data.
- Then do the P1-F real-data run, with the user's consent: register a project that has Claude Code
  sessions.

5. **Run P1-F**, the verification checklist in `docs/implementation-plan.md`.

Branches can run in parallel. Use one agent per WP, each in its own worktree or clone, on branch
`wp/<id>-<slug>`.

## 6. Ready-to-paste prompts

Paste one prompt into a fresh Claude Code (or other agent) session at the repo root. Each one
assumes the agent can read the repo.

### 6.0 Common preamble (prepend to each prompt below)

> You are working on the Agent Control Plane repo. Read `HANDOFF.md`, `CLAUDE.md`, and `AGENTS.md`
> first; they are binding. Then read your work package (WP) in `docs/implementation-plan.md` and the
> specs it cites. Follow the toolchain notes in HANDOFF.md §3, and verify Node 22 and pnpm 10 before
> anything else. Edit only the paths your WP owns (AGENTS.md §5). Never read the real `~/.claude`
> directory. Use `test-fixtures/` and temp directories instead. Never modify Claude Code settings.
> Don't change dependencies or shared contracts. If you need a change, propose the diff in your
> report. Commit at every checkpoint with the detailed message format in CLAUDE.md, and only when
> `pnpm check` passes. End with the AGENTS.md §9 completion report. Do not push or merge unless I ask.

### 6.1 P1-B — done

No prompt is needed. P1-B is merged; its API is in §4 and `packages/db/README.md`.

### 6.2 Finish P1-C (adapters)

> Continue **P1-C** from branch `wp/p1-c4-wip`. It is `wp/p1-c-adapters` plus one untested WIP commit
> holding the C4 code and fixtures.
>
> 1. Check out `wp/p1-c4-wip`. It is already rebased onto `main` as of the handoff; rebase again if
>    `main` has moved.
> 2. Read HANDOFF.md §4 (P1-C) and `git log main..HEAD`. C0 (demo adapter), C1, C2, and C3 were
>    committed with passing checks. The WIP commit has not been checked; make it pass and fold it into
>    proper C4 commits, or rewrite it.
> 3. Finish the remaining tasks:
>    - **C4** record normalizers: follow the provider-adapters.md §4.4 allowlist and the
>      usage-accounting.md §3 dedup keys. Store **no** content fields. Write golden contract tests
>      over synthetic fixtures for the 14 scenarios in `test-fixtures/claude-code/README.md`.
>    - **C5** subagent meta → `subagent.spawned`.
>    - **C6** `normalizeHook` and `hookSettingsSnippet`. Use synthetic hook fixtures only. Real
>      payload capture needs my explicit approval in chat, so skip it and list it as a gap.
>    - **C7** `capabilities()` with honest limitations.
> 4. If a fixture has duplicate message ids across sessions with identical timestamps (forks), note
>    that core flags these as ambiguous (usage-accounting.md §5.2).
> 5. `createClaudeCodeAdapter({ claudeDir, now?, maxFileBytes?, chunkBytes? })` returns an
>    `ObservationAdapter` (`packages/core/src/adapters/contract.ts`). Every emitted event must pass
>    `NormalizedEventSchema`.

### 6.3 P1-D (server) — start once P1-B and P1-C0 are on `main`

> Implement **P1-D** on a new branch, `wp/p1-d-server`.
>
> **Read first:** `docs/architecture.md`, `docs/usage-accounting.md`, `docs/provider-adapters.md` §6
> (hooks), `docs/security.md`, `docs/development.md` §5 (env config), the P1-D section of the plan,
> `packages/core/src/api/dto.ts` (the response contract; the web UI parses every response with it),
> and the public APIs of `@acp/core`, `@acp/db`, `@acp/adapter-demo`, and
> `@acp/adapter-claude-code`.
>
> **Owned paths:** `packages/server/**` and the root `package.json` `dev` script (task D7). Dependencies
> are already pinned: express 5.3, zod, tsx, supertest, vitest.
>
> **Tasks:**
>
> - **D1:** `loadConfig()` with `ACP_PORT`=7420, `ACP_DATA_DIR`=~/.agent-control-plane,
>   `ACP_CLAUDE_DIR`, `ACP_MODE`=live|demo (demo uses `demo.sqlite` and the demo adapter only),
>   `ACP_POLL_INTERVAL_MS`, `ACP_ACTIVE_WINDOW_MS`, `ACP_STALE_AFTER_MS`. Also `createApp(deps)`, which
>   tests can use without listening.
> - **D2:** pipeline `ingestBatch(batch)`. In one transaction:
>   1. validate each event with `NormalizedEventSchema`;
>   2. `insertIfNew`;
>   3. for inserted events only, update projections:
>      - upsert sessions by `SessionKey`, mapping project with `findOwningRoot`;
>      - store usage observations, then recompute affected records with
>        `groupObservationsByMessage` + `buildUsageRecord`, persisting `attributionAmbiguous`;
>      - recompute edges with `deriveSubagentEdge` / `deriveContinuationEdges`;
>      - store snapshots;
>      - set `last_attention_at` from `session.attention`, and `ended_at` from `session.ended`;
>   4. advance the checkpoint;
>   5. after commit, publish a `StreamNoticeDto`.
>      Tests: re-ingesting twice gives identical totals; a crash mid-batch leaves no partial state; demo
>      adapter end-to-end.
> - **D3:** scheduler. A poll loop that is single-flight per file, plus hook-triggered immediate
>   reads.
> - **D4:** every REST route in the plan (including `GET /api/overview`), each response parsed by its
>   DTO schema in tests. Session status is derived at read time with `deriveSessionStatus`.
>   `X-Request-Id`, error middleware returning `ErrorDto`, keyset pagination.
> - **D5:** SSE `/api/events/stream`: `Last-Event-ID`, a 15 s heartbeat, publish only after commit.
> - **D6:** `POST /api/hooks/claude-code`:
>   - token file `<ACP_DATA_DIR>/hook-token` with mode 0600;
>   - header `X-ACP-Hook-Token`, compared in constant time;
>   - 256 KiB limit; reply 204 with no body;
>   - reject CORS from foreign origins.
>     Never write Claude settings. Expose the snippet only.
> - **D7:** serve `packages/web/dist` statically. Add a root `pnpm dev` that runs the server (with
>   `node --conditions=development --import tsx`) and the Vite dev server in parallel. Bind
>   **127.0.0.1** only.
>
> **Logging:** structured, redacted with `redact()`, never payloads.
>
> **Done:** `ACP_MODE=demo pnpm dev` serves the demo data, and the web UI at http://localhost:5173
> shows it.

### 6.4 Finish P1-E (web)

> Continue **P1-E** on a new branch, `wp/p1-e-web-2`, created from `main`. E0–E2 are already merged.
>
> 1. Run `pnpm check` (it should pass).
> 2. Read HANDOFF.md §4 (P1-E) and `git log --oneline -- packages/web`. E0 (scaffold, typed client, SSE) and E1
>    (Command Center) were committed.
> 3. Finish the remaining tasks:
>    - **E2** Session Explorer: filters, list, a React Flow graph built only from
>      `SessionTreeDto.edges`, an explicit "parent: unknown", and a concurrency timeline;
>    - **E3** session detail: provenance badges, direct vs aggregate usage side by side, the
>      `ambiguousAttributionCount` note, snapshot cost labeled "estimated (provider-reported)", and a
>      paginated event timeline;
>    - **E4** usage analytics in Recharts, with cache categories separate;
>    - **E5** project page.
> 4. Rules: `null` renders as "unavailable", never 0. Status never shows "completed". Fixture DTOs go
>    in `tests/` only. Use the hash router; there is no router dependency. When the API is
>    unreachable, show a clear message.

### 6.5 P1-F (verification) — last

> Run **P1-F** from the plan:
>
> - **F1:** a reference recomputation script, aggregate-only, that never prints content;
> - **F2:** a real-data run on a project I choose;
> - **F3:** re-ingest and restart checks;
> - **F4:** live new-session check;
> - **F5:** a Playwright e2e test in demo mode;
> - **F6:** the docs and acceptance checklist.
>
> Ask me before reading any real Claude data, and only ever print aggregates.

## 7. Key findings and decisions (details in docs/)

- **Usage dedup is global by `(provider, messageId)`.** About 52% of transcript lines repeat a message
  with a growing `output_tokens`, so the rule is "max output wins". Forks copy history into new
  session files (ADR-0006, usage-accounting §5).
- **Fork copies keep their original timestamps.** Verified locally: 1,715 of 1,715. Attribution of
  copied messages is therefore _ambiguous_: still counted once, but flagged. No continuation edge is
  created on a tie. Open question Q8 (roadmap) tracks a better tie-breaker.
- **Subagent edges come only from evidence.** Locally, 197 of 197 meta files linked to their spawning
  `Agent` tool call.
- **Transcripts are the usage source of record.** Hooks are optional, live, and carry no usage
  (ADR-0005). OTel is deferred.
- **No conversation content is stored** (ADR-0009). The app never modifies Claude settings. It binds
  to localhost only.

## 8. Needs a human decision

1. **Git author identity.** Commits so far were authored as "Keerthi Vibisan
   <keerthivibisan2211@gmail.com>", taken from the original machine's git config. Rewrite the history
   before publishing if that is wrong.
2. **License.** MIT is provisional (ADR-0010).
3. **Real hook payload capture (P1-C6).** It needs approval and a throwaway directory.
4. **Budget metric for Phase 3 (Q1).** Raw token budgets break on cache reads.
5. **Open questions Q2–Q8** in `docs/roadmap.md`.
