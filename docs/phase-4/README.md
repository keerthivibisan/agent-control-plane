# Phase 4 — Agent Workspace: board, projects, tickets, harness

> **Start here for any Phase 4 work.** This file is self-contained: an agent in any session can pick
> up a work package (WP) from it. Read it fully, then `AGENTS.md` and `CLAUDE.md` (binding), then
> the progress protocol (§9) and your WP's progress file in `docs/phase-4/wp/`. Status of every WP:
> [`docs/phase-4/STATUS.md`](STATUS.md).

## 0. Where we are

- **Phase 1 (observing Claude Code sessions): done**, verified on real data.
- **Phase 3 M1 (the control panel): done**, verified with a fake-Claude e2e and a real smoke run
  (`docs/research/p3-f-smoke-2026-10-13.md`).
  - A lead Claude agent, run headless through the Claude Agent SDK, starts up to 3 helper agents.
    Each helper works in its own git worktree.
  - The owner approves edits and commands, reviews each diff, and merges or discards it.
  - Code lives in:
    - `packages/orchestrator` (the pure engine);
    - `packages/adapters/claude-code/src/managed` (the SDK);
    - `packages/server/src/control` (wiring);
    - `packages/server/src/workspace` (worktrees);
    - `packages/web/src/features/control` (the UI).
- **Phase 4 (this file)** turns the app into an **agent workspace organised like a Jira board**.

## 1. Goal

One place to run AI work on many projects:

1. **Projects:** add an existing git folder, or create a new git repo from the UI. Each project gets an
   **AI work environment**: how agents process work, the limits, the pre-approved actions, the context
   files, and the **harness**.
2. **Board per project:** create tickets, plan each one with the lead agent, approve or comment on
   the plan, let agents work, answer their questions, review the changes and run the checks, then
   merge. Tokens and estimated cost are visible on the board.
3. **A clear, modern UI.** Someone who doesn't know Claude Code must understand it. The owner's
   reference: a multi-agent tree with per-agent cards (role, status, worktree branch, progress, a
   prompt box), a side panel for the selected agent (chat, activity, files, tests), status counts,
   and quick actions. `packages/web/DESIGN.md` stays binding: plain words, units on every number,
   "estimated" cost, technical detail behind "Details".

## 2. Owner decisions (2026-10-13)

| #   | Decision                                                                                                                                                                                                                                                                                                                                              | Recorded in        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| D1  | New project = **both**: add an existing git folder, or **create a new empty git repo** from the UI; then a guided setup                                                                                                                                                                                                                               | ADR-0017           |
| D2  | **1 ticket = 1 run.** Board columns follow the ticket's run. A ticket can be re-run (a new run; old runs stay in its history)                                                                                                                                                                                                                         | ADR-0016           |
| D3  | **Plan first.** The lead proposes a plan (`submit_plan`); the owner approves or comments before any helper starts. Approvals and comments stay required                                                                                                                                                                                               | ADR-0016           |
| D4  | Agent tree limits **configurable per project**: defaults 3 helpers / depth 1; hard ceiling **6 helpers / depth 2**                                                                                                                                                                                                                                    | ADR-0013 amendment |
| D5  | **Internal board only** (local SQLite). No Jira sync; the local-only rule stays                                                                                                                                                                                                                                                                       | ADR-0016           |
| D6  | **Harness** = code and config in the project that let the AI check its own work (tests, lint, build, e2e, instructions), declared in a version-controlled manifest **`.acp/harness.json`** in the repo. The app shows harness status, offers a "Build the harness" ticket that Claude implements, and runs the checks on agents' changes before merge | ADR-0017           |
| D7  | **Per-project allowlist** of pre-approved safe actions (edits inside the agent's own worktree; the harness check commands). Everything else still asks                                                                                                                                                                                                | ADR-0013 amendment |
| D8  | Agents receive the project's chosen **context files** (e.g. `CLAUDE.md`) explicitly, because settings isolation (ADR-0012) no longer loads them                                                                                                                                                                                                       | ADR-0012 amendment |

## 3. Glossary (UI words in bold)

- **Project**: a registered git repository (existing or newly created).
- **AI work environment**: the project's agent setup (D4, D7, D8) plus its harness.
- **Harness**: the project's own checks and instructions, declared in `.acp/harness.json` (D6).
  Status is one of:
  - **Ready**: valid manifest with at least one required check;
  - **Partial**: valid manifest, but no required check;
  - **Invalid**: the manifest doesn't parse;
  - **None**: no manifest.
- **Ticket**: a unit of work on the board, e.g. `WEB-12 Add dark mode`. It has a type (feature, bug,
  chore, harness), a priority, labels, a description and comments.
- **Run**: one attempt by the agents at a ticket. This is the Phase 3 orchestration run; it now
  has a `ticketId`.
- **Plan**: the lead's proposed approach for a run, with a summary and steps (title, which helper role,
  detail). It is versioned, and each version is approved or sent back with comments.
