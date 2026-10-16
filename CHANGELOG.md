# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semantic versioning;
before 1.0, minor versions may break things.

## [0.0.1] — 2026-10-16

First release, private preview.

### Added

**Session observability (Phase 1)**

- Claude Code session discovery and incremental transcript reading (byte offsets that survive a
  restart).
- Usage accounting:
  - dedup by `(provider, messageId)`;
  - the observation with max output is selected;
  - usage is attributed to the earliest occurrence;
  - cumulative snapshots are never summed;
  - missing usage is `null`, never 0.
- Subagent and fork relationships from evidence only. An unknown parent stays unknown.
- Evidence-based session status (active, idle, ended, stale).
- An optional hook receiver.
- REST API with live updates (SSE). Events are persisted before they are published.
- Demo mode with a separate database.

**Managed orchestration and the agent workspace (Phases 3 and 4)**

- Managed Claude Code agents through the Agent SDK:
  - a lead and up to 3 helpers, each in its own git worktree;
  - owner approval for edits and commands;
  - per-agent token budgets, Stop and Stop all;
  - restarts never relaunch work.
- Projects, a ticket board, and plan-first runs: a plan, then your approval or a request for
  changes.
- Harness checks: required checks must pass before a merge, and you merge each change.

**Project workspace redesign**

- A project-first UI: Board, Workflow, Skills & Agents, Harness, Tokens, Sessions and Settings.
- Workflow stages:
  - plan, orchestrate, helpers, review and merge;
  - an optional read-only final code review and a unit-tests stage;
  - each stage with its own model, skill and agent file;
  - a live workflow graph on the ticket page.
- Project skills (`.claude/skills/<name>/SKILL.md`) and agent files (`.claude/agents/<name>.md`)
  edited in the UI and committed on your action (ADR-0018). Skills reach managed agents through a
  run-scoped plugin, and agent files add instructions and can only narrow tools (ADR-0019 §6).
- A fixed tool set per role (ADR-0019 §7). The lead, planner and reviewer are read-only.
- After a run ends, a message resumes its lead for one answers-only turn (ADR-0020).
- Tokens per project: new work vs cache reuse, per day, session, ticket, role and model.

### Security

- Local only: the server binds 127.0.0.1, mutating routes need a CSRF token, and there is no
  telemetry.
- Managed agents run with `settingSources: []`, `permissionMode: 'default'` and strict MCP config.
  `allowedTools` is never used.
- No conversation content is stored except the owner's chat with the lead (ADR-0009, ADR-0015).
  Logs are redacted.

### Verified

- About 2,100 unit and integration tests and 49 browser end-to-end tests.
- Real runs against Claude Code:
  - P3-F (2026-10-13);
  - R-V and the R-K re-check (2026-10-16), aggregate-only:
    [docs/research/r-v-real-run-2026-10-16.md](docs/research/r-v-real-run-2026-10-16.md).

[0.0.1]: https://github.com/keerthivibisan/agent-control-plane/releases/tag/v0.0.1
