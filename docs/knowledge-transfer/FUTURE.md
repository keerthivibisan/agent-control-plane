# 06 · Other agents, models and long-term architecture

## Provider is not model

A provider integration defines how ACP starts a process/session, exposes tools, enforces
permissions, cancels work and understands usage. A model is a selection within a supported
integration. Changing a model string does not install another coding agent or make it safe to run.
Current model resolution is node setting, then agent profile, then project setting, then provider
default; effort is separately passed from the workflow block. Availability and effort behavior
must be checked against the actual provider/model version, not a marketing name.

| Integration       | Current position                                                  | What must be established                                                                           |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Claude Code       | Current managed implementation through Claude Agent SDK           | Preserve current isolation, role tools, safety and accounting                                      |
| Codex             | Phase 6 planned; roadmap names its supported app-server interface | Validate actual transport/version, lifecycle, permission and usage contracts before implementation |
| Additional models | Possible within a supported provider's validated settings         | Capability/availability checks, quality evaluation and effort support                              |

## Keep orchestration provider-neutral

ACP owns logical task identity, workflow program, authorization, context selection, evidence,
retry policy and delivery. Adapters own provider-specific transport. Repository knowledge should
be reusable as source references and task facts, not translated private conversation histories.
Do not try to resume a Claude session identifier as a Codex thread.

A future adapter must establish these capabilities with tests:

1. Start, stream, cancel, interrupt and terminal-error semantics; late events and idempotency.
2. Exact role-tool enforcement, own-worktree edits, server-owned Git and approval bridge behavior.
3. Resume support, compatible task/workspace/model/policy assumptions and safe unavailable-session
   behavior. “Resume supported” is not a promise that every old session remains available.
4. Instruction/context/tool/attachment placement, context limits, optional compaction and observable
   caching. API documentation does not prove a CLI or app-server exposes the same controls.
5. Stable usage identity and per-call versus cumulative reports. Determine whether input includes
   cached input and whether output includes reasoning before mapping the categories.
6. Provenance, missing fields as unavailable, global dedup rules and result coverage. No casts,
   duplicate types or fabricated zeros to fit an adapter into the existing contracts.

## Suggested rollout, not a committed release schedule

First keep the current provider stable and establish quality-aware token baselines. Next scope
bounded context/outcome improvements and evidence freshness. At Phase 6, build provider conformance
fixtures, capability negotiation and owner-visible unsupported cases before real runs. Compare
providers on acceptance quality, latency and reported usage with availability coverage; model
routing experiments come after that evidence.

Do not build future phases in this documentation change. Harness Lab, pricing/OTel and automated
recommendations retain their existing roadmap scope. ACP still needs ADR/contract coordination for
new interfaces, retention behavior and aggregate admission policy.

Sources: `docs/roadmap.md`; `packages/core/src/adapters/managed.ts`;
`packages/server/src/control/service.ts` (`launch`, `resolveAgentModel`);
`packages/adapters/claude-code/src/managed/adapter.ts`; ADR-0013, ADR-0014, ADR-0028.
