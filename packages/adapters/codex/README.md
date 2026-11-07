# @acp/adapter-codex

Managed Codex agents for Agent Control Plane ([ADR-0031](../../../docs/decisions/0031-codex-provider.md),
plan in [docs/codex/](../../../docs/codex/README.md)). `createManagedCodex()` returns a
`ManagedExecutionAdapter` with provider `codex`. Each agent runs on its own `codex app-server`
process (stdio JSON-RPC, checked against Codex CLI 0.166.0; protocol and spike results in
[the research note](../../../docs/research/codex-app-server-2026-11-07.md)).

Observation of Codex session files is deferred by owner decision (ADR-0031, owner decision 1).

## How a run is driven

- **Process:** `codex app-server` as an argument array, no shell, with user configuration
  neutralised (`codexArgs()`: hooks, plugins, apps, native subagents, memories, browser and computer
  use off; no project `AGENTS.md`, MCP servers or web search) and a filtered environment
  (`codexEnv()`: no `ACP_*`, no `GIT_*`). Stderr is counted, never logged.
- **Permission profile:** each agent's process gets one Codex permission profile from
  `codexModes()` as `-c` overrides (`codexArgs(profile)`: `extends`, the `filesystem` table with
  TOML-quoted paths, `default_permissions`). A path with a control character ends the agent with
  `sandbox-unavailable` before any process starts.
- **Thread:** `thread/start` (or `thread/resume` for a follow-up or rework) with the model, the
  folder, the profile (`permissions`, never a legacy `sandbox`) and approval policy, ACP's instructions
  (`developerInstructions`: role, project context, agent file text, read-only folders) and the
  role's control-plane tools as dynamic tools.
- **Messages:** `turn/start`; during a turn, `turn/steer` (falling back to `turn/start` when the
  turn just ended). `interrupt()` is `turn/interrupt`; `abort()` ends stdin and kills the process.
- **Approvals:** command and file-change requests go to the server's gate as `Bash` (with the inner
  command) and `Edit`. A git command that would move a ref is declined first, without asking
  (F-1). Every other request kind is refused.
- **Usage:** one `usage` event per `thread/tokenUsage/updated`, from `last`, keyed by
  `<threadId>:<turnId>:<total.totalTokens>` (ADR-0032, amended). Missing fields are `null`.
- **Profile check:** the thread's `activePermissionProfile` must be the agent's profile; otherwise
  the agent ends with `sandbox-unavailable` and no turn starts (ADR-0022 fail closed).
- **Git location:** a writing agent whose repository's git directories lie in a temp folder (or
  the run's temp folder) ends with `unsafe-git-location` before any process starts.

## Approval modes

| Agent                                  | Profile extends | Approval policy |
| -------------------------------------- | --------------- | --------------- |
| lead, planner, reviewer, any follow-up | `:read-only`    | `never`         |
| worker or tester, `manual` (or absent) | `:read-only`    | `on-request`    |
| worker or tester, `auto-edits`         | `:workspace`    | `untrusted`     |
| worker or tester, `auto`               | `:workspace`    | `on-request`    |
| worker or tester, Full auto            | `:workspace`    | `never`         |

Filesystem entries (`profileFilesystem()`), in order: `deny` for `spec.denyRead`,
`fullAuto`/`sandbox.denyRead` and `/tmp` (`:slash_tmp`), plus `:tmpdir` (or, when the run temp
folder is the agent's `TMPDIR`, the host's temp folders by path); `read` for the git directories
(F-1), the read-only folders and the agent's folder (`write` for a `:workspace` profile, its `.git`
kept `read`); `write` for the run's temp folder. More specific entries win, and on the same exact
path the deny stays. Capabilities: `fullAuto: true`, `denyRead: true`.

## Tests

All against the synthetic in-memory app-server (`tests/helpers/fake-app-server.ts`); the real
`codex` never runs. `tests/adversarial.test.ts` holds the Codex cases C1 to C6 of the adversarial
suite ([docs/testing/adversarial.md](../../../docs/testing/adversarial.md)): hostile git commands in
every mode, the git-location refusal, TOML injection in profile paths, an unconfirmed profile,
reading roles that never ask, and lead-only tools.

## Known gaps

- **Skills** (`spec.skillPlugin`) are ignored: capability `skills: false`. The server strips them
  for Codex and puts a line on the ticket (CX-4).
- **Agent file tools** (`spec.profile.tools`) are not applied: capability `profileTools: false`.
  The file's instructions are passed. The server refuses a Codex block whose agent file narrows
  tools, at save and at launch (CX-4).
- **`fileChange` approvals carry no path**, so the owner sees "Edit files" and Codex's reason only.
- **Codex reports no cost**: `finished.reportedCostUsd` is always `null`.
- **Commands inside the sandbox are not screened.** Only escalations reach the git guard; a git
  write that Codex runs without asking is stopped by the profile (`.git` read-only).
- **Reads are confined by a deny list only.** The server's deny list is denied to every role; other
  folders outside the agent's own stay readable, so the lead's "ask before reading outside the
  folder" rule is not enforced.
- **Not verified against a real server (CX-3b):** that a more specific `read`/`write` entry beats a
  broader `deny` (the worktree and temp folder inside the app's data folder), that an explicit
  `write` on the worktree keeps its `.git` read-only, and `permissions` on `thread/resume`.
- **A refused git command gets no reason.** A Codex `decline` carries no message, so the rule is
  stated in the instructions instead.
- **Not verified against a real server:** `turn/interrupt` timing, dynamic tools after
  `thread/resume` (a rework turn's `report_work`), and `fileChange` approvals in manual mode.
