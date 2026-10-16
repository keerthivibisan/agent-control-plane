# Project workspace redesign — plan (draft for owner approval)

> Status: **approved by the owner on 2026-10-16; R-0 done, wave 2 (R-A, R-C) started.** Owner
> decisions are in §2. Progress: [STATUS.md](STATUS.md).

## 1. Why

The UI grew one page per phase. There are nine global sidebar entries (Board, Overview, Control panel,
Sessions, Tokens, Projects, Setup, Data health, plus a project list), and Board and Control panel show
overlapping run views. The owner wants:

- a **project-first** app: pick a project, then everything you see is about that project;
- fewer, clearer pages, and a more modern, friendlier look;
- **Skills** you can add and edit in the UI;
- an **Agent workflow** page: which agents take part, how many helpers can run, and how a ticket flows
  (plan → orchestrate → helpers → review and merge → final code review → unit tests), shown as a graph,
  with each agent mapped (or not) to a skill;
- a **Harness** page that answers "do we have a harness for this project, and does it pass?";
- a **Tokens** page per project: how many sessions, how many tokens, and new work vs cache reuse.

## 2. Owner decisions (2026-10-16)

| Topic                    | Decision                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills                   | Real Claude Code skills, stored as files in the **project repo**: `.claude/skills/<name>/SKILL.md`. Agents load them natively, and they are versioned with the code.                           |
| Workflow                 | **Fixed stages, each configurable**, not a free-form graph editor. Each stage can be turned on or off, given a model, a skill and a limit.                                                     |
| Tokens "actual vs total" | **New work vs cache reuse.** New work is input + output tokens. The total also includes cache writes and cache reads. Both come from the same deduplicated usage, so nothing is counted twice. |
| P4-H                     | API-level verification now (in progress on `wp/p4-h-verify`). Browser tests are written against the new UI.                                                                                    |

## 3. Information architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [AC] Agent Control Plane      [ ftl-rendering-harness ▾ ]          ⌘K   ☾   │  top bar: project switcher
├───────────────┬──────────────────────────────────────────────────────────────┤
│ PROJECT       │                                                              │
│  ▣ Board      │   page content                                               │
│  ⑂ Workflow   │                                                              │
│  ✦ Skills     │                                                              │
│  ✓ Harness    │                                                              │
│  ◔ Tokens     │                                                              │
│  ≡ Sessions   │                                                              │
│  ⚙ Settings   │                                                              │
│               │                                                              │
│ ───────────── │                                                              │
│  All projects │                                                              │
│  Data health  │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

- **Project switcher** in the top bar. It remembers the last project. "All projects" is the
  cross-project home: project cards with status, plus "New project".
- **Seven project pages:** Board, Workflow, Skills, Harness, Tokens, Sessions, Settings. There are no
  more global Overview, Control panel, Tokens or Setup entries.
- **The Control panel goes away as a page.** A run is always seen on its ticket page, which already
  shows the agent tree. Quick ad-hoc runs become "Quick ticket" on the board. Old `#/control/...`
  links redirect to the run's ticket or to the board.
- **Overview content moves:**
  - "Running now" and "Needs you" go to the board header.
  - The cross-project summary goes to "All projects".
- **Setup** (hooks and the data root) moves under Data health as "Connection".
- **Routes:**

  | Route                                       | Page         |
  | ------------------------------------------- | ------------ |
  | `#/p/:projectId/board`                      | Board        |
  | `#/p/:projectId/workflow`                   | Workflow     |
  | `#/p/:projectId/skills`, `…/skills/:name`   | Skills       |
  | `#/p/:projectId/harness`                    | Harness      |
  | `#/p/:projectId/tokens`                     | Tokens       |
  | `#/p/:projectId/sessions`, `#/sessions/:id` | Sessions     |
  | `#/p/:projectId/settings`                   | Settings     |
  | `#/p/:projectId/tickets/:ticketId`          | Ticket       |
  | `#/projects`, `#/projects/new`, `#/health`  | Global pages |

  Every old route redirects to its new home, so links in commit messages and notes still work.

