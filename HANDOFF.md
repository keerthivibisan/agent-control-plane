# HANDOFF — Agent Control Plane: state, decisions, and how to continue

> **Start here.** Updated 2026-10-11 by the coordinator. This file is self-contained: an agent (or a
> person) outside the original session can continue from it. Read it fully, then `CLAUDE.md` and
> `AGENTS.md` (binding), then the specs a task cites. Older handoff text lives in git history
> (`git log -- HANDOFF.md`).

## 0. Quick orientation

> **Phase 4 (2026-10-13 onward): start at [`docs/phase-4/README.md`](docs/phase-4/README.md)** — the
> Agent Workspace plan (board, projects, tickets, harness), its work packages, prompts and the
> progress protocol. `docs/phase-4/STATUS.md` shows what is done. This HANDOFF covers Phases 1–3.

- **What it is.** A local-first control plane that observes Claude Code sessions (and later Codex),
  shows what agents are doing, which session spawned which helper agent, and how many tokens each
  used, all from local transcript files. Later phases add managed orchestration from the UI.
- **Where it stands.**
  - Phase 1 (observability) is functionally complete and verified, including on real data.
  - A UI redesign for non-technical users is in progress (§5).
  - Phase 3 (the "master control panel" that starts and manages Claude agents from the UI) is in
    progress (§7): decisions made, ADRs written, contracts on `main`.
- **Repo.** `/Users/grootan/Desktop/agent-control-plane` (pnpm monorepo). Branch `main` is always green.
  Nothing has been pushed to any remote yet.

## 1. State of work

| Work package                                                | State                                                                                   | Where                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| P0 bootstrap (tooling, CI config, specs, ADRs, contracts)   | done                                                                                    | `main`                                                |
| P1-A core logic (usage dedup/selection/attribution, status) | done                                                                                    | `main`                                                |
| P1-B SQLite persistence                                     | done                                                                                    | `main`                                                |
| P1-C demo adapter + Claude Code adapter + fixtures          | done; hooks verified on Claude Code 2.1.296; Notification unobserved                    | `main`                                                |
| P1-D server (pipeline, scheduler, REST, SSE, hooks, live)   | done                                                                                    | `main`                                                |
| P1-E web UI (original screens)                              | done; being replaced by the redesign (§5)                                               | `main`                                                |
| P1-F verification                                           | done except CI (nothing pushed)                                                         | `main`; evidence in `docs/research/p1-f-*.md`         |
| Follow-ups (ADR-0011 diagnostics, cost list, log redaction) | done                                                                                    | `main`                                                |
| UI redesign phase 1: foundation                             | done                                                                                    | `main` (`6ce2de0`)                                    |
| UI redesign phase 2: Tokens / Projects / Project            | done                                                                                    | `main` (`02d7e20`)                                    |
| UI redesign phase 2: Overview / Setup / Data health         | done                                                                                    | `main` (`015b181`)                                    |
| UI redesign phase 2: Sessions / Session detail / tree view  | done                                                                                    | `main` (`8d785dd`)                                    |
| UI redesign phase 3: cleanup                                | todo (§5.4)                                                                             | prompt §8.4                                           |
| Phase 2 (usage reliability, pricing) — roadmap              | not started                                                                             | `docs/roadmap.md`                                     |
| Phase 3 (master control panel / orchestration)              | **M1 done** (P3-0…F merged; real smoke run passed 2026-10-13); P3-G and follow-ups next | `main`; plan section in `docs/implementation-plan.md` |

The last full `pnpm check` on `main` passed with 826 tests (core 215, adapter-demo 12,
adapter-claude-code 199, db 83, web 189, server 128). The Playwright e2e passes 7/7.

**Check the in-progress branches first:**

```bash
git branch --list 'wp/ui-*'
git log --oneline main..wp/ui-overview
git log --oneline main..wp/ui-sessions
```

If a branch has commits and a clean `pnpm check`, review it and merge it (§6). If it is missing or
broken, rerun its prompt from §8 on a fresh branch from `main`.

## 2. Setup and toolchain (things that bit us)

- **Node 22.x (≥22.12, <23).** `.nvmrc` pins 22.21.1 and `engine-strict` rejects others:
  `source ~/.nvm/nvm.sh && nvm use`.