- **Lead agent**, **helper agent**: as in Phase 3. A helper may start its own helpers only when the
  project allows depth 2.
- **Checks**: the harness check commands, run on a helper's changes before merge.

## 4. User flows

### 4.1 Create a project

1. **Board → "New project"** opens the wizard. Step 1 offers **Add an existing folder** (as in
   Setup today) or **Create a new repository**:
   - parent folder, which must exist and be absolute;
   - name, which must be a new folder;
   - optional first README.

   The server runs `git init -b main` and makes an initial commit (ADR-0017).

2. **Step 2, how agents work:**
   - plan first (on; fixed on for now);
   - helpers at once (1–6, default 3);
   - helper depth (1–2, default 1);
   - default budget per agent (budget tokens);
   - model (provider default unless chosen).
3. **Step 3, pre-approved actions:**
   - "Let helpers edit files in their own copy without asking" (default off);
   - "Let helpers run this project's checks without asking" (default on once a harness exists).
4. **Step 4, context for agents:**
   - pick files agents read at start; `CLAUDE.md` is pre-selected if present;
   - at most 10 files, 32 KiB in total.
5. **Step 5, harness:** shows the status (Ready / Partial / Invalid / None) with an explanation.
   - **None:** a button "Create a 'Build the harness' ticket" adds a ready-written ticket to the
     board (see §6.4).
6. **Finish** goes to the project's board.

### 4.2 Work a ticket

1. **New ticket**: title, type, priority, labels, description. It lands in **Backlog**; the owner
   moves it to **Ready**.
2. **Start** (button, or drag Ready → Planning) creates a run for the ticket. The lead gets the
   ticket, the project context files, the agent setup, and the plan-first instruction.
   - **Planning:** the lead reads the code (read-only) and calls `submit_plan`.
3. **Plan review:** the owner reads the plan and either **Approves** or **Requests changes** with a
   comment. Requesting changes sends the comment to the lead, which submits plan version 2.
4. **Agents working:** the lead starts helpers per the plan, within the limits. The tree grows live.
5. **Needs you:** any pending approval (an action that isn't pre-approved, or a budget raise) moves
   the card here, with a badge.
6. **In review:** when the helpers have stopped, each helper's changes appear with **Checks** (the
   harness commands run in its worktree). The owner chooses **Merge**, **Merge anyway** (when a
   required check failed; needs a confirmation and a reason), or **Discard**.
7. **Done:** every change is merged or discarded. The ticket keeps its history: runs, plans,
   comments, and token totals.
8. **Re-run** (on Done or Cancelled tickets) starts a new run on the same ticket.

## 5. UX specification

Visual rules come from `packages/web/DESIGN.md`: calm, plain words, units, "estimated", no
"completed" for sessions, light and dark themes. Below are layouts, not pixels. Reuse the components
in `packages/web/src/components/` and `features/sessions/FamilyTree.tsx`.

### 5.1 Navigation

The sidebar order is: **Board** (new home of daily work), Overview, Sessions, Tokens, Projects, and
at the bottom Setup and Data health. The old "Control panel" entry folds into the ticket page;
`#/control` redirects to the board. A project switcher sits at the top of the board.

### 5.2 Board — `#/board/:projectId` (default: last used project)

