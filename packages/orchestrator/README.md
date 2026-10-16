# @acp/orchestrator

**Owner:** work package P3-A (see [docs/implementation-plan.md](/docs/implementation-plan.md), Phase 3);
Phase 4 extensions by P4-A ([docs/phase-4/README.md](/docs/phase-4/README.md)); workflow stages
by R-C ([docs/redesign/README.md](/docs/redesign/README.md), ADR-0019).

**Status:** [implemented] the M1 engine (P3-A), wired into the server by P3-D. [implemented] the
Phase 4 engine (P4-A): plan-first ticket runs, per-run limits, depth 2 and allowlist evaluation. The
server wiring for Phase 4 is P4-D. [implemented] the workflow stages (R-C, ADR-0019): the separate
planner, the post-merge reviewer and tester, skills and models per stage. Their server wiring is
R-G; until then no server code creates these roles.

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
  `approval-requested`, `resolve-permission`, `chat-message`, `link-session`, `plan-submitted`,
  `plan-decided`, `create-review-checkout`, `remove-review-checkout`, `review-comment`,
  `budget-overshoot` and `diagnostic`.

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
| `continueStages(state, ctx)`                                    | the owner's Continue after a restart held a stage (ADR-0019)     |

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

## Workflow stage rules (R-C, ADR-0019; each one tested)

- **Workflow snapshot.** `createRun({ ..., workflow })` validates the project's `ProjectWorkflow`
  (schema, same project, ticket runs only) and keeps a copy in `RunState.workflow`. No workflow, or
  `defaultProjectWorkflow()`, gives exactly the Phase 4 run: a test replays the whole ticket flow
  both ways and compares every effect, value and state.
- **Stages per agent.** Every agent of a ticket run records `stage`: planner `plan`, lead
  `orchestrate`, helpers `helpers`, reviewer `code-review`, tester `unit-tests`. Phase 3 runs have
  none. `deriveRunWorkflow(state, workflow?)` gives the `RunWorkflowDto` stage states (`off`,
  `waiting`, `active`, `needs-you`, `done`, `failed`, `skipped`); in `lead` mode the lead also
  counts for `plan`.
- **Separate planner.** `plannerMode: 'separate'` needs `ticket.plannerPrompt`
  (`ticketRunPrompts`). The planner starts at once (`start-agent`, kind `planner`); the lead waits
  QUEUED with `ticket.leadPrompt` kept in `RunState.leadBrief`. Owner chat goes to the planner
  while it plans, and its text is chat under the run's agent voice (`lead`; a planner role is
  deferred, decision C). Only the planner submits and revises the plan; the lead is refused. On
  approval the planner ends (SUCCEEDED, `abort-agent`) and the lead starts with its brief plus the
  approved plan and the owner's note. If the planner or the waiting lead ends before approval, the
  run fails. The planner has only `submit_plan` and every tool use it asks for is refused.
- **Post-merge stages.** When every helper's change is reviewed and at least one was merged, the
  engine starts `code-review` (when on), then `unit-tests` (when on), one at a time; nothing runs
  when nothing was merged. The lead is stopped first (its conversation is over), as at completion.
  The run stays REVIEW meanwhile (the transition table is unchanged); it completes once every
  enabled stage finished.
  - Reviewer: kind `reviewer`, no parent, read-only, `create-review-checkout` before its
    `start-agent` and `remove-review-checkout` when it ends (after any abort). `post_review`
    (`LeadToolInputs.post_review`, `{ text }`) emits `review-comment` with the text redacted and
    capped at 8,000 characters, at most `MAX_REVIEW_POSTS` (5) times. Anyone else is refused
    (`not-lead`). A reviewer that fails or is stopped never blocks the run.
  - Tester: kind `tester`, task `TESTER_TASK`, a fixed brief, its own worktree. Its tool uses are
    asked like a helper's (also in REVIEW), the allowlist covers it, and its change is reviewed with
    `checkReviewAction`/`recordReview` like a helper's. Merged or discarded finishes the stage.
  - The reviewer and the tester count against the helper limit, and never start helpers.
- **Stop and restart.** Stop all aborts every live agent, deepest first, the lead last; stopping
  the reviewer skips its stage. After a restart nothing relaunches: if the restart interrupted the
  run or a post-merge agent and the workflow has a post-merge stage, `RunState.stagesHeld` is set
  and no stage starts until the owner's `continueStages` (refused while an agent is live, a change
  is unreviewed, or nothing waits). An interrupted reviewer never posted, so Continue runs the code
  review again; an interrupted tester's change is reviewed, never re-run.
- **Skills and models (ADR-0019 §4, decision E).** For each stage with a skill, the agent's prompt
  gets one line, ``Use the project skill `acp-skills:<name>`.``, and its `start-agent` effect gets
  `skills: [<name>, …]` (bare names). A stage's model is `start-agent.model`. Both are absent when
  the workflow sets none. No skill file content reaches the engine.
- **Control tools.** `controlToolsFor(state, agentRunId)`: lead every lead tool except
  `post_review` (and `submit_plan` in separate mode); planner `submit_plan`; reviewer
  `post_review`; a depth-1 helper of a depth-2 run the child tools; tester none.

## Notes for R-G

- **Create:** `createRun({ ...runSettingsFromSetup(setup), workflow, ticket: { ticketId,
...ticketRunPrompts(ticket, limits, workflow) } })`. Persist `state.workflow` with the run (it is
  the snapshot; 0004 has no column for it, so put it in the `orchestration_runs.limits` JSON or add
  one) and `EngineAgent.stage` as `agent_runs.stage`. Keep `leadBrief`, `stagesHeld` and
  `reviewPosts` with the live run (in memory, like the ledger).
- **`start-agent` by kind:** `lead` and `planner` run read-only in the owner's tree (deny their
  tool uses as for the lead); `worker` and `tester` get a worktree from the current main branch;
  `reviewer` uses the checkout from the `create-review-checkout` effect just before it. Set
  `spec.kind = effect.kind`, `spec.model = effect.model ?? setup.model`, and give `leadTools` to
  the lead, the planner, the reviewer and depth-2 parent helpers. When `effect.skills` is present,
  build the run's skills plugin from the project checkout and set `spec.skillPlugin = { path,
skills: effect.skills.map(pluginSkillName) }`.
- **Effects:** `create-review-checkout` (temporary detached worktree of main, the "Run checks now"
  mechanism), `remove-review-checkout` (remove it; also after a restart), `review-comment` (store
  a `TicketComment` with author `reviewer`, the run id and `planId: null`).
- **Routes:** expose `continueStages` (a "Continue" action) and `deriveRunWorkflow` for
  `RunWorkflowDto`. Review routes must accept the tester (`board/checks.ts`,
  `control/service.ts` still check `kind === 'worker'`), and `evaluateAllowlist` takes the
  agent's kind as is. The ticket is DONE when the run is COMPLETED, as before.

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