- **pnpm 10.26.x.** On this Mac, nvm's Node 22 resolves **pnpm 8.15.9**, while `/usr/local/bin/pnpm`
  is 10.26.1. Root scripts run `pnpm -r`, so put pnpm 10 first: create a directory that holds only a
  `pnpm` symlink to `/usr/local/bin/pnpm` and prepend it to `PATH`. Check both `pnpm --version` and
  `pnpm exec pnpm --version`.
- **Install and check:** `pnpm install --frozen-lockfile`, then `pnpm check` (format, lint,
  typecheck, test, build).
- **E2E:** `pnpm --filter @acp/web test:e2e`. It builds the web UI and runs Playwright against a demo
  server on port 7431 with a temp data dir. It is not part of `pnpm check`. Chromium was installed
  with `pnpm --filter @acp/web exec playwright install chromium`.
- **vitest conditions.** In packages that load Express, list only the `development` condition in
  `vitest.config.ts`. Adding `import` makes Node load `is-promise`'s ESM entry, and Express then fails
  with "isPromise is not a function".
- **Dot-directories.** Paths containing `.claude/` (agent worktrees live in `.claude/worktrees/`) once
  broke the SPA fallback. Fixed in `430223d`; keep `sendFile(..., { root })`.
- **Golden fixtures must not depend on the checkout path.** One hook golden hashed an absolute path,
  and only `70b4cc0` fixed that.
- **Ports.** The owner's live app uses **7420** (API) and **5173** (Vite). Agents doing manual
  checks or screenshots must use other ports (we used 7451, 7461, 7471, 7481, 7491) with
  `ACP_MODE=demo` and a temp `ACP_DATA_DIR`.
- **Run the app.**

  ```bash
  pnpm dev                          # live mode: reads <ACP_CLAUDE_DIR>/projects for registered projects only
  ACP_MODE=demo pnpm dev            # sample data in a separate demo.sqlite, rebuilt on every start
  pnpm --filter @acp/server hooks:snippet   # prints Claude Code hook settings for the user to paste
  ```

  Data lives in `~/.agent-control-plane` (`acp.sqlite`, `hook-token`). UI at
  http://127.0.0.1:5173, API at http://127.0.0.1:7420.

- **Hard rules (AGENTS.md):**
  - Never read the real `~/.claude` while developing; use `test-fixtures/` and temp dirs. The
    exceptions are explicit owner consent for one project, and aggregate output only.
  - Never read `~/.claude/sessions/`.
  - Never edit Claude Code settings.
  - Store no conversation content.
  - Missing usage is `null`, never 0.
  - Cost is always "estimated" and never summed.
  - There is no "completed" status.

## 3. Architecture recap (what exists)

```
packages/core            contracts (zod), pure logic; @acp/core/api = HTTP DTOs (web parses every response)
packages/db              SQLite (better-sqlite3), migrations, repositories, queries
packages/adapters/demo   deterministic fixtures (demo mode, tests)
packages/adapters/claude-code  allowlisted transcript/meta/hook reading → NormalizedEvent
packages/server          composition root: pipeline, scheduler, REST, SSE, hook receiver, static UI
packages/web             React 19 + Vite + Tailwind 4 + Recharts + React Flow; hash router
scripts/reference-usage.ts   independent usage recomputation (P1-F F1), aggregates only
```

Key behaviors, all tested:

- **Pipeline** (`packages/server/src/pipeline/ingest.ts`):
  - One transaction per batch: validate, skip duplicates (before touching the session row), upsert
    the session, store usage observations, rebuild usage records, store snapshots, derive edges, then
    the checkpoint. Notices are published only after commit.
  - Invalid events are counted and skipped.
- **Usage** (usage-accounting.md):
  - Dedup is global by `(provider, messageId)`; the observation with max output wins.
  - Usage is attributed to the earliest occurrence. Fork copies with tied timestamps are counted
    once and flagged `attributionAmbiguous`.
- **Edges:**
  - Subagent edges come from meta-file evidence (plus the spawn tool call). The evidence is stored in
    the child session's metadata, so edges derive in any event order.
  - Continuation edges come from strictly-earlier shared messages; ties give no edge.
  - There are no edges from timing or folder names.
- **Projects:**
  - A session belongs to the deepest registered root containing its first `cwd`.
  - **A subagent outside every root inherits its parent session's project** (fix `ae27c9e`, found by
    the real-data run).
- **Status** is derived at read time: Running (<2 min) / Paused (2–30 min) / Inactive (>30 min) /
  Ended (only with hooks) / Unknown.