```
┌ Board ▸ [ web-app ▾ ]   Harness: ● Ready   3 running · 1 needs you      [+ New ticket] [⚙ Setup] ┐
│ Tokens this week: 1.2M input · 84K output · 3.1M cache read   Estimated cost (latest runs): ~$4.20 │
├──────────┬────────┬──────────┬─────────────┬───────────────┬───────────┬────────────┬──────────┤
│ Backlog  │ Ready  │ Planning │ Plan review │ Agents working│ Needs you │ In review  │ Done     │
│ ┌──────┐ │        │          │ ┌─────────┐ │ ┌───────────┐ │ ┌───────┐ │            │          │
│ │WEB-14│ │        │          │ │WEB-12   │ │ │WEB-9      │ │ │WEB-11 │ │            │          │
│ │Title │ │        │          │ │Dark mode│ │ │Rate limit │ │ │ ⚠ 1   │ │            │          │
│ │bug·hi│ │        │          │ │plan v2  │ │ │3 helpers  │ │ │approve│ │            │          │
│ └──────┘ │        │          │ └─────────┘ │ │42K tokens │ │ └───────┘ │            │          │
└──────────┴────────┴──────────┴─────────────┴───────────────┴───────────┴────────────┴──────────┘
```

- **Columns:**
  - Backlog and Ready are owner-set ticket statuses.
  - Planning, Plan review, Agents working, Needs you and In review are **derived from the ticket's
    current run** (§7.2).
  - Done and Cancelled are terminal; Cancelled is collapsed by default.
- **Card:**
  - key, title, type icon, priority, labels;
  - while running: helper count, budget tokens used, and a "needs you" badge with a count;
  - last activity (relative time).
- **Drag and drop** uses native HTML5 drag events, with no new dependency, and has keyboard
  alternatives (a Move menu). Only owner-settable moves are allowed:
  - Backlog ↔ Ready;
  - Ready → Planning, which starts a run;
  - any → Cancelled, with a confirmation.
- **Header stats:**
  - token totals per type, never summed into one number;
  - estimated cost as the latest reported cost per run, never summed across runs and labelled
    "estimated";
  - harness badge and running count.

### 5.3 Ticket page — `#/tickets/:ticketId` (modelled on the reference image)

```
┌ ← Board   WEB-12 Dark mode toggle         ● Agents working   Run 2 of 2 ▾   [Stop all] [⋯]     ┐
│ 4 agents · 1 needs you · 182K budget tokens · ~$0.61 estimated                                     │
├───────────────────────────────────────────────────────────────┬──────────────────────────────────┤
│  Agent tree (canvas)                                            │ Side panel: ▸ selected agent     │
│            ┌──────────────────────────────┐                     │ [Chat][Activity][Changes]        │
│            │ Lead  ● Working              │                     │ [Checks][Approvals][Details]     │
│            │ Plan v2 approved · 3 helpers │                     │                                  │
│            │ [ Message the lead…    ➤ ]   │                     │ Chat with the lead (plan, notes) │
│            └──────────────┬───────────────┘                     │  …                               │
│      ┌─────────────┬──────┴──────┬─────────────┐                │ Changes: 4 files +120 −12        │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                      │ Checks: ✓ test ✓ lint ✗ build    │
│  │Settings UI│ │Theme store│ │Tests      │                      │ Worktree: acp/run/agent (branch) │
│  │● Working  │ │⚠ Needs you│ │✓ Finished │                      │                                  │
│  │acp/…/ui   │ │acp/…/store│ │acp/…/test │                      │                                  │
│  │12K/50K ▓▓░│ │8K/50K ▓░░ │ │22K/50K ▓▓▓│                      │                                  │
│  │[message ➤]│ │[message ➤]│ │           │                      │                                  │
│  └───────────┘ └───────────┘ └───────────┘                      │                                  │
├───────────────────────────────────────────────────────────────┴──────────────────────────────────┤
│ Ticket: description · comments · plan history (v1 changes requested, v2 approved) · runs history │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Tree canvas:**
  - It is built only from agent runs (`parentAgentRunId`), never invented.
  - Each node shows: role, status in words, worktree branch (short), budget bar
    ("12,000 of 50,000 budget tokens"), latest activity sentence, a prompt box (sends `message_agent`
    through the engine), and Stop.
  - Depth-2 helpers nest under their parent helper.
  - React Flow (`@xyflow/react`, already a dependency) or the CSS tree from `FamilyTree`.
- **Side panel** for the selected agent, with these tabs:
  - **Chat**: the lead only; owner ↔ lead messages and plan notes.
  - **Activity**: content-free sentences.
  - **Changes**: files with +/− and the diff; Merge / Discard when in review.
  - **Checks**: harness results with duration, exit status, and an output tail.
  - **Approvals**: pending and decided requests.
  - **Details**: ids, branch, model, session link.
- **Plan review state:**
  - The canvas is replaced by the **plan card**: summary, steps (title, role, detail), plan
    version, Approve / Request changes, and a comment box.
  - Earlier versions are collapsed.
- **Quick actions:** Stop all, Re-run (when terminal), Open board.

### 5.4 Project settings — `#/projects/:id/settings`

