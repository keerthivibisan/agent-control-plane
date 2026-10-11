# Implementation plan — Phase 1: Session observability

This is the **authoritative task list**. Agents pick work from here, own only the files listed for their
work package (WP), and update the status table when they start and finish.
Specs: [architecture](architecture.md) · [domain model](domain-model.md) ·
[usage accounting](usage-accounting.md) · [provider adapters](provider-adapters.md) ·
[security](security.md) · [development](development.md).

## Status

<!-- Agents: update your row when you start (in-progress + branch) and when you finish (done + PR/commit). -->

| WP   | Title                                             | Owner role        | Depends on                                                      | Status                                                                                         | Branch                                              |
| ---- | ------------------------------------------------- | ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| P0   | Bootstrap: repo, tooling, core contracts v1, docs | coordinator       | —                                                               | **done**                                                                                       | `main`                                              |
| P1-A | Core domain logic                                 | core agent        | P0                                                              | **done**                                                                                       | `wp/p1-a-core-logic`, `wp/p1-a9-fork-ties` (merged) |
| P1-B | Persistence (SQLite)                              | persistence agent | P0                                                              | **done**                                                                                       | `wp/p1-b-persistence` (merged)                      |
| P1-C | Claude Code adapter + demo adapter + fixtures     | adapter agent     | P0                                                              | **done** (C0–C7; hooks verified on 2.1.296, Notification unobserved; ADR-0011 ignored records) | `wp/p1-c-adapters-2`, `wp/p1-c-followups`           |
| P1-D | Server: pipeline, API, SSE, hooks                 | backend agent     | P1-A, P1-B, P1-C (C0 first)                                     | **done** (D0–D7); live mode needs P1-C                                                         | `wp/p1-d-server`                                    |
| P1-E | Web UI                                            | frontend agent    | P1-D0 (API contract); P1-D running in demo mode for integration | done: E0–E5 (verified against the demo server)                                                 | `wp/p1-e-web-2` (E3–E5; E0–E2 on main)              |
| P1-F | Integration and verification                      | coordinator       | P1-D, P1-E                                                      | **done** except CI (not pushed)                                                                | `wp/p1-f-verify` + coordinator commits              |
| P3-0 | Phase 3 contracts, ADRs, SDK pin, scaffold        | coordinator       | owner approval of the Phase 3 plan                              | **done**                                                                                       | `wp/p3-0-contracts`                                 |
| P3-A | Orchestration engine (`@acp/orchestrator`)        | engine agent      | P3-0                                                            | todo                                                                                           |                                                     |
| P3-B | Managed adapter over the Agent SDK                | adapter agent     | P3-0                                                            | todo                                                                                           |                                                     |
| P3-C | Orchestration persistence (migration 0002)        | persistence agent | P3-0                                                            | todo                                                                                           |                                                     |
| P3-W | Workspace manager (git worktrees)                 | workspace agent   | P3-0                                                            | **done** (awaiting coordinator review)                                                         | `wp/p3-w-workspaces`                                |
| P3-D | Server composition for the control panel          | backend agent     | P3-A, B, C, W                                                   | todo                                                                                           |                                                     |
| P3-E | Control panel UI                                  | frontend agent    | P3-0 (DTOs); D for integration                                  | todo                                                                                           |                                                     |
| P3-F | Phase 3 M1 verification                           | coordinator       | P3-D, P3-E                                                      | todo                                                                                           |                                                     |

```mermaid
flowchart TD
  P0[P0 Bootstrap ✔] --> A[P1-A Core logic]
  P0 --> B[P1-B Persistence]
  P0 --> C0[P1-C0 Demo adapter + fixtures]
  C0 --> C[P1-C Claude adapter]
  A --> D2[P1-D2 Pipeline]
  B --> D2
  C0 --> D2
  P0 --> D0[P1-D0 API DTO contract]
  D0 --> E[P1-E Web UI]
  D2 --> D4[P1-D3..D7 API · SSE · hooks · scheduler]
  C --> D4
  D4 --> F[P1-F Integration & verification]
  E --> F
```