- **Hooks** (`POST /api/hooks/claude-code`):
  - Token header, constant-time compare, 256 KiB limit, 204 response.
  - A local-only guard rejects foreign Host/Origin and CORS preflights.
  - Verified against Claude Code 2.1.296: an http `SessionStart` hook is **not** delivered, so the
    snippet omits it. Bodies carry a per-turn `prompt_id`.
- **Diagnostics (ADR-0011):**
  - Every adapter has `diagnostics()`: file issues, known-ignored record types, parse errors.
  - `GET /api/diagnostics/ingestion` adds poll and pipeline counters.
  - Eight known no-use record types are counted as ignored instead of "unrecognized".
- **Overview** includes `latestSnapshots`: per-session estimated cost, never summed.
- **Logs** are structured JSON, `redact()`ed, and errors log only class name and machine code.

## 4. Decisions log (project owner, 2026-10-10/11)

| Decision                                                                                             | Record                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| MIT license accepted                                                                                 | ADR-0010                                         |
| `diagnostics()` on the adapter interface (not a `Checkpoint` error field)                            | ADR-0011                                         |
| Command Center shows per-session latest estimated cost (`OverviewDto.latestSnapshots`), never summed | dto.ts, server README                            |
| Real-data run approved for `/Users/grootan/Desktop/ftl-rendering-harness` only                       | `docs/research/p1-f-real-data-2026-10-10.md`     |
| Real hook payload capture approved (throwaway dir, shape-only)                                       | `docs/research/p1-c6-hook-capture-2026-10-11.md` |
| UI redesign: "clean & calm" style; technical detail behind collapsed Details and a Data health page  | `packages/web/DESIGN.md`                         |
| No abbreviations ("direct in/out"); always "Input tokens", "Output tokens", etc.                     | DESIGN.md glossary                               |
| Easy "which session is under which" family-tree view as the default relationships view               | §5.2 (sessions screen)                           |
| Next big goal: a master control panel to start and manage Claude agents from the UI (Phase 3)        | §7                                               |

Verification highlights:

- **F2:** on real data, the app and the independent reference matched exactly: 39/39 sessions with
  usage, 3/3 models, 5,595 records.
- **F4:** a new live session appeared as Running via polling.
- **Q3 finding:** Claude Code's `cost-state` snapshots are ≥ the transcript totals (output and cache
  up to 1.3×, input up to 458×). They stay "estimated" and are never added to records.

## 5. UI redesign (current focus)

**Problem (owner).** The original UI read like a debug console: jargon ("derived", "provenance",
"aggregate", "direct in", "cache w"), raw ids and event payloads everywhere, and numbers without
units. Someone who doesn't know Claude Code must be able to understand and use it.

**Brief.** `packages/web/DESIGN.md` is binding. It holds the glossary, status words, activity-feed
sentences and formatting rules. All wording lives in `packages/web/src/lib/copy.ts`.

### 5.1 Done

- **Phase 1 foundation** (`3718a23`, `c1c5cd9`, `6ce2de0`):
  - Theme tokens, light and dark.
  - Icon sidebar: Overview, Sessions, Tokens, Projects (with the registered projects listed), then
    Setup and Data health at the bottom. Footer with a Live dot and the theme toggle.
  - Slim demo banner.
  - Shared components in `src/components/`: Card, StatCard, PageHeader, InfoTip, Tooltip,
    StatusBadge, TokenValue, TokenBreakdown, EstimatedCost, ShortId, RelativeTime, EmptyState,
    Details, DataTable, Button, icons.
  - `copy.ts` with a tested `describeEvent`.
  - New routes `#/projects`, `#/setup`, `#/health`.
- **Phase 2 Overview / Setup / Data health** (`80e0553`, `2304cc6`, `015b181`):
  - Overview: Running now, Need you, sessions by status in words, token stats per type, estimated
    cost by session, and recent activity as sentences.
  - Setup: step cards to add a project, add discovered folders with one click, and set up hooks
    optionally.
  - Data health: a friendly summary first, the detail behind it.
- **Phase 2 Tokens / Projects / Project** (`7100d90`, `02d7e20`):
  - Token-type explainer.
  - Date presets, project filter and group-by.
  - Four stat cards that are never summed.
  - Themed charts with gaps for missing data, plus a "Show as table" view.
  - Breakdown table with units.
  - Projects list, and a project page with its sessions.

