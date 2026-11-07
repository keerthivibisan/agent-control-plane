# Codex as a second managed provider (CX series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                           | Status      | Branch                   | Merged |
| ---- | ------------------------------- | ----------- | ------------------------ | ------ |
| CX-0 | ADRs, AGENTS.md, plan, research | done        | `feat/codex-integration` |        |
| CX-1 | Spike against a real app-server | done        | `feat/codex-integration` |        |
| CX-2 | Contracts and DB                | done        | `feat/codex-integration` |        |
| CX-3 | `@acp/adapter-codex`            | done        | `feat/codex-integration` |        |
| CX-4 | Server                          | not started |                          |        |
| CX-5 | Messaging (ADR-0033)            | not started |                          |        |
| CX-6 | Web                             | not started |                          |        |
| CX-7 | Safety and docs                 | not started |                          |        |

## Log

- 2026-11-07 Planned on the owner's go-ahead ("proceed with the changes, checkout a latest branch
  from dev"). Branch `feat/codex-integration` from `origin/dev` (`ebc3f27`), with the teammate's
  ADR-0031 proposal from `feat/codex-provider` as its first commit. CX-0 done.
- 2026-11-07 CX-1 done (owner consent, gpt-6.1-sol, six short prompts). Usage is per request with a
  cumulative total; dynamic tools, steer, manual-mode command approval and AGENTS.md isolation work;
  git writes are blocked from a linked worktree except when the repo is under /tmp or $TMPDIR.
  ADR-0032 accepted with the per-request amendment.
- 2026-11-07 CX-2 done: provider on the managed contract, nodes, project setup, engine agents and
  effects; ledger keyed by (provider, messageId); migration 0013 `agent_runs.provider`. Until CX-4,
  an agent whose provider has no adapter ends with `provider-unavailable` instead of running on Claude.
- 2026-11-07 CX-3 done: `@acp/adapter-codex` (app-server transport, modes, git-location refusal,
  approvals through the server gate with the git guard first, dynamic lead tools, per-request usage),
  tested against a fake app-server. Known gaps: no project skills or agent-file tool narrowing; the
  sandbox cannot deny reads, so Full auto denyRead is not enforceable (CX-4 refuses Full auto on Codex).