**Parallel start:** after P0, these can run at the same time, each in its own git worktree:

- P1-A
- P1-B
- P1-C (C0 first)
- P1-D0 (a small contract task)

P1-E starts once P1-D0 is merged. P1-D2 onward needs A, B, and C0.

## Integration checkpoints

| CP  | When                | What is verified                                                                                      |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| CP1 | P0 done ✔           | `@acp/core` v1 contracts (events, usage, sessions, provenance, adapter contract) build and are tested |
| CP2 | P1-D0 merged        | `@acp/core/api` DTO schemas exist; the web and the server compile against them                        |
| CP3 | P1-D2 merged        | demo adapter, then pipeline, then SQLite, end to end in a test; re-ingestion is idempotent            |
| CP4 | P1-C merged + P1-D4 | the real Claude adapter ingests sanitized fixtures through the server                                 |
| CP5 | P1-F                | real local data and full acceptance checklist                                                         |

---

## P1-A — Core domain logic (complexity: M)

**Owns:**

- `packages/core/src/usage/**` (new files)
- `packages/core/src/sessions/**` (new files)
- `packages/core/src/paths/**`
- `packages/core/src/redaction/**`
- `packages/core/src/index.ts` (append exports only)
- `packages/core/tests/**` (except `contracts.test.ts`)

**Must not edit:** the existing v1 contract files listed in AGENTS.md §5, or `src/api/**` (owned by
P1-D0).

| Task | Deliverable                                                                                                                                                                    | Tests                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | `selectUsage(observations)` gives the record per the usage-accounting §5 selection rule (max output; categories from one observation; `conflict` flag; `<synthetic>` excluded) | duplicate-line growth; equal outputs; null outputs; conflicting cache counts; synthetic model                                         |
| A2   | `attributeUsage(observations)` gives the session key (earliest `occurredAt`, null last, lexical tie-break)                                                                     | fork copy attributed to the original; null timestamps; tie                                                                            |
| A3   | `sumTokenCounts(records)` and `aggregateUsage(tree)`: null-preserving per-category sums, with `recordsWithUnavailable`                                                         | all-null stays null; mixed; aggregate = direct + subagent children only; continuation children excluded                               |
| A4   | `deriveSessionStatus(evidence, now, thresholds)`                                                                                                                               | active / idle / stale boundaries; `ended`; activity after end becomes active again; no evidence gives unknown                         |
| A5   | `deriveSubagentEdge(meta, toolCallsBySession)` and `deriveContinuationEdges(observations)`                                                                                     | meta plus a matched tool use; meta only; no meta gives no edge; depth 2 matched to a subagent; depth 2 unmatched gives unknown parent |
| A6   | `isPathInside(root, candidate)` and `findOwningRoot(roots, cwd)` (pure; the caller has already called realpath)                                                                | `/repo` vs `/repo-evil`; trailing slashes; nested roots, longest wins; Windows-style paths rejected on POSIX                          |
| A7   | `redact(text)` per security.md §2.4                                                                                                                                            | positive and negative case for each pattern                                                                                           |
| A8   | Order-independence property test                                                                                                                                               | shuffled observations give identical selection, attribution, and aggregates (seeded)                                                  |

**Done when:**

- every function is exported from `src/index.ts`, pure, and documented;
- `pnpm --filter @acp/core test typecheck build` passes;
- coverage of A1–A5 includes every scenario above.

**Starter prompt:** "Implement work package P1-A from docs/implementation-plan.md. Follow AGENTS.md."

## P1-B — Persistence (complexity: M)

**Owns:** `packages/db/**`. Add `tsconfig*.json`, `src/`, `tests/`, and scripts to the existing
`package.json`, but not dependencies.

