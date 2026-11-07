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
- **Thread:** `thread/start` (or `thread/resume` for a follow-up or rework) with the model, the
  folder, the sandbox and approval policy from `codexModes()`, ACP's instructions
  (`developerInstructions`: role, project context, agent file text, read-only folders) and the
  role's control-plane tools as dynamic tools.
- **Messages:** `turn/start`; during a turn, `turn/steer` (falling back to `turn/start` when the
  turn just ended). `interrupt()` is `turn/interrupt`; `abort()` ends stdin and kills the process.
- **Approvals:** command and file-change requests go to the server's gate as `Bash` (with the inner
  command) and `Edit`. A git command that would move a ref is declined first, without asking
  (F-1). Every other request kind is refused.
- **Usage:** one `usage` event per `thread/tokenUsage/updated`, from `last`, keyed by
  `<threadId>:<turnId>:<total.totalTokens>` (ADR-0032, amended). Missing fields are `null`.
- **Git location:** a writing agent whose repository's git directories lie in a writable temp
  folder (or the run's temp folder) ends with `unsafe-git-location` before any process starts.

## Approval modes

| Agent                                  | Sandbox           | Approval policy |
| -------------------------------------- | ----------------- | --------------- |
| lead, planner, reviewer, any follow-up | `read-only`       | `never`         |
| worker or tester, `manual` (or absent) | `read-only`       | `on-request`    |
| worker or tester, `auto-edits`         | `workspace-write` | `untrusted`     |
| worker or tester, `auto`               | `workspace-write` | `on-request`    |
| worker or tester, Full auto            | `workspace-write` | `never`         |

Every `workspace-write` turn passes an explicit policy: writable roots are the worktree and the
run's temp folder only, without network, with `/tmp` and `$TMPDIR` excluded.

## Known gaps

- **Skills** (`spec.skillPlugin`) are ignored: capability `skills: false`. The server must refuse or
  strip them for Codex (CX-4).
- **Agent file tools** (`spec.profile.tools`) are not applied: capability `profileTools: false`.
  The file's instructions are passed.
- **Reads are not confined.** Codex's sandbox lets every role read the whole disk. Full auto's
  `denyRead` list and the lead's "ask before reading outside the folder" rule are not enforced.
- **A refused git command gets no reason.** A Codex `decline` carries no message, so the rule is
  stated in the instructions instead.
- **Not verified against a real server:** `turn/interrupt` timing, dynamic tools after
  `thread/resume` (a rework turn's `report_work`), and `fileChange` approvals in manual mode.