### 5.2 Done since the first draft of this file (kept for reference)

- **Sessions / Session detail** (`2b5e3cb`, `8d785dd`, merged). Search finds ids only (server `q`
  searches ids); search by name needs a server change.
  - Friendly list with helper agents grouped under their parent.
  - The default relationships view is a family tree: top-level session at the top, helper agents
    nested below, "Continued as" as a dashed link. It is built only from `/tree` edges and shows
    "No known parent" explicitly. React Flow is an optional tab.
  - Timeline tab.
  - Detail page: tokens for this session and with helpers, side by side (never added together);
    estimated cost; helper agents; the family tree with the current session highlighted; an activity
    feed in sentences; technical details collapsed.

### 5.3 Proposed shared-component changes (from phase 2 agents; decide during cleanup)

- **Pager:** restyle `components/Pager` like `features/project/SessionsPager.tsx`, then delete the
  local copy.
- **DataTable:** optional horizontal-scroll wrapper for narrow widths.
- **StatCard:** optional token-type color swatch.
- **Dark-theme token colors:** they fail the lightness band (all too light, L 0.71–0.84). Darken
  them slightly.
- **Focus ring:** nav focus outline rendered gray instead of the accent color.
- **Hardcoded colors:** `UsageChart.tsx` and `graph.ts` still hardcode hex in places; use
  `TOKEN_TYPE_COLOR`.
- **TokenBreakdown:** labels truncate at 1024px ("Cache write to…"); let `dt` labels wrap.
- **Icons:** add an `AlertIcon` (warning triangle); a local copy is in `health/HealthCards.tsx`.
- **CopyableCode:** a shared command/URL box with a copy button; a local copy is in
  `setup/HooksSetup.tsx`.
- **Sessions agent:** move `features/sessions/use-api-queries.ts` into `lib/query.tsx`; add a
  `className` to `TokenBreakdown`'s grid; restyle `ErrorNotice` and `QueryView`'s loading text;
  delete `components/{EventList,ParentInfo,Pager,SessionTable,LegacyEstimatedCost}` when unused.
- **`sessionLabel()` in `lib/format.ts`:** returns lowercase "untitled session"; align it with the
  Overview's local `sessionName()` ("Untitled session").

### 5.4 Cleanup (UI phase 3, after 5.2 merges)

- Delete the superseded components once unused: `StatusPill` (`STATUS_LABELS`), `TokenCount`,
  `Time`, `EventList`, `SessionTable`, `UsageTotals`, Panel's `PageHeader`, `LegacyEstimatedCost`,
  and `TOKEN_CATEGORIES` in `lib/tokens.ts`.
- Apply §5.3.
- Update `packages/web/README.md` and the root README status.
- Screenshot every route in light, dark, 1440 and 1024, and check that no screen shows an
  abbreviation, a raw id outside Details, or a number without a unit.
- Keep e2e green.

### 5.5 Data note for the owner's live DB

Records ingested before the ignored-types change remain stored as "unrecognized" events, because
events are append-only. To see corrected diagnostics, re-ingest into a fresh data dir
(`ACP_DATA_DIR=<new dir> pnpm dev`, then register the project again). The old DB stays as a backup.

## 6. How to coordinate (the workflow that worked)

1. **One work package per agent.** Each agent works in its own git worktree on `wp/<id>-<slug>` from
   `main`, with explicit owned paths. Shared files (contracts, `copy.ts`, `e2e/demo.spec.ts`) are
   add-only or limited to the agent's own blocks.
2. **A shared contract change goes first.** It lands on `main` in its own commit, made by the
   coordinator, before parallel agents start (the ADR-0011 pattern).
3. **Review every branch before merging:**
   - Scope: `git diff --name-only main...<branch>` must stay inside the owned paths.
   - Rebase on `main` and run `pnpm check` and the e2e yourself; never trust a reported result.
   - Read the risky code: anything touching privacy, file access, the cost and null rules, or
     security.
   - For UI, look at the screenshots.
   - Then `git merge --ff-only`.
4. **Commit messages:** Conventional Commits with the package scope; a body giving what, why and
   tests; a `Checks:` line with the real results. Never commit failing checks, and never push
   without the owner's OK.
5. **Docs:** update the Status table in `docs/implementation-plan.md`, this file, and the README
   status in the same change as the behavior they describe.

