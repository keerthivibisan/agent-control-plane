# @acp/orchestrator

**Owner:** work package P3-A (see [docs/implementation-plan.md](/docs/implementation-plan.md), Phase 3);
Phase 4 extensions by P4-A ([docs/phase-4/README.md](/docs/phase-4/README.md)).

**Status:** [implemented] the M1 engine (P3-A), wired into the server by P3-D. [implemented] the
Phase 4 engine (P4-A): plan-first ticket runs, per-run limits, depth 2 and allowlist evaluation. The
server wiring for Phase 4 is P4-D.

## Responsibility

This is the pure orchestration engine. The model plans and this package decides (ADR-0013). It
covers:

- run and agent state machines;
- policy checks;
- lead-tool call validation;
- budget accounting;
- approvals;
- cancellation ordering;
- the restart rule.

There is no I/O. Persistence, processes and git live in `@acp/server` and the adapters.

## How the server uses it

Every command is a pure function: `(state, input, ctx) → EngineResult`.

- `ctx` is `{ now: Date, newId: () => string }`, injected so tests never depend on the wall clock.
- `EngineResult` is either `{ ok: true, state, effects, value }` or
  `{ ok: false, refusal: { code, message } }`. A refusal leaves the state unchanged. Its `code` is
  one of `REFUSAL_CODES`, so the server maps it to an `ErrorDto`, or returns `message` to the model
  as the tool result.
- The server **persists `state` first**, then performs `effects` in order (orchestration-lifecycle
  §1). The effects are `start-agent`, `send-to-agent`, `interrupt-agent`, `abort-agent`,
  `approval-requested`, `resolve-permission`, `chat-message`, `link-session`, `budget-overshoot` and
  `diagnostic`.

| Command                                                         | When                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `createRun(input, ctx)`                                         | `POST /api/runs`; refuses an unregistered project or bad limits  |
| `ownerChat(state, text, ctx)`                                   | owner chat; the first message starts the lead                    |
| `leadToolCall(state, call, ctx)`                                | each lead tool call (validated with `LeadToolInputs`)            |
| `agentEvent(state, agentRunId, event, ctx)`                     | each `ManagedAgentEvent` from the adapter                        |
| `requestPermission(state, request, ctx)`                        | the adapter's `requestPermission`; a refusal means deny now      |
| `decideApproval(state, approvalId, decision, ctx, opts?)`       | `POST /api/approvals/:id`                                        |
| `expireApprovals(state, ctx, timeoutMs?)`                       | on a timer; no answer within `APPROVAL_TIMEOUT_MS` means deny    |
| `stopAgent(state, agentRunId, ctx)`                             | the owner's Stop on one agent                                    |
| `cancelRun` / `timeOutRun`, then `completeCancellation`         | Stop all / run deadline; completes once the processes have ended |
| `requestReview(state, ctx)`                                     | the owner (the lead uses `request_review`)                       |
| `checkReviewAction`, then `recordReview(state, id, outcome, …)` | before and after the server's git merge or discard               |
| `recoverAfterRestart(state, ctx)`                               | on start, for every run that has not ended                       |
| `decidePlan(state, planId, decision, ctx, comment?)`            | `POST /api/tickets/:id/plans/:planId/decision` (Phase 4)         |

Phase 4 helpers (pure): `ticketLeadPrompt(ticket, limits)` builds the lead's first message for a
ticket run; `runSettingsFromSetup(setup)` gives `{ limits, budget }` for `createRun`;
`allowlistTarget(toolName, input)` and `evaluateAllowlist(input)` give the verdict that
`requestPermission(state, request, ctx, { allowlist })` records; `agentRollUp`, `descendantsOf`,
`childrenOf` and `agentDepth` read the agent tree; `pendingPlan`/`approvedPlan` read the plans.

## Rules it enforces (each one tested)

- **Transitions.** Only the edges in `RUN_TRANSITIONS` and `AGENT_TRANSITIONS` are allowed. Every
  `(from, to)` pair is tested.
- **`start_agent`.** The run must be RUNNING or BLOCKED, and its project must be registered. The
  caller must be the lead, so the child is at depth 1 at most. The caller must be under budget, and
  at most `MAX_CONCURRENT_CHILD_AGENTS` workers can be live at once.
- **Workers.** A worker calling a lead tool is refused. Text from a worker is dropped and counted;
  only the lead's text becomes chat (ADR-0015).
- **Budget (ADR-0014).**
  - The ledger dedups by messageId across the whole run and selects the observation with the most
    output. It never sums repeated reports.
  - Budget tokens come from `budgetTokens()`. A message with no counted category is unavailable,
    never 0.
  - Reaching the cap moves the agent to BLOCKED, interrupts it, and opens a `budget-raise`
    approval.
  - In-flight overshoot is reported as `budget-overshoot`.
  - Approve raises the cap (by default by another run cap) and resumes the agent. Deny or no answer
    stops it.
  - A property test shows that replaying usage in any order gives the same budgets.
