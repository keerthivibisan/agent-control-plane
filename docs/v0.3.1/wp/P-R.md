# P-R

> Progress file for P-R. Only its agent edits it. Plan: [../README.md](../README.md). Request
> (2026-10-26): bring every remaining README and design doc up to date before the repository goes
> public: the seven package READMEs, the specs (P-D's run-timeout and rework rules, P-C's linking),
> and the old plan paths outside `docs/history/`. Docs and code comments only.

| Field  | Value                                                     |
| ------ | --------------------------------------------------------- |
| Status | review                                                    |
| Branch | `wp/p-r-docs-refresh` (from `release/0.3.1` at `87d7194`) |

## Done

1. **Package READMEs** (`537ba9a`): `core`, `db`, `orchestrator`, `server`, `web`,
   `adapters/claude-code` and `adapters/demo`, 67–120 lines each, for contributors: what the
   package does today, its public API and entry points, how to test it, its dependency rules, and
   the specs and ADRs behind it. Every name was checked against the code. Corrections on the way:
   the server's allowlist is active; the web README describes today's UI, not the Phase 1 Command
   Center; "no Node or DOM APIs" in core is enforced by `tsconfig` `types: []`, not ESLint;
   `routes → services → repositories` is a convention, not a lint rule; the db README lists
   migrations 0001–0011.
2. **Specs** (`88380fa`):
   - `docs/architecture.md` §8 and `docs/orchestration-lifecycle.md` §0.1: the run timeout counts
     working time only (a wait only for the owner is not counted; the timeout ends a helper waiting
     for review as CANCELLED) and the rework new-session fallback; architecture §9: one paragraph
     on the Workflow editor's linking.
   - `docs/orchestration-lifecycle.md` §0.1 also had 0.3.0-and-earlier statements: the ticket
     branch name (ADR-0025), the owner's merge (local merge or pull request), which checks gate
     (ADR-0028), approval modes per block (ADR-0023), and ADR-0029 noted as proposed only.
   - `docs/domain-model.md`: the managed-run and workspace entities that exist; the planned
     `agentRunId` columns on events and usage records marked as never added (linked through
     AgentRunSession instead).
   - `docs/security.md`: the processes the server starts today, the data directory, today's limits
     and gates; purge and `ACP_ALLOW_REMOTE` marked **[planned]**.
   - `docs/usage-accounting.md`: status line and the scenario table's test column (packages, not
     WPs). No rule changed.
   - `docs/provider-adapters.md`: status, the managed contract, role MCP tool sets, the
     always-preset system prompt, the dropped `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY`, the S-V title
     result.
   - `packages/web/DESIGN.md`: WP ids and old plan paths dropped; "Adding a project page" fixed.
   - `docs/development.md` was already current (P-O); unchanged.
3. **Old plan paths in code comments** (`8f4be91`): 63 files under `packages/**`, comments only,
   proven by parsing each file before and after and printing both without comments (63/63
   identical).

## Left on purpose

- `packages/db/src/migrations/0003…0011` (8 files): applied migrations are never edited;
  [docs/history/README.md](../../history/README.md) maps their old paths.
- `packages/web/tests/features/project-setup.test.tsx:301`: the path is in a `describe` name.
- `docs/v0.3.1/wp/P-O.md`: its tables record the move itself.
- `CHANGELOG.md`, `docs/decisions/**` and `docs/research/**`: historical records; the ADRs already
  cite removed logs as "at tag `v0.3.0`". Only the plan path in
  `docs/research/sdk-tool-narrowing-2026-10-16.md` was pointed at `docs/history/`.
- Work-package ids that name evidence (for example "the R-V real run", "P1-F") stay in the specs,
  since the research notes are named after them.

## Follow-ups

- AGENTS.md §3.8 names `git`, `claude` and `gh` as the only processes; the server also runs the
  harness's check and setup commands (ADR-0017, ADR-0027, `shell: false`). A shared file: proposed,
  not changed.
- `@acp/adapter-claude-code` pins `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk`, which `src/`
  does not import directly. A dependency change: proposed, not changed.
- Code comments still cite WP ids (for example "served by P4-D"); they are provenance, readable
  through [docs/history/](../../history/README.md).

## Log

- 2026-10-26 Started from `release/0.3.1` (`87d7194`). Package READMEs, specs and the comment-path
  rewrite committed separately; format, links, lint, typecheck and the touched packages' tests
  pass. Status `review`.