## 7. Phase 3: the master control panel (in progress, milestone M1)

**Goal (owner).** Manage several Claude agents from one UI: chat with a lead agent ("spin up two
agents: one builds X, one tests it") while the family tree beside it grows live with each agent's
status, activity, tokens and estimated cost; approve, message, stop and review agents there.

**Owner decisions (2026-10-11), recorded as ADRs:**

| Decision                                                                                                                                   | ADR      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Claude Agent SDK as the engine (pinned 0.3.296, only in `@acp/adapter-claude-code`)                                                        | ADR-0012 |
| Agents ask in the panel before edits/commands; only `git` + SDK `claude` run; worktrees; max 3 workers, depth 1; review before merge; CSRF | ADR-0013 |
| Budget = output + uncached input + cache write per agent (cache reads tracked, not counted); soft cap                                      | ADR-0014 |
| The owner↔lead chat and worker task texts are stored locally (amends ADR-0009)                                                             | ADR-0015 |
| Agent changes always reviewed by the owner before merging                                                                                  | ADR-0013 |

**Where the detail lives.**

- The plan: `docs/implementation-plan.md`, "Phase 3" section (WPs, owned paths, tasks, acceptance)
  and Status rows P3-0 … P3-F.
- The design: `docs/orchestration-lifecycle.md` §0 (M1 states and integration).
- Contracts on `main`: `packages/core/src/orchestration/**` (domain, `budgetTokens`, limits,
  `LeadToolInputs`), `packages/core/src/adapters/managed.ts` (`ManagedExecutionAdapter`),
  `packages/core/src/api/orchestration.ts` (DTOs, requests, `CSRF_HEADER`), new stream notice kinds.
- Scaffold: `packages/orchestrator` (empty engine package, boundaries in `eslint.config.js`).

**State.**

- **M1 is done** (2026-10-13): P3-0, A, B, C, W, D, E and F are merged. The control panel is at
  `#/control`; managed agents are on by default in live mode (`ACP_MANAGED=off` turns them off).
- Verified with a fake-Claude browser e2e and a real smoke run in a throwaway repo
  (`docs/research/p3-f-smoke-2026-10-13.md`).
- **Follow-ups:**
  - an owner "Request review" action (in the smoke run the lead needed a nudge);
  - optionally load the project's CLAUDE.md into managed runs explicitly (lost with settings
    isolation);
  - the DTO proposals in the P3 reports (cost warning field, review errors, advertising managed
    mode);
  - P3-G validation runner;
  - CI.
- Prompts for the original WPs are in §8.5.

## 8. Ready-to-paste prompts

Prepend §8.0 to each prompt.

### 8.0 Common preamble

> You are working on the Agent Control Plane repo at `/Users/grootan/Desktop/agent-control-plane`.
> Read `HANDOFF.md` fully, then `CLAUDE.md` and `AGENTS.md`; they are binding. Work in a new git
> worktree on the branch named below, created from `main`. Follow the toolchain notes in HANDOFF §2,
> including the pnpm 10 PATH shim, and run `pnpm install --frozen-lockfile` first. Edit only the
> paths listed as yours; propose any other change in your report. Never read the real `~/.claude`.
> Never edit Claude settings. Don't change dependencies. For manual checks use `ACP_MODE=demo`, a
> temp `ACP_DATA_DIR`, and a port other than 7420/5173. Commit at each checkpoint with Conventional
> Commits (body: what, why, tests; a `Checks:` line with real results), only when `pnpm check` passes
> from the repo root. Do not push or merge. Finish with the AGENTS.md §9 completion report, including
> the e2e result and screenshot paths for UI work.

### 8.1 Coordinator: merge what is in flight

> Act as coordinator. Run `git branch --list 'wp/ui-*'`. If `wp/ui-sessions` has commits: check scope (packages/web only, and inside its feature
> folders apart from add-only `copy.ts` sections and its own e2e blocks); rebase on `main`; run
> `pnpm check` and `pnpm --filter @acp/web test:e2e`; screenshot its routes in demo mode on port 7451
> and review them against `packages/web/DESIGN.md`; then `git merge --ff-only`. If the branch is
> missing or unfinished, run prompt 8.3 instead. Afterwards run prompt 8.4.

### 8.2 UI phase 2: Overview, Setup, Data health (branch `wp/ui-overview`)