- **Approvals.** Summaries are redacted and capped at 200 characters. A request that gets no answer
  in time is denied. A decision is accepted only once. An agent that stops has its open requests
  denied.
- **Cancellation order.** The run becomes CANCELLING first, so nothing new can start. Then the open
  approvals are denied, then the workers are aborted, and the lead is aborted last.
- **Restart.** Nothing is relaunched. Live agents and a working run become NEEDS_REVIEW. A run that
  was cancelling becomes CANCELLED.
- **Run status.**
  - BLOCKED when every live agent waits for the owner.
  - REVIEW when the lead requests it and no worker is live, or when the lead has ended and no worker
    is live.
  - COMPLETED once every worker's changes are merged, discarded, or `no-changes`. The lead is then
    aborted.

## Phase 4 rules (P4-A; each one tested)

- **Ticket runs are plan-first (ADR-0016).** `createRun` with `ticket: { ticketId, leadPrompt }`
  returns a PLANNING run whose lead is STARTING (a `start-agent` effect with the brief). The lead's
  `submit_plan` files plan v_n (→ PLAN_REVIEW, `plan-submitted`). `decidePlan` approves (→ RUNNING,
  the lead is told to start helpers) or requests changes with a required comment (→ PLANNING, the
  comment is sent to the lead; `plan-decided`). `start_agent` and every non-read-only tool use are
  refused with `plan-not-approved` until approval. The owner can chat with the lead while it plans.
  A lead that ends before approval fails the run. Runs without a ticket behave as in Phase 3.
- **Limits.** `RunState.limits` (`maxConcurrentHelpers` 1–6, `maxDepth` 1–2) is checked against
  `HARD_MAX_HELPERS`/`HARD_MAX_DEPTH`; absent means the Phase 3 limits (3, depth 1). The helper
  limit counts live helpers over the whole tree.
- **Depth 2.** When `maxDepth` is 2, a depth-1 helper's `start-agent` effect carries
  `canStartHelpers: true`; it may call `start_agent`, `list_agents`, `message_agent`, `stop_agent`
  and `agent_status` for its own children only (`CHILD_MANAGEMENT_TOOLS`), never `submit_plan` or
  `request_review`. The lead manages the whole tree. Stopping an agent stops its descendants first;
  Stop all aborts deepest first and the lead last. The adapter ends a helper's query when its
  turn ends. So a parent helper that reports `finished: success` while it still has live helpers
  stays RUNNING with `awaitingHelpers: true`, because its subtree is still working and the run
  must not reach review. It becomes SUCCEEDED once its last helper ends. Messages to it are
  refused because its process has ended. An error or cancel ends it at once; the lead keeps
  managing its helpers. Budgets stay per agent; `agentRollUp` sums them
  for display only.
- **Allowlist (ADR-0013 amendment).** Helpers only; the lead always asks. `editInOwnWorktree`
  allows Edit/Write/MultiEdit/NotebookEdit when the server-resolved real path is strictly inside
  the helper's real worktree path and not under `.git` or `.claude`. `runHarnessChecks` allows a
  foreground Bash command exactly equal to a check's argv joined by single spaces, and only when
  every token is shell-inert. An allowed request is recorded as an approval with
  `status: approved`, `decidedBy: 'allowlist'` and resolved at once. Owner decisions record
  `decidedBy: 'owner'`, expiries `'timeout'`.

## Notes for P4-D

- Keep `state.limits` and `state.plans` with the live run: plans are persisted from
  `state.plans` (`ticket_plans`), limits come from the project setup when the run is created.
- Map the new refusal codes `plan-not-approved` (409), `plan-not-found` (404) and
  `plan-not-pending` (409) (done in `control/errors.ts`).
- Store the owner's plan comment as a ticket comment; the engine only sends it to the lead.
- Resolve real paths before `evaluateAllowlist` (for a new file: the real parent plus the name).

## Notes for P3-D

- Usage attribution: `ManagedAgentEvent` carries no provider timestamp. If two agents report the same
  messageId, which is not expected because each agent is its own query, the smallest agentRunId is
  charged. This keeps replay order-independent.
- Live agents need the usage ledger (`RunState.ledger`). After a restart they are NEEDS_REVIEW, so
  the ledger can be kept in memory.
- `softCostUsdPerRun` is not evaluated here. A run-level warning would mean adding up the agents'
  estimated costs, which conflicts with "cost is never summed". The coordinator needs to decide this.

## Allowed dependencies

`@acp/core` and `zod`. Never `@acp/db`, `@acp/server`, `@acp/web` or the adapters (enforced by
`eslint.config.js`).