These are the same sections as wizard steps 2–5, editable later:

- an **AI work environment** card;
- a **Harness** card:
  - status;
  - the parsed check list (name, command shown as code, required or optional, timeout);
  - the context files;
  - "Run checks now" on the main branch, read-only;
  - "Create 'Build the harness' ticket".
- **Danger zone**: "Remove from this app", which never deletes the folder. It is refused while runs
  exist (ADR-0016).

### 5.5 New project wizard — `#/projects/new`

Five steps with progress dots, Back / Next, and plain-language help per field (§4.1). Validation
errors are sentences.

## 6. Contracts, data and behaviour (built in P4-0, implemented by later WPs)

All zod schemas live in `@acp/core`: domain in `packages/core/src/workspace/**`, DTOs in
`packages/core/src/api/workspace.ts`. The names below are binding; P4-0 writes the exact fields.

### 6.1 Domain

- **`TicketSchema`**:
  - `id`, `projectId`;
  - `key` (`<PROJECT_KEY>-<n>`, where `PROJECT_KEY` is 2–6 uppercase letters stored on the project
    setup);
  - `title` (1–200), `description` (≤ 20,000, owner text, stored per ADR-0016), `type`
    (`feature | bug | chore | harness`), `priority` (`low | medium | high | urgent`), `labels`
    (≤ 10 × 1–30 chars);
  - `status` (`BACKLOG | READY | ACTIVE | DONE | CANCELLED`), `currentRunId | null`;
  - timestamps.
- **`TicketStage`** (derived, never stored): `BACKLOG | READY | PLANNING | PLAN_REVIEW | WORKING |
NEEDS_YOU | IN_REVIEW | DONE | CANCELLED`.
- **`TicketCommentSchema`**: `id`, `ticketId`, `runId | null`, `planId | null`, `author`
  (`owner | lead`), `body` (≤ 8,000), `createdAt`.
- **`TicketPlanSchema`**:
  - `id`, `ticketId`, `runId`, `version`;
  - `summary` (≤ 2,000);
  - `steps[]` (1–12 entries: `title` ≤ 120, `role` ≤ 60, `detail` ≤ 2,000), `plannedHelpers`;
  - `status` (`proposed | approved | changes-requested | superseded`), `createdAt`, `decidedAt`.
- **`ProjectAgentSetupSchema`**:
  - `projectId`, `projectKey`;
  - `planFirst` (literal `true` for now);
  - `maxConcurrentHelpers` (1–`HARD_MAX_HELPERS` = 6), `maxDepth` (1–`HARD_MAX_DEPTH` = 2);
  - `defaultBudgetTokensPerAgent`, `model | null`;
  - `allowlist` (`editInOwnWorktree: boolean`, `runHarnessChecks: boolean`);
  - `contextFiles` (≤ 10 repo-relative paths, no `..`, no absolute paths).