## 4. Pages

### 4.1 Board (exists; simplify)

- Header: the project name, one line of live state ("2 running · 1 needs you"), and **New ticket**.
  The 7-day token tiles and the harness pill move to Tokens and Harness.
- Columns stay as built. The cancelled list stays collapsed.

### 4.2 Workflow (new) — "how agents work on a ticket"

A left-to-right graph (React Flow, already a dependency). Each node is a **stage**. Clicking a node
opens a side panel to configure it.

```mermaid
flowchart LR
  T([Ticket]) --> P[Plan<br/>planner agent]
  P --> A{You approve<br/>the plan}
  A -->|changes| P
  A --> O[Orchestrate<br/>lead agent]
  O --> H1[Helper 1]
  O --> H2[Helper 2]
  O --> H3[Helper …N ≤ 4]
  H1 & H2 & H3 --> R[Review & merge<br/>you + checks]
  R --> CR[Final code review<br/>reviewer agent]
  CR --> UT[Unit tests<br/>tester agent]
  UT --> D([Done])
```

| Stage             | Agent                     | Configurable                                                                      | Default |
| ----------------- | ------------------------- | --------------------------------------------------------------------------------- | ------- |
| Plan              | planner (read-only)       | on (always), model, skill                                                         | on      |
| Orchestrate       | lead (read-only)          | model, skill                                                                      | on      |
| Helpers           | worker ×N (own worktrees) | max helpers (1–4), nesting depth (1–2), budget per agent, model, skill, allowlist | 3, 1    |
| Review & merge    | you + harness checks      | required checks block merge (from the harness)                                    | on      |
| Final code review | reviewer (read-only)      | on/off, model, skill; posts findings as ticket comments                           | off     |
| Unit tests        | tester (own worktree)     | on/off, model, skill; its tests go through the same review & merge                | off     |

- **Skill mapping is shown on each node.** Either "✦ code-review" or "No skill". Choosing a skill
  tells that stage's agent to use it.
- **The same graph, live, on the ticket page.** Nodes light up as the run passes through them, and the
  existing agent tree appears under the Helpers node.
- **Plan and Orchestrate as separate agents.** Today one lead agent does both. As separate stages,
  the planner writes and revises the plan, and the lead receives the approved plan and runs the
  helpers. A project can choose "same agent" (today's behavior) or "separate agents".

### 4.3 Skills & Agents (new; agent files added 2026-10-16)

The owner also asked for agent definition files: `.claude/agents/<name>.md`, Claude Code subagents.
The page has two tabs, **Skills** and **Agents**. Agents work like skills: a list, New and Edit (name,
description, tools as a chip list or "all tools", model, instructions), Save, Commit, and Delete with
confirmation. ADR-0018's amendment sets the rules. A workflow stage can use one agent file (§6a,
ADR-0019 §6, built in R-I); each file shows which stages use it.

#### Skills tab

- **List:** the skills in the project repo's `.claude/skills/*/SKILL.md`, as name, description, which
  workflow stages use it, last changed, and whether the file has uncommitted changes.
- **New skill and Edit skill:**
  - fields: name (a slug), description (when to use it), and instructions (Markdown, with a live
    preview);
  - a small template picker: code review, unit tests, plan, docs;
  - **Save** writes the file;
  - **Commit** creates a git commit with only that file, on the current branch (argv git, owner
    action).
- **Delete** removes the skill folder, with confirmation, and only when the skill is used by no stage.
- Only the project's own skills are shown. The app never reads or writes `~/.claude/skills`, the
  owner's personal skills (AGENTS.md rule 4).

### 4.4 Harness (moved and expanded)