> Follow `packages/web/DESIGN.md` exactly and use `src/lib/copy.ts` and the shared components in
> `src/components/`.
>
> **Owned paths:** `packages/web/src/features/{command-center,setup,health}/**`, a new section in
> `copy.ts` (add-only), add-only fixtures in `tests/fixtures`, and only the overview test blocks in
> `e2e/demo.spec.ts`. Don't edit `src/components/**`, `src/lib/{tokens,format,router}.ts` or
> `src/app/**`.
>
> - **Overview** answers "what are my Claude Code agents doing?":
>   - Stat cards: Running now, Need you, sessions by status in words, the four token types as
>     separate stats with units (never one total), and Projects.
>   - "Running now" and "Waiting for you" lists.
>   - "Estimated cost by session" from `OverviewDto.latestSnapshots`, with the note that cost is
>     reported by Claude Code and not added up.
>   - Recent activity as sentences (`describeEvent`), with the raw table under Details.
>   - Empty states that point to Setup.
>   - Move the register form, candidate roots, capabilities and diagnostics off the Overview.
> - **Setup** is "Connect this app to your work", as step cards:
>   1. Add a project folder, with friendly validation.
>   2. Folders with Claude activity not added yet, with a one-click add.
>   3. Optional hooks: explain in plain words what they add, show the receiver URL and the steps
>      (`pnpm --filter @acp/server hooks:snippet`, set `ACP_HOOK_TOKEN`), and whether a hook was ever
>      received. The app never edits Claude settings.
> - **Data health:**
>   - A friendly summary first.
>   - Cards: file problems, known-skipped vs unknown records, parse errors, poll and ingest counters
>     with relative times, and capabilities and limitations in plain words.
>   - Raw detail under Details.
> - **Rules:** null shows "Not reported", never 0; cost is estimated and never summed; token types
>   are never summed; no "completed"; no abbreviations.
> - **Verify:** `pnpm check`; the e2e; screenshots of `#/`, `#/setup` and `#/health` in light and
>   dark at 1440 and 1024px, from a demo server on port 7471. Look at them and polish.

### 8.3 UI phase 2: Sessions and Session detail (branch `wp/ui-sessions`)