- **`HarnessManifestSchema`** for the file `.acp/harness.json` in the repo:
  - `version: 1`, `description`;
  - `checks[]` (1–20 entries): `id` (slug), `name`, `argv` (non-empty string array; argv[0] a bare
    command name such as `pnpm` or `npm`, never a path outside the repo and never a shell), `cwd`
    (repo-relative, optional), `timeoutSec` (1–1800), `required` (boolean);
  - `context` (optional repo-relative files; merged into the project's context files);
  - `notes` (optional text shown to agents).
- **`HarnessStatus`**: `none | invalid | partial | ready`, plus `checkedAt`, `problems[]` (plain
  sentences) and `checks[]` (`id`, `name`, `required`).
- **`CheckRunSchema`**:
  - `id`, `runId`, `agentRunId | null` (null = the main branch), `checkId`;
  - `status` (`passed | failed | timed-out | error | skipped`), `exitCode`, `durationMs`;
  - `outputTail` (≤ 16 KiB, redacted, stored per ADR-0017), `startedAt`.
- **Run changes:**
  - `OrchestrationRun` gains `ticketId | null`;
  - `RunStatus` gains `PLANNING` and `PLAN_REVIEW`;
  - the lead tools gain **`submit_plan`** (`{ summary, steps[] }`);
  - `start_agent` is refused with `plan_not_approved` until a plan is approved.
- **`ManagedAgentSpec`** gains:
  - `context?: string`, appended to the system prompt, ≤ 32 KiB (ADR-0012 amendment);
  - `canStartHelpers?: boolean`: a depth-2 parent helper gets `start_agent`, `agent_status`,
    `list_agents` and `message_agent` for its own children only.

### 6.2 Board and ticket stages

`stage(ticket, run)`:

| Ticket status / run state       | Stage                                                |
| ------------------------------- | ---------------------------------------------------- |
| `CANCELLED`                     | `CANCELLED`                                          |
| `DONE`                          | `DONE`                                               |
| `BACKLOG` / `READY`             | same                                                 |
| run `PLANNING` / `QUEUED`       | `PLANNING`                                           |
| run `PLAN_REVIEW`               | `PLAN_REVIEW`                                        |
| any pending approval on the run | `NEEDS_YOU`                                          |
| run `RUNNING` / `BLOCKED`       | `WORKING`                                            |
| run `REVIEW` / `NEEDS_REVIEW`   | `IN_REVIEW`                                          |
| run `COMPLETED`                 | `DONE` (ticket status set to `DONE` by the server)   |
| run `FAILED` / `CANCELLED`      | `READY` again, with a "last run failed/stopped" note |

`stage()` is a pure function in `@acp/core`, so the server and the web agree.

### 6.3 API (all mutations need `X-ACP-CSRF`; responses parsed with DTOs)

| Route                                                                    | Body → Response                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `POST /api/projects/new`                                                 | `{ parentDir, name, readme? }` → `ProjectDto` (201)       |
| `GET /api/projects/:id/setup` · `PUT` same                               | → `ProjectAgentSetupDto`                                  |
| `GET /api/projects/:id/harness`                                          | → `HarnessStatusDto`                                      |
| `POST /api/projects/:id/harness/checks`                                  | run checks on the main branch → `CheckRunDto[]`           |
| `POST /api/projects/:id/harness/ticket`                                  | → `TicketDto` ("Build the harness")                       |
| `GET /api/projects/:id/context-candidates`                               | → repo-relative files suitable as context                 |
| `GET /api/board?projectId=`                                              | → `BoardDto` (header stats + columns of `TicketCardDto`)  |
| `GET /api/projects/:id/tickets` · `POST` same                            | → `TicketCardDto[]` / `TicketDto` (201)                   |
| `GET /api/tickets/:id` · `PATCH` same                                    | → `TicketDetailDto` (ticket, runs, plans, comments)       |
| `POST /api/tickets/:id/move`                                             | `{ status: BACKLOG \| READY \| CANCELLED }` → `TicketDto` |
| `POST /api/tickets/:id/start`                                            | → `TicketDetailDto` (creates a run in PLANNING)           |
| `POST /api/tickets/:id/comments`                                         | `{ body }` → `TicketCommentDto`                           |
| `POST /api/tickets/:id/plans/:planId/decision`                           | `{ decision: approve \| request-changes, comment? }`      |
| `GET /api/runs/:id/checks` · `POST /api/runs/:id/agents/:agentId/checks` | → `CheckRunDto[]`                                         |
| existing `/api/runs/**` (Phase 3)                                        | unchanged; used by the ticket page                        |

`POST /api/runs/:id/review` gains `action: merge-anyway` with a required `reason`, allowed only when
a required check failed.

### 6.4 The "Build the harness" ticket

The template text is stored in `@acp/core` (`HARNESS_TICKET_TEMPLATE`). It asks the agents to:

- inspect the project;
- create or extend tests, a lint step and a build step where sensible;
- write `.acp/harness.json` with the commands as argv arrays;
- keep the commands fast (under 10 minutes total);
- list in the plan which checks are required.

It is a normal plan-first ticket, so the owner approves its plan and reviews its changes.

### 6.5 Database (migration `0003_workspace.sql`, P4-B)

- **New tables:**
  - `project_setup` (1:1 with projects; JSON validated);
  - `tickets` (per-project `seq` for keys);
  - `ticket_comments`;
  - `ticket_plans` (`steps` JSON);
  - `check_runs`.
- **Column added:** `orchestration_runs.ticket_id` (nullable FK, via `ALTER TABLE … ADD COLUMN`).
- **Not stored:** harness status. It is read from the repo on demand and cached in memory.
- **Deletes:** deleting a ticket is not supported; tickets are cancelled. A project with tickets
  can't be removed (409).

## 7. Security and ADRs (P4-0 writes them)

- **ADR-0016, board and tickets:**
  - an internal board only; 1 ticket = 1 run; plan-first;
  - stored owner text: ticket descriptions, owner comments, lead comments and plans (the lead's own
    words to the owner), an amendment to ADR-0009/0015; worker conversation content is still never
    stored;
  - tickets are cancelled, never deleted.
- **ADR-0017, project creation, harness and checks:**
  - `git init` only inside an existing absolute parent folder, into a new folder;
  - the harness manifest lives in the repo and is versioned with the code;
  - checks run with `execFile(argv[0], argv.slice(1))` and no shell;
  - `cwd` is inside the agent's worktree (or a read-only temporary worktree of main for "Run checks
    now");
  - a per-check timeout, kill on timeout, and an output tail capped and redacted;
  - a filtered environment, without `ACP_*` and `GIT_*` variables;
  - argv[0] must be a bare command name (`^[a-z0-9][a-z0-9._-]*$`), resolved through `PATH`;
  - a manifest change counts as a code change and goes through review like any other.
- **ADR-0013 amendment:**
  - limits configurable per project up to the hard ceiling (6 helpers, depth 2);
  - per-project allowlist:
    - `editInOwnWorktree` auto-approves Edit, Write, MultiEdit and NotebookEdit when the target path
      resolves inside the agent's own worktree (realpath, no symlink escape);
    - `runHarnessChecks` auto-approves a Bash call whose command string equals one of the manifest's
      checks exactly (argv joined by single spaces, no shell metacharacters).
  - Auto-approvals are recorded as approvals with `decidedBy: allowlist`, for audit.
- **ADR-0012 amendment:** context files are read by the server from the repo (realpath inside the
  repo root, size caps) and passed as `ManagedAgentSpec.context`. They are never read from
  `~/.claude`.

## 8. Work packages

Owned paths are exclusive. Shared files are edited only where stated:

- `packages/web/src/lib/copy.ts` and `lib/api.ts`: add-only sections, one per WP.
- `App.tsx`, `router.ts`, `Shell.tsx`: route or nav additions only.
- `e2e`: your own spec files.

The coordinator resolves merge conflicts in shared files.

| WP       | Owns                                                                                                                                                             | Depends           | Deliverable and acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P4-0** | coordinator: `packages/core/src/{workspace,orchestration,adapters,api}/**`, `docs/decisions/**`, `docs/**`                                                       | owner approval    | ADR-0016, ADR-0017, amendments to 0012/0013; all §6 schemas, DTOs, request schemas, `stage()`, `HARNESS_TICKET_TEMPLATE`, limit ceilings, `submit_plan`, the new run statuses, and the `ManagedAgentSpec` fields, each with tests. `pnpm check` green.                                                                                                                                                                                                                               |
| **P4-A** | `packages/orchestrator/**`                                                                                                                                       | P4-0              | **Engine:** plan phase (`PLANNING` → `submit_plan` → `PLAN_REVIEW` → approve → `RUNNING`, or request changes → `PLANNING` with the comment sent to the lead), `plan_not_approved` refusals, per-run limits from the setup (validated against the ceiling), depth 2 (parent helpers start children; their status and budget roll up), allowlist evaluation as a pure function returning an auto-approved approval, ticket-aware run creation. All transitions tested; refusals typed. |
| **P4-B** | `packages/db/src/migrations/0003_workspace.sql`, `packages/db/src/repositories/workspace/**`, `packages/db/src/index.ts` export, `packages/db/README.md` section | P4-0              | Migration and repositories: `project_setup`, `tickets` (atomic per-project sequence), `ticket_comments`, `ticket_plans`, `check_runs`, `orchestration_runs.ticket_id`. Temp-file DB tests, an upgrade test from a 0002 database, no edit to 0001/0002.                                                                                                                                                                                                                               |
| **P4-C** | `packages/server/src/harness/**` (+ tests)                                                                                                                       | P4-0              | **Harness:** manifest reader and validator (status and problems as plain sentences), context-file reader (realpath inside the repo, caps), check runner (`execFile`, no shell, timeouts with kill, output tail cap and redact, filtered environment, sequential), "run on main" through a temporary detached worktree (uses `packages/server/src/workspace`). Tests with temp git repos and tiny scripts.                                                                            |
| **P4-I** | `packages/adapters/claude-code/src/managed/**`                                                                                                                   | P4-0              | **Adapter:** `context` appended to the system prompt (SDK `systemPrompt` preset append); `canStartHelpers` gives a depth-2 parent helper the child-management tools only; `submit_plan` exposed through the lead tool server from `LeadToolInputs`. Fake-`query` tests.                                                                                                                                                                                                              |
| **P4-E** | `packages/web/src/features/board/**`; nav and routes for `#/board`                                                                                               | P4-0              | **Board UI (§5.1–5.2):** project switcher, header stats, columns by `stage()`, cards, native drag and drop plus a keyboard Move menu, a New ticket dialog, empty states. Fixture-DTO tests; screenshots in light and dark at 1440 and 1024.                                                                                                                                                                                                                                          |
| **P4-F** | `packages/web/src/features/project-setup/**`; routes for `#/projects/new` and `#/projects/:id/settings`                                                          | P4-0              | **Wizard and settings (§4.1, §5.4–5.5):** both creation paths, agent setup, allowlist, context-file picker, harness card with "Run checks now" and "Create 'Build the harness' ticket". Fixture tests and screenshots.                                                                                                                                                                                                                                                               |
| **P4-D** | `packages/server/**` except `src/workspace/**` and `src/harness/**`                                                                                              | P4-A, B, C, I     | **Server:** routes in §6.3; ticket ↔ run wiring (start, plan decisions, stage-driven ticket status, re-run); `git init` project creation; setup persistence; context injection; allowlist in the approval bridge; checks run when a run enters review and on demand; `merge-anyway`; SSE notices for tickets and the board; `#/control` runs keep working. Supertest per route with the fake adapter and temp repos.                                                                 |
| **P4-G** | `packages/web/src/features/ticket/**`; route `#/tickets/:id`; redirect `#/control`                                                                               | P4-0 (DTOs); P4-D | **Ticket page (§5.3):** tree canvas, per-agent cards with prompt boxes, side panel tabs, plan review card, checks, merge-anyway flow, history. It can start against fixtures before P4-D lands.                                                                                                                                                                                                                                                                                      |
| **P4-H** | `packages/server/tests/verification/workspace/**`, `packages/web/e2e/workspace.spec.ts`                                                                          | P4-D, E, F, G     | **Verification:** fake-Claude e2e of the full flow (create a repo → setup → harness ticket → plan → request changes → approve → helpers → an allowlisted edit and check run → review with a failing then passing check → merge → Done), depth 2 and limit refusals, restart. Then one real smoke run, **only with the owner's consent at that time**.                                                                                                                                |

**Order:** P4-0 → in parallel P4-A, P4-B, P4-C, P4-I, P4-E, P4-F → P4-D, with P4-G starting as soon as
P4-0 lands → P4-H.

## 9. Progress protocol (so no agent repeats work)

1. **One progress file per WP:** `docs/phase-4/wp/<WP>.md`.
   - Only that WP's agent edits it. It holds the status (`todo | in-progress | review | done |
blocked`), the branch, a task checklist, an append-only **work log**, handoff notes and blockers.
   - `docs/phase-4/STATUS.md` is the index. Only the coordinator edits it, on merge.
2. **Before you start**, check whether the WP already has a branch:

   ```bash
   git branch --list 'wp/p4-*'
   git log --oneline main..wp/p4-<id>-<slug>              # if the branch exists
   git show wp/p4-<id>-<slug>:docs/phase-4/wp/<WP>.md      # its progress file
   ```

   If it exists, **continue from it**: check it out in your worktree (or create a new worktree from
   it) and pick up the unchecked tasks. Never start a second branch for the same WP. If the branch is
   already merged (STATUS says done), don't redo it.

3. **Claim the WP.** Create `wp/p4-<id>-<slug>` from `main`. As your **first commit**, set your
   progress file to `in-progress` with the date and your branch.
4. **Commit at every checkpoint**, as soon as `pnpm check` passes. Each commit appends a log line to
   your progress file: date, what you did, the commit, and the real check results. Uncommitted work in
   a worktree is lost if the session ends; this happened twice in Phase 3.
5. **Finish.** Set your file to `review`, write the AGENTS.md §9 completion report into it, and stop.
   The coordinator merges and sets `done` in STATUS.md.
6. **Blocked** (you need a contract change or a decision): set `blocked`, write what you need, why,
   and the proposed diff, and stop that part.
7. **Interrupted sessions** (usage limits, closed chats): follow "If a session was interrupted" in
   [`STATUS.md`](STATUS.md). In short: find the branch and worktree, rescue uncommitted changes by
   continuing in the same worktree, read the work log, and never restart a WP that has commits.

## 10. Prompts

### 10.1 Any WP (fill in the WP id)

> You are working on the Agent Control Plane repo at `/Users/grootan/Desktop/agent-control-plane`.
> Implement **<WP>** of Phase 4.
>
> 1. **Read first:** `docs/phase-4/README.md` (all of it), `AGENTS.md`, `CLAUDE.md`,
>    `packages/web/DESIGN.md` (for UI WPs), and your progress file `docs/phase-4/wp/<WP>.md`.
> 2. **Follow the progress protocol in README §9 exactly:**
>    - check for an existing branch and continue it;
>    - otherwise claim the WP with the first commit;
>    - commit at every checkpoint, with a log line in your progress file.
> 3. **Scope:** edit only your owned paths (README §8). If you need a contract or shared-file change,
>    set the WP `blocked` with the proposed diff.
> 4. **Toolchain:** Node 22 (`source ~/.nvm/nvm.sh && nvm use`) and pnpm 10.26.x. If `pnpm --version`
>    shows 8, put a directory containing only a symlink to a pnpm 10 binary first on `PATH`. Run
>    `pnpm install --frozen-lockfile` first.
> 5. **Never:**
>    - read the real `~/.claude`;
>    - edit Claude settings;
>    - change dependencies;
>    - start the real Claude Agent SDK or `claude`, outside an owner-approved smoke run;
>    - use ports 7420 or 5173 (the owner's app); use 7500 or higher.
> 6. **Finish:** run `pnpm check` (plus `pnpm --filter @acp/web test:e2e` for web or verification
>    WPs, with `ACP_E2E_PORT` set to a free port). Put the AGENTS.md §9 report in your progress file
>    and set it to `review`. Do not push or merge.
>
> End commit messages with the attribution line your environment specifies.

### 10.2 Coordinator (review and merge loop)

> Act as the Phase 4 coordinator.
>
> 1. **Read** `docs/phase-4/README.md` and `docs/phase-4/STATUS.md`.
> 2. **For each WP whose progress file says `review`:**
>    - check its scope with `git diff --name-only main...<branch>`;
>    - rebase it on `main`, resolving add-only conflicts in shared files by keeping both sides;
>    - run `pnpm check` and the e2e yourself;
>    - read the security-relevant code (exec, git, file reads, approvals);
>    - for UI, look at the screenshots;
>    - merge with `git merge --ff-only` and set the WP to `done` in STATUS.md.
> 3. **Start the next wave** when its dependencies are done.
> 4. **Record decisions** as ADR amendments.
> 5. **Never push** without the owner's OK.

## 11. Out of scope for Phase 4

- Jira or other external sync, and any network call except the agents' own Claude traffic.
- Trees deeper than 2, more than 6 helpers.
- Auto-merge.
- Harness experiments (baseline vs. harness-assisted comparisons; the former "Harness Lab").
- The Codex adapter.
- Recommendations.
- Multi-user and authentication: the app stays single-user and local.

## 12. Risks

| Risk                                         | Mitigation                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Check commands run arbitrary project code    | owner-reviewed manifest in the repo; argv only; timeouts; filtered environment; inside worktrees; visible output |
| The allowlist widens what agents do unasked  | off by default for edits; exact-match rules; recorded as approvals; realpath checks                              |
| Depth 2 makes trees harder to review         | per-project opt-in; ceiling 6 / 2; budgets roll up; Stop all stops descendants first                             |
| The lead skips `submit_plan` or plans badly  | `start_agent` refused until approved; the owner comments and the lead revises (versioned)                        |
| Parallel agents conflict on shared web files | add-only sections, one WP per feature folder, coordinator-resolved conflicts                                     |
| Sessions end mid-work                        | the progress protocol (§9): commit early and often, continue existing branches                                   |