- A status card: "No harness yet", "Invalid", "Partial" or "Ready", with plain-language problems.
- The list of checks, each with its command, folder, time limit and whether it is required.
- **Run checks now** on the main branch, with each result's output tail and a history of past runs.
- **Build the harness** creates the ticket when there is no harness, and shows its progress.
- Where the harness is used: which workflow stage runs which checks.

### 4.5 Tokens (project-scoped)

- **Headline tiles:**
  - sessions (count) and runs/tickets with agents;
  - **New work** (input + output);
  - **Total processed** (new work + cache write + cache read);
  - **Cache reuse share**: cache reads as a share of the total, with a one-line explanation of why it
    is large;
  - estimated cost (provider-reported, always labeled estimated, never summed across sessions).
- **Charts:** new work and cache over time, as two charts because the scales differ by about 1000×.
- **Breakdown tables:** by session, by ticket/run, by agent role (planner, lead, helper, reviewer,
  tester), and by model.
- **Rules kept:**
  - unavailable means "unavailable", never 0;
  - direct and aggregate usage are shown side by side;
  - provenance badges stay.

### 4.6 Sessions (project-scoped)

This is today's Sessions page and family tree, filtered to the project. The session detail page is
unchanged.

### 4.7 Settings (simplified)

- Project name and folder, and the board key.
- Context files.
- The danger zone.
- Agent limits and the allowlist move to **Workflow**, where they are used.

## 5. Visual refresh (applies to all pages)

- **One page header pattern:** title, one-line description, primary action on the right. One
  card style, one table style, one empty-state pattern with an illustration and a single action.
- **Calmer density:**
  - 8-pt spacing;
  - larger section titles and fewer labels;
  - explanations in `(i)` tooltips instead of paragraphs;
  - icons on every nav entry, and the sidebar collapses to icons at ≤1280 px.
- **Refreshed tokens:**
  - neutral surfaces with a single accent;
  - softer borders and shadows;
  - status colors kept for meaning only;
  - light and dark checked at 1440 and 1024.
- **⌘K command palette:** jump to a project, ticket or page, and do New ticket or Run checks.
- `packages/web/DESIGN.md` is updated first (R-A). Every page WP follows it.

## 6. Backend changes (not only UI)

| Change                      | Why                                                                                                                                                                                                            | Where                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Workflow config per project | Stages on/off, models, skills, limits                                                                                                                                                                          | core contracts; db migration 0004; server   |
| New agent roles             | `planner`, `reviewer`, `tester` next to `lead` and `worker`                                                                                                                                                    | core `AgentRoleKind`; orchestrator; adapter |
| Stage sequencing            | After merge, optionally start the reviewer (read-only on the integrated branch) and the tester (own worktree; its change is reviewed and merged too)                                                           | orchestrator; server run service            |
| Skills API                  | `GET/POST/PUT/DELETE /api/projects/:id/skills[/:name]`, plus `POST …/:name/commit`. Writes are limited to `<repo>/.claude/skills/<slug>/SKILL.md`, with realpath containment, no symlinks, a size cap and CSRF | server; core DTOs                           |
| Skill use by agents         | A stage's skill is named in that agent's instructions ("Use the `<name>` skill"). Claude Code loads project skills itself                                                                                      | adapter (managed)                           |
| Project tokens summary      | Sessions count, new work vs total, by role, ticket and model                                                                                                                                                   | db queries; server; core DTO                |
| Persist audit fields        | `approvals.decided_by` and run limits (proposed 0004 from P4-D review)                                                                                                                                         | db migration 0004                           |

**New ADRs (written in R-0):**

- **ADR-0018, project skills written by the app.** It amends AGENTS.md rule 6, which forbids
  modifying Claude Code configuration. Skills are not settings, but they change what agents do, so the
  exception must be explicit: only `.claude/skills/<slug>/SKILL.md` in a registered project, only on
  an owner action, never `settings*.json`, and never `~/.claude`.