| Task | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Tests                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| B1   | `openDatabase(path)`: WAL, `foreign_keys=ON`, `busy_timeout=5000`, file mode 0600, directory mode 0700                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | pragmas applied; file permissions                                  |
| B2   | Migration runner: `src/migrations/NNNN_name.sql`, applied in order in one transaction each, recorded in `schema_migrations(version, name, applied_at, checksum)`; refuses an edited, already-applied migration                                                                                                                                                                                                                                                                                                                                                          | fresh apply; re-run is a no-op; checksum mismatch throws           |
| B3   | `0001_observability.sql`: tables `projects`, `sessions`, `session_edges`, `events`, `usage_observations`, `usage_records`, `usage_snapshots`, `ingestion_checkpoints`, `edge_conflicts`, with FKs, indexes (`events(session_id, occurred_at)`, `events(observed_at)`, `sessions(project_id, last_event_at)`, `usage_records(session_id)`, `usage_records(model)`), and uniques (`events.dedup_key`, `sessions(provider, provider_session_id, provider_agent_id)`, `usage_records(provider, message_id)`, `session_edges(kind, child_session_id)`, `projects.root_path`) | schema snapshot test; uniqueness violations                        |
| B4   | Repositories: `projects`, `sessions` (upsert by key; min/max timestamp merging), `edges` (upsert, evidence union, conflict record), `events` (`insertIfNew` returns `{ inserted, id }`), `usage` (insert observation; read observations by message; upsert record), `snapshots`, `checkpoints`                                                                                                                                                                                                                                                                          | each repository's contract; JSON columns round-trip through Zod    |
| B5   | `withTransaction(db, fn)`; a thrown error rolls back events **and** the checkpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | crash simulation: throw midway leaves no partial state             |
| B6   | Queries: session list (filters: project, provider, status inputs, model, id search; keyset pagination on `(last_event_at, id)`); session tree (recursive CTE over subagent edges); direct and aggregate usage per category, where `SUM` stays NULL when all NULL and `COUNT(*) - COUNT(col)` counts unavailable; usage grouped by project, session, model, or day                                                                                                                                                                                                       | fixtures giving known totals; null semantics; pagination stability |

Phase 3 tables are **not** created (domain-model §3).

**Done when:** `pnpm --filter @acp/db test typecheck build` passes using temp-file databases.

## P1-C — Claude Code adapter, demo adapter, fixtures (complexity: L)

**Owns:**

- `packages/adapters/claude-code/**`
- `packages/adapters/demo/**`
- `test-fixtures/**`

| Task           | Deliverable                                                                                                                                                                                                                              | Tests                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C0** (first) | Demo adapter implementing `ObservationAdapter` over committed fixtures (`provider: "demo"`, channel `demo`, deterministic clock); minimal fixture set: 2 projects, a session with 2 subagents, a fork, a session with missing usage      | determinism (two runs give identical events); every event passes `NormalizedEventSchema`                                                             |
| C1             | `scripts/sanitize-fixture.ts`: reads a transcript, keeps structure and keys, replaces ids with deterministic fakes, text with `"<redacted>"`, and paths with `/home/user/project`; output is reviewed by a human                         | sanitizer unit tests; no input text survives                                                                                                         |
| C2             | Allowlist and discovery (provider-adapters §3, §4.1); `discoverCandidates`                                                                                                                                                               | denied paths: `sessions/`, `.key`, `settings.json`, `memory/`, orphaned or superseded files, symlink escapes, oversize files                         |
| C3             | Incremental reader with checkpoints: partial lines, truncation, replacement, parse errors, chunking                                                                                                                                      | each scenario 6, 7, and 10 in usage-accounting §7                                                                                                    |
| C4             | Record normalizers per the record-type allowlist (§4.4); dedup keys per usage-accounting §3; content minimization                                                                                                                        | contract tests over sanitized fixtures, with golden expected events; scenario 1 (growth); scenario 11 (unknown types); no text fields in any payload |
| C5             | Subagent meta reading and edge evidence (§5)                                                                                                                                                                                             | meta only; meta plus a matched tool use; missing meta; synthetic depth-2 fixture (marked synthetic)                                                  |
| C6             | `normalizeHook` (§6) plus `printHookSettingsSnippet()`. **Capture real payloads** from 2.1.263 in a throwaway directory using a _project-local_ `.claude/settings.local.json`, with explicit user approval; sanitize; commit as fixtures | each subscribed hook type; invalid bodies rejected; `transcript_path` outside the allowlist ignored                                                  |
| C7             | `capabilities()` with honest `limitations`                                                                                                                                                                                               | —                                                                                                                                                    |

