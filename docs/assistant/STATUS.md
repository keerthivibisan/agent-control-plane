# Project assistant (AS series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                          | Status      | Branch                                | Merged |
| ---- | ------------------------------ | ----------- | ------------------------------------- | ------ |
| AS-0 | ADR-0035, plan                 | done        | `feature/assistant/project-assistant` |        |
| AS-1 | Role, tools, service, API      | done        | `feature/assistant/project-assistant` |        |
| AS-2 | Web: floating panel            | not started |                                       |        |
| AS-3 | Safety tests, docs, real check | not started |                                       |        |

## Log

- 2026-11-09 Planned on the owner's request: a floating project assistant; session-only chat;
  Approve or Auto writes; project pages only; Claude `sonnet` by default, Codex selectable; effort
  low/medium/high. Branch from `feature/codemap/code-map` (`81047ba`). AS-0 done.
- 2026-11-09 AS-1 done: `assistant` role (read-only, never a run agent: RunAgentKind), tools
  ticket_status, project_info, code_map, propose_skill, propose_agent; in-memory sessions (one per
  project, start on first message, 300k budget, 30 min idle), proposals in Approve or Auto mode
  through the ADR-0018 writer, REST and SSE (reconnect replay from memory, cleared at session end).