- **ADR-0019, workflow stages and the new roles.** It covers stage order, what each role may do
  (read-only vs worktree), how the reviewer's findings are stored (ticket comments, ADR-0016
  scope), and budgets per stage.

## 7. Work packages

Owned paths are exclusive. In shared web files (`lib/api.ts`, `lib/copy.ts`, `router.ts`, `App.tsx`)
each WP adds its own section or route only. The coordinator resolves conflicts.

| WP      | What                                                                                                                                                                                                               | Owns                                                                                                                                                                                           | Depends  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **R-0** | Coordinator: ADR-0018/0019, contracts (`workspace/workflow.ts`, `api/redesign.ts`, `usage/headline.ts`, new roles, `reviewer` comment author), migration 0004 spec (below), progress files                         | `packages/core/**`, `docs/**`                                                                                                                                                                  | approval |
| **R-A** | Shell and navigation: top-bar project switcher, project sidebar, `#/p/:projectId/...` routes and every old-route redirect, All projects page, ⌘K palette, refreshed visual tokens and shared components, DESIGN.md | `packages/web/src/app/**`, `src/components/**`, `src/lib/router.ts`, `src/index.css`, `packages/web/DESIGN.md`, `features/all-projects/**`, `features/palette/**`                              | R-0      |
| **R-C** | Engine: planner/lead split, reviewer and tester stages, workflow-driven sequencing, each role's toolset in the adapter                                                                                             | `packages/orchestrator/**`, `packages/adapters/claude-code/src/managed/**`                                                                                                                     | R-0      |
| **R-G** | Server and db: migration 0004 and its repositories, workflow GET/PUT, `RunWorkflowDto`, run-service wiring of R-C's stages, `decided_by` persistence                                                               | `packages/db/src/migrations/0004_*.sql`, `packages/db/src/repositories/redesign/**`, `packages/server/**` except `src/skills/**`, `src/harness/**`, `src/workspace/**`, `src/routes/tokens.ts` | R-0, R-C |
| **R-D** | Skills: file-safe server module and routes (ADR-0018), and the Skills page                                                                                                                                         | `packages/server/src/skills/**`, `packages/server/src/routes/skills.ts`, `features/skills/**`                                                                                                  | R-0, R-A |
| **R-F** | Tokens: db query, server route, and page                                                                                                                                                                           | `packages/db/src/queries/tokens.ts`, `packages/server/src/routes/tokens.ts`, `features/tokens/**`                                                                                              | R-0, R-A |
| **R-B** | Workflow page: graph and stage panel                                                                                                                                                                               | `features/workflow/**`                                                                                                                                                                         | R-A, R-G |
| **R-E** | Harness page                                                                                                                                                                                                       | `features/harness/**`                                                                                                                                                                          | R-A      |
| **R-H** | Board, ticket and settings simplification; live workflow graph on the ticket page                                                                                                                                  | `features/board/**`, `features/ticket/**`, `features/project-setup/**`, `features/sessions/**`                                                                                                 | R-A, R-G |
| **R-V** | Verification: browser e2e for the new UI (including P4-H's deferred `workspace.spec.ts`), screenshots, then one real smoke run with consent                                                                        | `packages/web/e2e/**`, `packages/server/tests/verification/redesign/**`                                                                                                                        | all      |

The server route files for skills and tokens are registered with one line each in `packages/server/src/app.ts`.
R-G owns that file, and the coordinator adds those lines at merge.

**Waves:**

1. R-0 (done).
2. R-A and R-C, in parallel.
3. R-G, R-D, R-F and R-E, in parallel.
4. R-B and R-H.
5. R-V.

### Migration 0004 (spec for R-G)

- `project_workflow(project_id PK → projects ON DELETE CASCADE, workflow TEXT JSON, updated_at)`, validated with
  `ProjectWorkflowSchema`. A missing row means `defaultProjectWorkflow()`.
- `agent_runs.stage TEXT NULL`, holding a `WorkflowStageId`. It is null for Phase 3 runs.
- `approvals.decided_by TEXT NULL` (`owner | allowlist | timeout`).
- `orchestration_runs.limits TEXT NULL`, the JSON limits snapshot at start.
- Ticket comments accept the author `reviewer`.
- An upgrade test runs from a 0003 database.

### Progress protocol and prompts

Use Phase 4's protocol (`docs/phase-4/README.md` §9) with these paths:

- progress files: `docs/redesign/wp/<WP>.md`;
- branch names: `wp/r-<id>-<slug>`;
- the index: `docs/redesign/STATUS.md`, which only the coordinator edits.

The prompt is Phase 4's §10.1 with "Phase 4" replaced by "the redesign" and this file as the spec.

## 6a. Mapping agent files and skills to stages (owner decisions, 2026-10-16)

**How Claude knows the flow.** It doesn't, and it doesn't need a README. The engine runs the
workflow: it starts each stage's agent at the right moment, with a brief for that stage only (see
`ticketPlannerPrompt` and `ticketOrchestratorPrompt` in `packages/orchestrator/src/plan.ts`, and
`TESTER_TASK` in `stages.ts`) and only that role's tools. Project knowledge comes from the context
files chosen in Settings, for example `CLAUDE.md`.

