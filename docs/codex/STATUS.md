# Codex as a second managed provider (CX series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                           | Status      | Branch                   | Merged |
| ---- | ------------------------------- | ----------- | ------------------------ | ------ |
| CX-0 | ADRs, AGENTS.md, plan, research | done        | `feat/codex-integration` |        |
| CX-1 | Spike against a real app-server | done        | `feat/codex-integration` |        |
| CX-2 | Contracts and DB                | done        | `feat/codex-integration` |        |
| CX-3 | `@acp/adapter-codex`            | done        | `feat/codex-integration` |        |
| CX-4 | Server                          | done        | `feat/codex-integration` |        |
| CX-5 | Messaging (ADR-0033)            | done        | `feat/codex-integration` |        |
| CX-6 | Web                             | done        | `feat/codex-integration` |        |
| CX-7 | Safety and docs                 | done        | `feat/codex-integration` |        |

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
- 2026-11-07 CX-4 done: provider-keyed adapter registry, routing without fallback, cached
  availability checks, approvalMode on specs, capability refusals (Full auto on Codex refused until
  CX-3b; agent-file tool narrowing refused; skills dropped with a note), graph checks, Codex usage
  persisted through the pipeline (managed channel), `.codex` in the Claude Full auto deny list,
  `managedProviders` in diagnostics. CX-3b added: permission profiles with deny-read (CX-1b).
- 2026-11-07 CX-3b done: Codex agents run under per-agent permission profiles (deny-read for the
  Full auto deny list, tmp denied, the agent folder and run temp dir re-opened); a profile Codex does
  not confirm fails closed. Full auto on Codex is allowed again. To verify in the real run: a more
  specific write/read entry re-opens a folder inside a denied one; permissions on resume.
- 2026-11-07 CX-5 done (ADR-0033): server mailbox with delivered/queued/held/dropped states reported
  to the caller, held messages for a blocked or ended lead (cap 50), `ask_lead` (5 open questions),
  finish notices from the engine, `get_review_findings`, a 10-minute merge timeout (owner merge: 409
  `merge_timeout`), metadata-only outbox in the run detail. Known small gaps: messages taken for a
  follow-up that then fails to start count as delivered; a dropped question still counts toward 5.
- 2026-11-07 CX-6 done: provider picker per node and project default, per-provider model
  suggestions, provider chips (editor, live graph, agent details), live Codex graph issues, Codex
  availability on Data health, the metadata-only Messages list. Not done: Tokens by provider needs
  `provider` on the tokens DTO rows (CX-6b); agent failure codes are not in the DTO (ticket lines show them).
- 2026-11-07 CX-6b done: Tokens by provider. CX-7 done: Codex adversarial cases C1-C10 (git guard
  in every mode and wrapper, unsafe git location, TOML injection, profile mismatch, read-only roles,
  lead-only tools, ask_lead flood, dropped message, no cross-provider resume, replay counted once);
  security, provider-adapters, usage-accounting, architecture, roadmap docs. Open: the consented real
  end-to-end run (profile re-open inside a denied folder, permissions on resume, mixed-provider run).
