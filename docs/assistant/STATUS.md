# Project assistant (AS series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                          | Status      | Branch                                | Merged |
| ---- | ------------------------------ | ----------- | ------------------------------------- | ------ |
| AS-0 | ADR-0035, plan                 | done        | `feature/assistant/project-assistant` |        |
| AS-1 | Role, tools, service, API      | done        | `feature/assistant/project-assistant` |        |
| AS-2 | Web: floating panel            | done        | `feature/assistant/project-assistant` |        |
| AS-3 | Safety tests, docs, real check | in-progress | `feature/assistant/project-assistant` |        |

## Log

- 2026-11-09 Planned on the owner's request: a floating project assistant; session-only chat;
  Approve or Auto writes; project pages only; Claude `sonnet` by default, Codex selectable; effort
  low/medium/high. Branch from `feature/codemap/code-map` (`81047ba`). AS-0 done.
- 2026-11-09 AS-1 done: `assistant` role (read-only, never a run agent: RunAgentKind), tools
  ticket_status, project_info, code_map, propose_skill, propose_agent; in-memory sessions (one per
  project, start on first message, 300k budget, 30 min idle), proposals in Approve or Auto mode
  through the ADR-0018 writer, REST and SSE (reconnect replay from memory, cleared at session end).
- 2026-11-09 AS-2 done: floating button and panel on project pages (provider, model, effort, mode
  badge, budget meter, suggested prompts, chat, proposal cards with preview and Apply/Discard, bottom
  sheet on narrow screens). Pending proposals stay decidable after switching to Auto.
- 2026-11-09 AS-3 in progress: adversarial cases A1 to A7 (server
  `tests/assistant/adversarial.test.ts`, plus A6 in both adapters' tests), no bug found; docs in
  security.md, provider-adapters.md (§11.1, §12.4), testing/adversarial.md and the README's "How it
  works" and "Using it". The consented real check is still to do.