**Decisions:**

1. **A stage _uses_ one agent file (option A).** The agent stages are Plan, Orchestrate, Helpers,
   Final code review and Unit tests. Each can name one project agent file,
   `.claude/agents/<name>.md`. When that stage's agent starts:
   - **Instructions:** the file's body is appended to the agent's system prompt, after the
     project context files and before the stage brief. It is the owner's own file, read from the
     project checkout under ADR-0018's path rules (never an agent worktree), and capped at 64 KiB.
   - **Model:** the file's `model` is the stage's default. An explicit stage model still wins.
   - **Tools:** the file's `tools` list can only **narrow** the role's tools, never widen them. A
     reviewer or planner stays read-only even if the file lists `Bash` or `Edit`. "All tools"
     (`tools` absent) means the role's normal set.
   - **Other front-matter keys** (`permissionMode`, `hooks`, `mcpServers`, …) are ignored, exactly as
     on the Skills & Agents page.
   - **A missing or unsafe file** is shown as a problem on the Workflow page. The stage starts without
     it, and the run is not blocked.
2. **Skills stay on the stage.** A stage lists its skills whatever agent file it uses, so the graph
   has one place to look. Stage nodes show both chips, e.g. "Unit tests: 🤖 test-writer + ✦
   unit-tests".
3. **Verification:** one consented real run in R-V covers skills loading through the plugin, agent
   files applied per stage, and the read-only roles' tool limits.

**Option B** (agent files offered to stage agents as subagents that Claude delegates to by
description) stays possible later. It is less predictable, so it is not planned now.

**Work (WP R-I, after R-H):**