> Follow `packages/web/DESIGN.md` exactly and use `src/lib/copy.ts` and the shared components.
>
> **Owned paths:** `packages/web/src/features/{sessions,session-detail}/**`, a new `copy.ts` section
> (add-only), add-only fixtures, and only the Session Explorer, session detail and "unavailable"
> e2e blocks.
>
> - **Sessions list:**
>   - Friendly filters: project, status in words, model, and search ("Find a session by name or
>     id").
>   - Rows: title or "Untitled session" with a ShortId, project, StatusBadge, helper-agent count,
>     input and output tokens with units (cache in a secondary line or tooltip), and last activity.
>   - Helper agents grouped under their parent.
> - **"How sessions relate" card:**
>   - The default tab is a **family tree** a non-technical person reads instantly: the top-level
>     session at the top, helper agents nested beneath with connecting lines. Each node shows its
>     title (or "Helper agent: {type}"), StatusBadge, and "N input · N output tokens".
>   - "Continued as" appears as a dashed labeled link. Nodes are clickable.
>   - Built only from `/tree` edges, with "No known parent" explicit.
>   - Tabs: "Relationships" (the tree; React Flow as an optional alternative, restyled with theme
>     colors) and "Timeline" (concurrency).
> - **Session detail:**
>   - Header: title, status, project, started and last activity, models, ShortId.
>   - "Tokens (this session)" and "Tokens (with helpers)" side by side, explaining that the second
>     includes the first (never add them), plus the shared-messages note.
>   - Estimated cost card with a per-model table in tokens, or "Claude Code didn't report a cost for
>     this session".
>   - Helper agents, and Continued from / as.
>   - The session's family tree with the current session highlighted.
>   - Activity feed in sentences with "Load older"; raw events, full ids and metadata under
>     Technical details.
> - **Rules:** as in 8.2, plus graph edges only from evidence.
> - **Verify:** `pnpm check`; the e2e; screenshots of `#/sessions` (both tabs) and a session with
>   helpers, light and dark, at 1440 and 1024px, from a demo server on port 7481.

### 8.4 UI phase 3: cleanup and polish (branch `wp/ui-cleanup`, after 8.2 and 8.3 merge)

> **Owned:** `packages/web/**` and the root README status.
>
> - Apply the HANDOFF §5.3 proposals and §5.4 cleanup: delete superseded components, unify Pager,
>   add the DataTable scroll, darken the dark-theme token colors into the lightness band, fix the
>   accent focus ring, remove hardcoded hex colors.
> - Audit every route for abbreviations, raw ids outside Details, numbers without units, and "0"
>   where data is missing.
> - Update `packages/web/README.md` and the root README.
> - Verify: `pnpm check`, the e2e, and a screenshot pass of every route (light, dark, 1440, 1024).

### 8.5 Phase 3 work packages (one agent each; prepend §8.0)

All Phase 3 prompts share this text. Replace `<WP>`, `<branch>` and `<extra>`:

> Implement **<WP>** from the "Phase 3" section of `docs/implementation-plan.md` on branch
> `<branch>`, created from `main`.
>
> - **Read first:** that section's row for <WP> (owned paths, tasks, acceptance),
>   `docs/orchestration-lifecycle.md` §0, ADR-0012..0015, and the contracts in
>   `packages/core/src/orchestration/**`, `packages/core/src/adapters/managed.ts` and
>   `packages/core/src/api/orchestration.ts`.
> - **Don't change contracts or shared files.** If you need a change, propose the diff in your
>   report and stop that part.
> - **Guardrails (ADR-0013) are tested, not assumed:**
>   - never use a shell;
>   - never call the real Claude Agent SDK in tests (inject a fake `query`);
>   - never store worker conversation content.
> - **Mark the Status row:** set your row to in-progress with your branch, and to done when finished.
>
> <extra>

| WP   | Branch                | `<extra>`                                                                                                                                                                                                 |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-A | `wp/p3-a-engine`      | Pure code only; no I/O. Remove `--passWithNoTests` from `packages/orchestrator/package.json` once tests exist (scripts field only).                                                                       |
| P3-B | `wp/p3-b-managed`     | The SDK API is verified in `packages/adapters/claude-code/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`query`, `canUseTool`, `createSdkMcpServer`, `tool`, `interrupt`). Read it; don't guess. |
| P3-C | `wp/p3-c-persistence` | New migration file only; never edit `0001`. Export the new repositories from `packages/db/src/index.ts`.                                                                                                  |
| P3-W | `wp/p3-w-workspaces`  | Test against temp git repos created in the test (`git init`); never touch this repository's own git state.                                                                                                |
| P3-E | `wp/p3-e-control-ui`  | Follow `packages/web/DESIGN.md`; build against the DTOs with fixture data (the server routes come in P3-D); screenshots from a demo server on port 7495.                                                  |
| P3-D | `wp/p3-d-server`      | Start only after A, B, C and W are merged. Use a fake managed adapter in tests. Keep `ACP_MODE=demo` working.                                                                                             |
| P3-F | `wp/p3-f-verify`      | After D and E. The real smoke run needs the owner's consent in chat, in a throwaway git repo; print aggregates only.                                                                                      |

**Coordinator after each WP:** review (scope, rebase, your own `pnpm check` + e2e, guardrail code,
screenshots for UI), merge `--ff-only`, update this file and the Status table.

## 9. Backlog (smaller items, any time)

- **CI:** push to a GitHub remote, with owner approval, to run `.github/workflows/ci.yml`. This is
  the last Phase 1 checklist item.
- **Notification hook shape:** still unverified. It needs a short interactive capture under the same
  approved conditions as `docs/research/p1-c6-hook-capture-2026-10-11.md`.
- **Overview query:** `snapshots.latestForTopLevelSessions(limit)` in `@acp/db`, to replace one query
  per session. The overview still scans every session; fine locally, but move status counts to SQL
  if this grows.
- **Invalid events:** they are counted but their checkpoint advances, so they are lost. Consider
  persisting per-file errors (ADR-0011 consequence).
- **Demo database:** it is rebuilt before `listen` succeeds, so a second instance destroys the first
  instance's demo DB. Check the port first.
- **Still-unrecognized record types** (`frame-link`, `system:compact_boundary`, `relocated`,
  `agent-name`, `mode`, `atis-latch`): research what they mean. `relocated` and `frame-link` may
  carry relationships.
- **Q8 fork-origin tie-breaker** and **Q7 OTel** belong to Phase 2.
- **Git authorship:** commits are authored as "Keerthi Vibisan", from this machine's git config.
  Rewrite before publishing if that is wrong.