**Done when:**

- both adapters pass `typecheck`, `test`, and `build`;
- fixtures follow `test-fixtures/claude-code/README.md`;
- every unverified assumption is listed in `docs/provider-adapters.md`.

## P1-D — Server (complexity: L)

**Owns:**

- `packages/server/**`
- `packages/core/src/api/**` (D0 only; coordinator review)
- the root `package.json` `dev` script (D7; coordinator review)

| Task                                            | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Tests                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **D0** (first, small) — **done by coordinator** | `packages/core/src/api/**`, exported as the pre-declared subpath `@acp/core/api` (entry `src/api/index.ts`; do not touch `src/index.ts`): Zod DTO schemas and types for every Phase 1 response (`ProjectDto`, `SessionSummaryDto`, `SessionDetailDto` with `directUsage`/`aggregateUsage`/`parent: {state: "known", …} \| {state: "unknown"}`, `SessionTreeDto`, `EventDto`, `UsageSummaryDto`, `CapabilitiesDto`, `CandidateRootDto`, `ErrorDto`, `PageDto<T>`) | schema tests                                                                                 |
| D1                                              | `loadConfig()` (development.md §5) and `createApp(deps)`, which is testable without listening                                                                                                                                                                                                                                                                                                                                                                    | config validation                                                                            |
| D2                                              | Pipeline `ingestBatch(batch)`: validate, then insert if new, then project (sessions, edges, usage observations, then recompute the record for affected message ids via `selectUsage`/`attributeUsage`, snapshots), then checkpoint, all in one transaction; then publish                                                                                                                                                                                         | scenarios 2, 5, 8; re-ingest twice gives identical totals; crash mid-batch                   |
| D3                                              | Ingestion scheduler: poll loop and hook-triggered reads; single-flight per file                                                                                                                                                                                                                                                                                                                                                                                  | no concurrent reads of the same file                                                         |
| D4                                              | REST routes (below) with Zod validation, `X-Request-Id`, the error middleware, and keyset pagination                                                                                                                                                                                                                                                                                                                                                             | supertest per route; 400/404 shapes                                                          |
| D5                                              | SSE `/api/events/stream`: invalidation messages after commit; `Last-Event-ID`; 15 s heartbeat; cleanup on disconnect                                                                                                                                                                                                                                                                                                                                             | receives a notice after ingest; never before commit                                          |
| D6                                              | Hook receiver: token file creation (0600), constant-time compare, size limit, 204 response, CORS rejection                                                                                                                                                                                                                                                                                                                                                       | missing or wrong token gives 401; oversize gives 413; a browser-origin preflight is rejected |
| D7                                              | Static serving of the web build; root `pnpm dev` (server and web in parallel)                                                                                                                                                                                                                                                                                                                                                                                    | smoke test                                                                                   |

Routes:

