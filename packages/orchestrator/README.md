# @acp/orchestrator

The pure run engine of managed runs. The model plans and this package decides (ADR-0013): it holds
the run and agent state machines, the policy and limits, budgets, approvals, plan-first ticket runs,
the review loop and the ticket branch, and the run's compiled workflow program with its check
blocks. It does no I/O at all: no files, no processes, no git, no clock reads. `@acp/server`
persists the state it returns and carries out the effects it asks for.

## How it is driven

Every command is a pure function `(state, input, ctx) → EngineResult`:

- `ctx` is an `EngineContext`, `{ now: Date, newId: () => string }`. The server passes the current
  time and `crypto.randomUUID`; tests pass a fixed clock and counting ids.
- `EngineResult` is `{ ok: true, state, effects, value }` or `{ ok: false, refusal }`. A refusal
  leaves the state unchanged; its `code` is one of `REFUSAL_CODES` (`errors.ts`), which the server
  maps to an error response, or returns as the tool result to the model.
- The server **persists `state` first**, then performs `effects` in order. Effects are typed
  (`EngineEffect` in `state.ts`): agent control (`start-agent`, `send-to-agent`, `interrupt-agent`,
  `abort-agent`), approvals and chat, plans, git work the server does on the engine's behalf
  (`seal-change`, `create-ticket-branch`, `merge-change`, `discard-change`, review checkouts), check
  runs (`run-change-checks`, `run-branch-checks`), ticket comments, follow-up turns and
  `diagnostic` counters.
- The engine never runs git or checks. The server does the work and reports back with a command
  (`changeSealed`, `recordChangeDecision`, `changeChecksFinished`, `agentSetupFailed`, ...).

## What it contains

- `state.ts`: types only. `RunState`, `EngineAgent`, `EngineChange`, `EngineApproval`,
  `RunLimits`, `OwnerWait`, `EngineContext`, `EngineEffect`, `EngineResult`.
- `commands.ts` (with the internal `Draft` in `draft.ts`): `createRun`, `ownerChat`, `agentEvent`,
  `requestPermission`, `decideApproval`, `expireApprovals`, `stopAgent`, `cancelRun`,
  `timeOutRun`, `completeCancellation`, `requestReview`, `recordReview`, `recoverAfterRestart`,
  `continueStages`.
- `transitions.ts`: `RUN_TRANSITIONS`, `AGENT_TRANSITIONS`, `canTransitionRun`,
  `canTransitionAgent`, `isTerminalRunStatus`. Anything not listed is illegal.
- `policy.ts`, `limits.ts`, `errors.ts`: `checkStartAgent`, `checkReviewAction`, `checkRunActive`;
  `runLimits`, `checkRunLimits`, `runSettingsFromSetup`; `REFUSAL_CODES`, `refusal`.
- `budget.ts`: the usage ledger (ADR-0014): `recordUsage`, `agentBudgetUsage`, `compareUsage`,
  `isOverBudget`.
- `lead-tools.ts`, `review-tool.ts`, `report-tool.ts`: the control tools agents call:
  `leadToolCall`, `controlToolsFor`, `CHILD_MANAGEMENT_TOOLS`, `cleanReviewBody`, `reportWork`.
- `plan.ts`, `plan-read.ts`, `plan-branch-check.ts`, `step-attempts.ts`: plan-first ticket runs
  (ADR-0016): `decidePlan`, `ticketRunPrompts`, `pendingPlan`, `approvedPlan`, `planBranchCommand`
  (no plan step may manage branches), `checkStepAttempts` (replacement helpers are bounded).
- `loop.ts`, `change-commands.ts`: the review loop and ticket branch (ADR-0021): `changeSealed`,
  `checkChangeAction`, `recordChangeDecision`, `requestTicketChanges`, `ticketBranchCreated`,
  `recordTicketBranchDecision`, `viewChangeReply`, `waitsOnlyForOwner`.
- `program.ts`, `stages.ts`, `briefs.ts`, `run-workflow.ts`: the run's compiled workflow program
  (ADR-0019, ADR-0023): `programOf`, `resolveHelper`, `effectiveMode`, `nextStage`,
  `launchFieldsFor`, `helperBriefLines`, and `deriveRunWorkflow`/`deriveRunWorkflowGraph` for the
  ticket page.
