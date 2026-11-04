# ADR-0031: Codex as a second provider, with the provider chosen per workflow stage

- **Status:** proposed (implementation waits for the maintainer to accept it)
- **Date:** 2026-11-04
- **Deciders:** project owner (request 2026-11-04, "add codex support too, the agents can be from
  both claude and codex"); implementing agent (draft)
- **Amends:** ADR-0012 and ADR-0013 (the managed process is not only the SDK-spawned `claude`),
  AGENTS.md §1 (Codex is brought forward from Phase 6 by the owner's request) and §3 rule 8
  (allowed processes)
- **Relates to:** ADR-0004 (adapter abstraction), ADR-0021/0022 (approval modes), ADR-0025
  (ticket-branch guard), [docs/knowledge-transfer/FUTURE.md](../knowledge-transfer/FUTURE.md)

## Context

ACP supports one provider. `ProviderIdSchema` already lists `codex`, and the database `provider`
columns carry no CHECK, so Codex sessions can be stored today. Everything else assumes Claude:

- `ManagedExecutionAdapter.provider` is the literal `'claude-code'`
  (`packages/core/src/adapters/managed.ts`), and the server composes exactly one managed adapter
  (`packages/server/src/bootstrap.ts`, `control/service.ts`).
- A workflow stage has a free-text `model` and no provider (`packages/core/src/workspace/workflow.ts`).
- ADR-0012 confines the Agent SDK to `@acp/adapter-claude-code/src/managed/**`. ADR-0013 and
  AGENTS.md §3 rule 8 name the SDK-spawned `claude` as the only agent process.
- Part of the safety design is Claude-only: the `PreToolUse` branch-guard hook, SDK `permissionMode`
  for the approval modes, and `settingSources: []`.

The owner wants one ticket run to mix agents from both providers, and Codex sessions to appear in
the observability views. FUTURE.md already sets the bar: ACP owns task identity, workflow,
authorization, evidence and delivery; adapters own provider transport; and a Claude session id is
never resumed as a Codex thread.

## Decision

1. **A provider is a property of a stage, not of the run.** Workflow stages and agent definitions
   gain an optional `provider` (`claude-code` | `codex`), defaulting to `claude-code`, so existing
   graphs and runs behave exactly as before. `model` stays a free string interpreted by that
   provider. Validation rejects a provider the server has no adapter for.
2. **Adapter per provider, registry in the composition root.** `packages/adapters/codex`
   (`@acp/adapter-codex`) depends only on `@acp/core`. It implements `ObservationAdapter` and
   `ManagedExecutionAdapter`. The server replaces its single managed adapter with a
   provider-keyed registry and routes each agent start and follow-up by the stage's provider.
   `ManagedExecutionAdapter.provider` widens from `'claude-code'` to `ProviderId`. Claude-only
   spec fields (`skillPlugin`, `profile`) are optional and ignored by adapters that do not support
   them; the adapter declares what it supports in its capabilities.
3. **Transport: the Codex app-server.** Managed runs speak to Codex through its app-server
   interface (the interface named in roadmap Phase 6), spawned by the adapter as an argument array
   with a filtered environment (no `ACP_*`), the same rules as ADR-0012. No shell, no text reaches
   a shell. The transport is injectable so tests use a fake app-server and never the real `codex`.
   The exact protocol, version and event shapes are recorded in `docs/research/` before the
   adapter is written; this ADR does not guess them.
4. **Allowed processes** (AGENTS.md §3 rule 8, ADR-0013) become `git`, the SDK-spawned `claude`,
   the app-server-spawned `codex`, `gh` and the project's own harness steps, all as argument
   arrays. No new network exception in ACP itself: the `codex` process talks to its provider as
   Claude does under ADR-0012.
5. **Safety rules are provider-neutral and stay on** (AGENTS.md §3 rule 11). Agents may not create,
   switch, commit to, reset or push a branch; only the lead merges into a ticket branch; only the
   owner's click merges a ticket branch or publishes. Codex has no `PreToolUse` hook, so for Codex
   the layers are the approval gate (every non-read action goes through `requestPermission`), a
   per-worker worktree and sandbox, and the app-layer ticket-branch guard (which is independent of
   the provider). If a Codex stage cannot be held to this, it is refused rather than run with weaker
   guarantees. Every guardrail gets a refusal test on the Codex path
   ([docs/testing/adversarial.md](../testing/adversarial.md)).
6. **Approval modes map explicitly.** `manual`, `auto-edits`, `auto` and `full-auto` map to Codex's
   approval policy and sandbox setting. The mapping is documented and tested. Full auto requires a
   working sandbox; if it cannot start the agent fails instead of running unprotected (as in
   ADR-0022).
7. **Resume is per provider.** A follow-up or rework run resumes only a thread of the same
   provider. A stage that changes provider starts a fresh thread with ACP-supplied context. A Claude
   session id is never passed to Codex or the reverse.
8. **Observation.** The Codex adapter reads only an allowlisted data root (deny-by-default, realpath
   and symlink checks, a size cap), with its own allowlist section in
   [docs/provider-adapters.md](../provider-adapters.md). Dedup stays `(provider, messageId)`
   (usage-accounting). Missing usage is `null`, never 0; provider-reported cost is `estimated`;
   no conversation content is stored (ADR-0009).
9. **Lead tools.** The lead's ACP tools reach Codex only if the app-server can expose them (for
   example as an MCP server). If it cannot, Codex is limited to non-lead roles until that is solved.
   The research note decides this before implementation.

## Alternatives considered

- **`codex exec --json` or the Codex SDK.** Simpler, but weaker for interactive approvals,
  interrupt and resume, which the approval-gate safety model depends on.
- **Provider encoded in the model string** (`codex:gpt-5-codex`). No schema change, but implicit,
  hard to validate, and easy to get wrong in the editor.
- **One provider per run.** Simpler wiring, but does not meet the request that agents in one run
  can come from both.
- **Observation only first.** Lowest risk, but does not deliver mixed-provider agents.

## Consequences

- Easier: adding a third provider later (registry plus an adapter package); showing a provider on
  every stage and agent in the UI.
- Harder: the safety story now has a provider-specific part, so the adversarial suite and
  `docs/security.md` must cover both. Reviewers must check Codex on each safety rule, not assume.
- Contract changes (shared files, proposed in their own commit for maintainer review): widening
  `ManagedExecutionAdapter.provider`, the optional `provider` in workflow and agent schemas and API
  DTOs, and an ESLint boundary entry for the new package.
- To revisit: the approval-mode mapping once the research note is written, and whether lead tools
  can be offered to Codex.
