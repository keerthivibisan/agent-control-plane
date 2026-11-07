# Codex as a second managed provider (CX series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decisions:
[ADR-0031](../decisions/0031-codex-provider.md) (accepted),
[ADR-0032](../decisions/0032-codex-usage-accounting.md) (proposed),
[ADR-0033](../decisions/0033-lead-agent-messaging.md) (accepted). Branch: `feat/codex-integration`
from `dev`.

## Goal

Each agent block of a workflow graph (lead, planner, helper, reviewer, tester) can run on Claude or
on Codex, and one ticket run can mix both (owner, 2026-11-04 and 2026-11-07). Codex is built the
same way as Claude: a managed adapter behind the provider-neutral `ManagedExecutionAdapter`, with
the same approval modes, ACP tools, skills, follow-ups, usage and UI. Codex uses the owner's own
Codex login (ChatGPT) now; an API-key option comes later. The lead/agent messaging fixes from the
2026-11-03 review ship in the same series because both providers need them.

## How Codex is driven

The adapter spawns `codex app-server` (stdio JSON-RPC, CLI 0.166.0 at the time of writing; see the
[research note](../research/codex-app-server-2026-11-07.md)) as an argument array with a filtered
environment. `thread/start` carries the model, the working directory, the approval policy, the
sandbox, ACP's instructions and the lead tools (as dynamic tools); `turn/start` and `turn/steer`
deliver messages; approval requests become ACP permission requests. User-level Codex configuration
is overridden so a managed run sees only what ACP gives it.

| Agent                                  | Codex sandbox     | Codex approval policy |
| -------------------------------------- | ----------------- | --------------------- |
| lead, planner, reviewer, any follow-up | `read-only`       | `never`               |
| worker or tester, `manual` (or absent) | `read-only`       | `on-request`          |
| worker or tester, `auto-edits`         | `workspace-write` | `untrusted`           |
| worker or tester, `auto`               | `workspace-write` | `on-request`          |
| worker or tester, `full-auto`          | `workspace-write` | `never`               |

Confirmed by the CX-1 spike and implemented in CX-3 (`packages/adapters/codex/src/modes.ts`).
Every `workspace-write` turn passes an explicit `sandboxPolicy`: writable roots are the worktree
and the run's temp folder only, no network, `/tmp` and `$TMPDIR` excluded (CX-1 result 8). A
writing agent whose repository's git directories lie in a writable temp folder is refused
(`unsafe-git-location`).

## Work packages

| WP   | What                                                                                                                                            | Owned paths                                                                                                             | After |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----- |
| CX-0 | ADR-0031 accepted and amended, ADR-0032 and -0033, AGENTS.md §1 and §3.8, this plan, the research note                                          | `docs/decisions/**`, `AGENTS.md`, `docs/codex/**`, `docs/research/**`                                                   | —     |
| CX-1 | Spike against a real `codex app-server` in a disposable repo (owner consent): usage, dynamic tools, approvals, git protection, overrides, steer | scratchpad only; findings in the research note                                                                          | CX-0  |
| CX-2 | Contracts and DB: provider on the managed adapter, capabilities, `provider` on agent nodes and engine effects, ledger key, migration 0013       | `packages/core/src/{adapters,workspace,api}/**`, `packages/orchestrator/src/{state,budget,stages}.ts`, `packages/db/**` | CX-1  |
| CX-3 | `@acp/adapter-codex`: transport, adapter, events, approvals, lead tools, modes; tests against a fake app-server                                 | `packages/adapters/codex/**`                                                                                            | CX-2  |
| CX-4 | Server: adapter registry, routing by node provider, follow-ups, usage persistence, availability, Full auto deny list                            | `packages/server/**`                                                                                                    | CX-3  |
| CX-5 | Messaging (ADR-0033): delivery state, held messages, `ask_lead`, finish notice, findings on demand, bounded merge                               | `packages/orchestrator/**`, `packages/server/src/control/**`, both adapters' lead tools                                 | CX-2  |
| CX-6 | Web: provider picker per node, model suggestions, provider badges, Tokens by provider                                                           | `packages/web/**`                                                                                                       | CX-4  |
| CX-7 | Safety and docs: adversarial refusal tests on the Codex path; security, provider-adapters, usage-accounting, architecture                       | `docs/**`, test files                                                                                                   | all   |

## Verification

- `pnpm check` green at every checkpoint; unit tests for every mapping and messaging rule.
- Adversarial: a Codex worker tries `git commit`, `git checkout -b`, `git push` and a write outside
  its worktree; each is refused.
- Real runs only with the owner's consent, on a throwaway project: a Codex reviewer with a Claude
  helper, then a Codex lead with a Claude helper.