- `GET /api/health`
- `GET /api/overview` (Command Center aggregate; `OverviewDto`)
- `GET /api/capabilities`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `GET /api/projects/:id/sessions`
- `GET /api/discovery/candidates`
- `GET /api/sessions?projectId&provider&status&model&q&cursor&limit`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/tree`
- `GET /api/sessions/:id/events?cursor`
- `GET /api/sessions/:id/usage`
- `GET /api/usage/summary?groupBy=project|session|model|day&from&to&projectId`
- `GET /api/events?cursor`
- `GET /api/events/stream`
- `POST /api/hooks/claude-code`
- `GET /api/diagnostics/ingestion`

Run routes (`/api/runs/*`) and approvals are **Phase 3**.

## P1-E — Web UI (complexity: L)

**Owns:** `packages/web/**`.

| Task | Deliverable                                                                                                                                                                                                                                                               | Tests                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| E0   | Vite, React, and Tailwind scaffold; typed API client that parses every response with the D0 schemas; `useEventStream` (SSE invalidation, then refetch); app shell with dark/light themes; persistent **DEMO DATA** banner when `capabilities.provider === "demo"`         | client parse failure is shown, not swallowed          |
| E1   | Command Center: projects; session counts by status; recent events; total observed usage by category; latest provider-reported cost labeled _estimated_; "needs attention" from Notification hooks; empty states that explain how to register a project or configure hooks | renders from fixture DTOs; no hardcoded numbers       |
| E2   | Session Explorer: React Flow graph built from `/tree` (expand/collapse; nodes show agent type, model, status, tokens, last seen); unknown parent shown explicitly; filters for project, provider, status, and model; session-id search; list view                         | graph built only from edges; unknown-parent rendering |
| E3   | Session detail panel: metadata with provenance badges, direct vs aggregate usage side by side, event timeline; plus a cross-session **timeline (Gantt) view** of concurrency                                                                                              | `null` renders "unavailable", never 0                 |
| E4   | Usage analytics (Recharts): tokens over time per category; by project, session, or model; cache categories separate; snapshot cost labeled estimated                                                                                                                      | estimated values are never styled as authoritative    |
| E5   | Project workspace page: metadata, root path, sessions, usage totals                                                                                                                                                                                                       | —                                                     |

Components are data-driven and small, under `features/<screen>/`. Shared UI lives in `components/`.

## P1-F — Integration and verification (complexity: M)

| Task | Deliverable                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | `scripts/reference-usage.py` (or `.ts`): an independent recomputation of per-session totals directly from JSONL using the usage-accounting §5 rules. Totals must equal the API's                        |
| F2   | Real-data run on this machine: register a project, ingest, and compare with F1; compare with `cost-state` snapshots and record the findings (Q3)                                                        |
| F3   | Re-ingest (delete checkpoints, re-run): totals unchanged. Restart mid-ingest: no duplicates                                                                                                             |
| F4   | Live check: start a new Claude Code session in a registered project, then see it appear (polling, and hooks if configured); stop it, then it becomes `stale` (or `ended` with hooks), never "completed" |
| F5   | Playwright e2e in demo mode covering the brief's first end-to-end workflow                                                                                                                              |
| F6   | Update README status, docs "implemented" markers, and the acceptance checklist below                                                                                                                    |

### Phase 1 acceptance checklist (all must be checked by P1-F with evidence)

Checked items were verified on 2026-10-10 on `wp/p1-f-verify` against synthetic fixtures, the demo
server, and tests only. **No real Claude data has been read yet:** items that need it stay unchecked
until F2 and F4 run with the user's consent. Details: [P1-F verification note](research/p1-f-verification-2026-10-10.md).
Evidence keys: **F1** `packages/server/tests/verification/reference-usage.test.ts`, **F3**
`…/verification/recovery.test.ts`, **ACC** `…/verification/acceptance.test.ts`, **E2E**
`packages/web/e2e/demo.spec.ts`.

**Session discovery**

- [x] A real session is discovered. F2 (2026-10-10): one real project, 10 sessions and 33
      subagents ingested; totals equal the independent reference (`docs/research/p1-f-real-data-2026-10-10.md`).
- [x] Project association uses verified path containment. F1 generated root: a session whose
      `cwd` is outside `/home/user/project` is not ingested, its subagent with an in-root `cwd` is,
      in both the pipeline and the reference.
- [x] Sessions started outside the control plane are observed. F2: all 43 real sessions were
      started directly in Claude Code. F4: a new session started in that project appeared while
      running (`active`, usage counted) with polling only.
- [x] An unknown parent stays unknown. E2E: the demo root shows "parent: unknown" in the graph and
      on its detail page; ACC: scenario 04 (no meta) gives no edge.

**Relationships**

- [x] Meta creates an edge. ACC: scenario 03 gives one `subagent` edge with `subagent-metadata`
      evidence.
- [x] Missing meta creates no guessed edge. ACC: scenario 04 has the subagent session and no edge.
- [x] Edges are stable across re-ingestion. F3: edges (kind, endpoints, provenance, evidence)
      are identical after a checkpoint wipe and after restarts, for every scenario.

**Usage**

- [x] Duplicate message ids don't inflate usage. F1: scenarios 01 (streaming growth), 02 (fork)
      and the generated root equal the independent reference; a first-wins mutation of the
      reference fails 3 tests.
- [x] Snapshots are never summed. F1 scenario 09: usage totals equal the reference, which never
      reads `cost-state`; E2E: the snapshot is shown separately, labeled estimated.
- [x] Missing usage stays unavailable. F1 scenario 12 and the generated root (missing, negative and
      non-integer counts stay null with `recordsWithUnavailable`); E2E renders "unavailable".
- [x] Hook and transcript channels don't double-count. ACC: ingesting every scenario-13 hook
      payload after the transcript adds events but no usage observation or record.

**Recovery**

- [x] Re-ingestion leaves totals unchanged. F3: delete all checkpoints and re-run, for every
      scenario.
- [x] A restart creates no duplicates. F3: stop after the first batch (200-byte chunks), reopen
      the DB, continue; and one restart per batch; no duplicate dedup keys, same state as one run.
- [x] Partial lines are safe. F1 scenario 06 and the generated root's unterminated last line;
      F3 restarts with chunks smaller than a line.
- [x] Stale is never shown as completed. E2E asserts no "completed" status (the enum has none);
      F4 (2026-10-10): the live session showed `active` and the user confirmed the behavior; idle and
      stale are derived at read time from the last event (core status tests), and F2's 43 finished
      real sessions all show `stale`.

**Frontend**

- [x] The UI shows real persisted data. E2E matches the API on every screen (demo); F4: the user
      viewed the real project's sessions in the UI, and the API reported 44 sessions, 1 active.
- [x] The hierarchy is inspectable. E2E: graph nodes and edges equal `/tree`, subagent and
      continuation edges labeled.
- [x] Timeline and usage views work. E2E: concurrency timeline, both usage charts, chart table,
      group table.
- [x] Direct and aggregate usage are distinguishable. E2E: separate "Direct usage" and
      "Aggregate usage" regions equal to the API, aggregate > direct for the root.
- [x] Provenance and unavailable values are visible. E2E: "estimated (provider-reported)" cost,
      "unavailable" categories, "no snapshot" note.
- [x] Demo data is separated. E2E: DEMO banner and "demo mode" on every screen; the demo server
      runs on its own `demo.sqlite` in a temp data dir.

**Security**

- [x] Credential files are excluded (a test proves it). ACC: with scenario 14 (sessions/,
      `.key`, settings, history, memory, set-aside files) only the one allowlisted transcript is
      read (event source paths and checkpoints).
- [x] Access is limited to registered roots. F1 generated root (out-of-root session excluded).
- [x] Logs are redacted. Audit of every server logger call (2026-10-10, `wp/p1-followups-api`):
      lines are `redact()`ed JSON; errors log only class name and machine code (`errorFields`), and
      `failed to start` no longer logs arbitrary error messages; hook rejections now log request id
      and reason code. `packages/server/tests/logging.test.ts` captures real logger output for hook
      rejections and acceptance, rolled-back batches, invalid events, failed polls and unhandled
      request errors, and asserts that no body, path or secret appears.
- [x] User config is never modified. ACC: sha256 and mtime of every file in the data root,
      `settings.json` included, are unchanged after two full ingests.

**Quality**

- [x] `pnpm check` passes (on `wp/p1-f-verify`).
- [ ] CI is green. _Not verifiable here: the branch is not pushed._

## Phase 3 — Managed orchestration, milestone M1 (the control panel)

Decided by the owner on 2026-10-11; design in [orchestration-lifecycle.md](orchestration-lifecycle.md)
§0, ADR-0012 (Agent SDK), ADR-0013 (guardrails), ADR-0014 (budget), ADR-0015 (chat storage).
Contracts are on `main`: `packages/core/src/orchestration/**`, `packages/core/src/adapters/managed.ts`,
`packages/core/src/api/orchestration.ts`. **Contracts and shared files stay coordinator-owned**: a WP
that needs a change proposes it.

**M1 experience.** `#/control`: chat with the lead agent on the left; the run's live family tree and
agent cards (status, latest activity sentence, budget bar, estimated cost, Message, Stop) on the
right; an approvals tray (Approve / Deny); a review panel per worker (diff, changed files, Merge /
Discard); Stop all.

**Order.** P3-0 (done) → P3-A, P3-B, P3-C, P3-W, P3-E in parallel → P3-D → P3-F.

| WP                       | Owns                                                                                                                                    | Tasks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Acceptance (each with tests)                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P3-A** engine          | `packages/orchestrator/**`                                                                                                              | Pure functions over plain data: run and agent state machines (§0 states, transition table, illegal transitions rejected); policy checks for `start_agent` (registered project, at most `MAX_CONCURRENT_CHILD_AGENTS` live workers, depth `MAX_DELEGATION_DEPTH`, run not cancelling); lead tool-call validation with `LeadToolInputs`; budget accounting (dedup by messageId, `budgetTokens()`, soft cap → BLOCKED + `budget-raise` approval, overshoot reported); approval lifecycle incl. timeout → deny; cancellation ordering (stop scheduling, abort children, then lead); restart rule (live → NEEDS_REVIEW, never relaunch); run → REVIEW when all workers stopped, → COMPLETED when every review is merged/discarded. Remove `--passWithNoTests`.                                                                                                                                         | Transition tables fully tested; a 4th worker, depth 2, an unregistered project, a cancelled run and an over-budget agent are refused with typed reasons; property test: replaying the same usage messages in any order gives the same budget. |
| **P3-B** managed adapter | `packages/adapters/claude-code/src/managed/**` (+ export from `src/index.ts`)                                                           | `createManagedClaudeCode({ query?, now? })` implementing `ManagedExecutionAdapter` with the SDK (`query` injectable): streaming input queue for `send`; `abortController` for `abort`; `interrupt()`; `permissionMode: 'default'`, `settingSources: ['project']`; `canUseTool` → read-only allowlist (Read, Glob, Grep, LS-like, the lead's `mcp__acp__*` tools) allowed, else `callbacks.requestPermission` with a redacted ≤200-char summary (tool + target path or command name only); lead tools via `createSdkMcpServer`/`tool` built from `LeadToolInputs`, handlers call `spec.leadTools`; map SDK messages to `ManagedAgentEvent` (`started` from the init message's session id, `activity` content-free, `usage` per assistant message id, `lead-text` for lead text only, `finished` with reported cost as estimate). If the SDK needs an install script blocked by pnpm 10, report it. | Fake-`query` tests for every mapping; workers never receive lead tools; no worker text is emitted; deny path returns a deny result; abort ends the iterator; nothing calls the real SDK in tests.                                             |
| **P3-C** persistence     | `packages/db/src/migrations/0002_*.sql`, `packages/db/src/repositories/orchestration/**`, exports in `packages/db/src/index.ts`         | Tables: `orchestration_runs`, `agent_runs`, `agent_run_sessions`, `approvals`, `artifacts` (patch, manifest; file path + sha256, files live under the data dir), `managed_workspaces`, `orchestrator_messages`; STRICT, FKs, indexes; repositories with zod validation at the boundary; never edit 0001.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Temp-file DB tests for every repository; migration checksums; cascade on run delete removes its messages (ADR-0015).                                                                                                                          |
| **P3-W** workspaces      | `packages/server/src/workspace/**`                                                                                                      | `createWorkspaceManager({ dataDir, git? })`: `create(projectRoot, runId, agentId)` → worktree + branch `acp/<run>/<agent>` from the project's current HEAD; `changes(ws)` → changed files (status, additions/deletions) + unified diff with a size cap; `merge(ws)` only when the project's working tree is clean and the base branch is unchanged-or-fast-forwardable, else a typed refusal; `discard(ws)` removes worktree + branch; `cleanupOrphans()` on start. Only `execFile('git', args)`.                                                                                                                                                                                                                                                                                                                                                                                                 | Tests against temp git repos: create/diff/merge/discard, dirty-base refusal, path-traversal-safe ids, no shell use (assert `execFile` args).                                                                                                  |
| **P3-D** server          | `packages/server/**` except `src/workspace/**`                                                                                          | Run service wiring engine + adapter + db + workspaces; routes: `GET /api/control/token`, `GET/POST /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/chat`, `POST /api/approvals/:id`, `POST /api/runs/:id/agents/:agentId/stop`, `POST /api/runs/:id/stop`, `GET /api/runs/:id/review`, `POST /api/runs/:id/review`; CSRF on mutations; approval bridge (`requestPermission` → approval row → SSE `approval-requested` → decision resolves the promise); lead tool handlers → engine → adapter; active worktrees added as extra `RegisteredRoot`s for the scheduler and session linking via the `started` event; SSE `runs-changed` / `chat-message`; restart handling. Config: `ACP_MANAGED=on                                                                                                                                                                                               | off` (default on in live mode, off in demo unless a fake adapter is injected for e2e).                                                                                                                                                        | supertest per route with a fake managed adapter and temp git repos; DTO parsing; guardrail refusals surface as ErrorDto; logs contain no chat text. |
| **P3-E** UI              | `packages/web/src/features/control/**`, add-only `copy.ts` section, nav entry in `src/app/Shell.tsx` (coordinator-approved for this WP) | `#/control` page per the M1 experience, DESIGN.md wording (plain words, units, "estimated", no "completed"); reuse `FamilyTree` from `features/sessions`; budget bar in budget tokens with the ADR-0014 explanation; approvals tray; review panel with a readable diff; Stop / Stop all with confirmation; empty state "Start a run". Builds against the DTOs with fixture data until P3-D lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Component tests with fixture DTOs; screenshots light/dark 1440/1024; no raw ids outside Details.                                                                                                                                              |
| **P3-F** verification    | `packages/server/tests/verification/control/**`, `packages/web/e2e/control.spec.ts`                                                     | Deterministic e2e with a fake managed adapter: chat "spin up two agents" → two workers appear in the tree → approve one edit, deny one → stop one → review diff → merge one, discard one → run COMPLETED; budget soft cap → BLOCKED; restart → NEEDS_REVIEW; Stop all. Then, with owner consent, one real smoke run in a throwaway git repo (aggregates only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | All pass; the DB holds no worker conversation content (asserted); every ADR-0013 guardrail has a passing refusal test.                                                                                                                        |
| P3-G (after M1)          | —                                                                                                                                       | Validation runner (per-project command allowlist, timeouts) shown in the review panel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                             |

## Risks

| Risk                                                                      | Mitigation                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Transcript format changes between versions (it is documented as internal) | tolerant per-field parsing; unknown-type diagnostics per version; fixtures per version; OTel as a Phase 2 fallback |
| Snapshot scope unknown, so totals don't match the provider's figures      | label snapshots as estimated; document the cross-check finding (Q3)                                                |
| Hook errors visible to users when the server is down                      | hooks are opt-in; the snippet uses `timeout: 2`; the docs explain this                                             |
| Large transcript directories (hundreds of MB)                             | chunked reads; checkpoints; size cap; discovery peeks at 64 KiB maximum                                            |
| Agents working in parallel drift from the contracts                       | ownership table; contract files locked to the coordinator; CP2/CP3 checkpoints                                     |