| Part                   | Owner        | What                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract (coordinator) | core         | Agent stages in `ProjectWorkflow` gain `agent: SkillNameSchema.nullable()`. `ManagedAgentSpec` gains `profile?: { name; instructions; tools: string[] \| null }`. ADR-0019 and the ADR-0018 amendment are updated. **Done (21cf2ab):** `agent` is optional and nullable, so stored rows parse.                                                                                                             |
| Engine                 | orchestrator | Put the stage's agent-file name on the `start-agent` effect; keep model precedence (stage > file > project).                                                                                                                                                                                                                                                                                               |
| Server                 | server       | Read and parse the agent file with R-D's module, then build `profile`.                                                                                                                                                                                                                                                                                                                                     |
| Adapter                | adapter      | Append `profile.instructions` to the system prompt. Narrow built-in tools with the SDK `tools` base set (the file's list, kept only where the role allows it, plus `Skill` with a skills plugin) and the gate. Keep a read-only role's `disallowedTools` and the role's `mcp__acp__*` tools. Never use `allowedTools`, which auto-approves. Research done: docs/research/sdk-tool-narrowing-2026-10-16.md. |
| Web                    | workflow     | An "Agent file" picker in the stage panel, the agent chip on graph nodes, and a missing-file warning.                                                                                                                                                                                                                                                                                                      |
| Tests                  | all          | Fake-adapter tests: the profile is applied; tools are narrowed and never widened; a missing file still starts the agent; model precedence.                                                                                                                                                                                                                                                                 |

## 6b. The lead's chat after the lead ends (owner decisions, 2026-10-16)

**Today:**

- Each run has its own lead agent. A ticket can have several runs.
- The engine stops the lead when the final code review or unit-tests stage starts, when the run
  completes, on Stop all, budget or timeout. An app restart also ends it.
- The chat box closes then. The conversation is still saved by Claude Code (`persistSession`
  default), and the app links it to the agent.

**Decisions (ADR-0020):**

1. **Resume on message.** A chat box stays on runs whose lead ended. Each owner message restarts the
   lead from its saved conversation (SDK `resume`) for one turn. Nothing idles between messages, and
   it works after a restart.
2. **Answers only.**
   - The resumed lead reads and answers, with the read-only toolset and no tools that start work.
   - New code work is a new run with a new plan the owner approves.

**Work (WP R-J, after R-I):**

| Part                   | Owner        | What                                                                                                                                                                                                                            |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research               | coordinator  | SDK `resume` (same session id or a fork, `forkSession`, how usage lines are linked) and what fails when the saved session is gone.                                                                                              |
| Contract (coordinator) | core         | `ManagedAgentSpec` gains `resumeSessionId?` and a follow-up flag. Chat DTOs say whether a run's chat can be continued and why not.                                                                                              |
| Engine                 | orchestrator | A follow-up command accepted on ended runs, only when no lead is live. It starts a follow-up lead agent with read-only role tools and no control tools, and never changes the run's status. It refuses while a turn is running. |
| Server                 | server       | The existing chat route starts a follow-up turn when the lead has ended. It looks up the lead's linked session id. It sets a budget from the project's limits. "Can't be continued" reasons. A restart never starts one.        |
| Adapter                | adapter      | Pass `resume`. The read-only toolset for a follow-up lead. Close input after the turn.                                                                                                                                          |
| Web                    | ticket       | The chat box on ended runs with a short line ("The lead finished. Your message brings it back to answer; new work needs a new run."). A "can't be continued" note. Bubbles for follow-up turns.                                 |
| Tests                  | all          | Fake-adapter tests: resume id passed; read-only and no control tools; status unchanged; refused while a turn runs; no relaunch on restart; missing session id refused.                                                          |

## 7a. Later: editable workflows

The owner wants users eventually to edit the flow: add their own agents and stages, and connect them
as they choose. That is a later phase. The fixed stages ship first (ADR-0019). The Workflow page's
graph is built from data (`WORKFLOW_STAGES` plus the project's workflow), so a later editable graph
can reuse the same view, as long as the engine can enforce the plan-first, owner-gated and
worktree-isolated rules for any graph. That needs its own ADR.

## 8. Risks and open points

- **The engine change is the big piece.** The planner/lead split and two extra stages touch the state
  machine. Mitigation: today's single-lead flow stays the default until R-C's tests cover each new
  path.
- **Skill file writes reach the owner's working tree**, the first app write outside agent worktrees.
  Mitigation: a strict path rule, an owner click per write, and a visible "uncommitted" state
  (ADR-0018).
- **"Unit tests" stage vs harness checks:** the tester _writes_ tests, while the harness _runs_
  checks. The UI must make that difference obvious.
- **Ticket page density:** the live graph plus the agent tree must stay readable with 4 helpers ×
  depth 2. Screenshots gate R-H.