- `check-blocks.ts`: Checks blocks on a change (ADR-0027): `changeChecksFinished`,
  `agentSetupFailed`, `failureDetails`.
- `follow-up.ts`: one answers-only turn of an ended lead (ADR-0020): `followUpChat`,
  `followUpEvent`, `stopFollowUp`.
- `tree.ts`, `allowlist.ts`, `agent-note.ts`, `summary.ts`: the agent tree (`childrenOf`,
  `descendantsOf`, `agentDepth`, `agentRollUp`), `allowlistTarget` and `evaluateAllowlist`, the
  helper's note line, and `cleanSummary`.

Only `src/index.ts` is the public API; everything else is internal.

## Rules worth knowing before you change it

- **State machines.** Only the edges in the transition tables are allowed, and every pair is
  tested. A restart relaunches nothing: `recoverAfterRestart` moves live work to NEEDS_REVIEW.
- **Budgets.** The ledger dedups usage by messageId across the run and keeps the observation with
  the most output; repeated reports are never summed. Missing usage is unavailable, never 0.
- **Stopping.** `cancelRun` and `timeOutRun` move the run to CANCELLING, deny open approvals, end
  agents deepest first and the lead last; `completeCancellation` finishes once the server has seen
  every process end.
- **Allowlist.** `evaluateAllowlist` is pure and fails closed; the server resolves real paths first
  and `requestPermission` checks the verdict again against the run's approval mode.
- **Run timeout (v0.3.1).** Time a loop run spends waiting only for the owner does not count toward
  the run timeout. `waitsOnlyForOwner` is true when a change is at `needs-owner` and no agent but
  the lead is active; the draft keeps the waits in `RunState.ownerWait` (in memory only, like the
  ledger). `runWorkingMs` is the run's age minus those waits, and `isRunOverdue` compares it with
  the timeout. When the timeout stops a run, a helper in AWAITING_REVIEW ends CANCELLED (it has no
  process to time out); other live agents end TIMED_OUT.
- **Rework in a new session (v0.3.1).** If a rework turn reports a different session id than the
  one it resumed, the engine keeps the new id, sets `REWORK_NEW_SESSION_ACTIVITY` as the agent's
  latest activity, tells the lead, and emits the `rework-session-replaced` diagnostic.
- **No conversation content in state** (ADR-0009, ADR-0015) beyond the owner-facing texts the
  effects name (chat, tasks, plans, review and note comments).

## Testing

```bash
pnpm --filter @acp/orchestrator test
pnpm --filter @acp/orchestrator typecheck
pnpm --filter @acp/orchestrator build
```

Tests live in `tests/` and run with Vitest (`vitest.config.ts` collects `tests/**/*.test.ts`).
They are plain unit tests over engine state with an injected clock and ids (`tests/helpers.ts`); no
files, processes or network. Notable folders:

- `tests/graph-correctness/`: generated and golden workflow graphs run through a simulator with
  invariants checked at every step, plus snapshot files.
- `tests/adversarial/`: hostile agent behaviour and engine loops; see
  [docs/testing/adversarial.md](../../docs/testing/adversarial.md).

This package has no real-run drivers; those live in `@acp/server` (`tests/verification/`).

## Dependencies

`@acp/core` and `zod` only. `eslint.config.js` forbids importing `@acp/db`, `@acp/server`,
`@acp/web` or any adapter from this package. Keep it free of Node APIs and wall-clock reads.

## Specs and decisions

- [docs/orchestration-lifecycle.md](../../docs/orchestration-lifecycle.md) and
  [docs/architecture.md](../../docs/architecture.md) (managed runs, workflow graphs, review loop)
- [docs/usage-accounting.md](../../docs/usage-accounting.md)
- [docs/decisions/](../../docs/decisions/README.md): ADR-0012 to 0016 and 0019 to 0028 shape this
  package. Start with [0013](../../docs/decisions/0013-managed-execution-guardrails.md)
  (guardrails), [0021](../../docs/decisions/0021-approval-modes-review-loop-ticket-branch.md)
  (review loop) and [0023](../../docs/decisions/0023-editable-workflow-graphs.md) (workflow graphs).
