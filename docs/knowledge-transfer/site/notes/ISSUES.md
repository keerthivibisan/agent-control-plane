# 05 · Issues, mitigations and priorities

Status refers to the pinned development baseline, not earlier screenshots. These are confirmed
mechanisms and bounded code-review observations; they are not production incident counts, a
complete security audit, or measured token costs. No runtime changes are made by this docs PR.

## Historical findings now mitigated

| Earlier finding                                              | Current mitigation                                                              | Evidence                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Helpers cannot repair target conflicts through forbidden Git | Server prepares an in-progress merge and launches a content-only resolver       | `control/conflict-resolution.ts`, `orchestrator/resolution.ts` |
| Update target hidden with an open PR                         | Conflict-resolution action is available on the final step, including PR context | `features/review-loop/BranchFinalStep.tsx`, resolution panel   |
| Lead lacks helper no-change reason                           | `reportedOutcome`, `helper-outcome`, `noChangeLine` carry the reason            | `report-tool.ts`, `change-commands.ts`                         |
| No-change replacements escape lost-attempt accounting        | `isLostAttempt` includes no-changes; resolver attempts are separately bounded   | `step-attempts.ts`, conflict operation service                 |
| Owner-only waits consume the normal run deadline             | `isRunOverdue` subtracts tracked owner wait                                     | `commands.ts`, owner-wait tests                                |

Mitigation does not prove every retry is productive or every repair is semantically correct.

## Remaining mechanisms worth addressing

These findings extend the inventory; their cost and occurrence rate remain unmeasured. They are
proposals for future work, not runtime fixes made in this session.

### C01. A temporary context failure lasts for the run

- **Confirmed mechanism:** The first rejected setup read is caught and replaced with NO_SETUP; its promise remains cached in live.setup. Later agents in that live run reuse the empty setup instead of retrying the read.
- **Possible consequence:** If context loading fails before a lead and four helpers start, all five can lack the intended guidance. Actual extra discovery tokens are unknown.
- **Proposed control:** Show degraded context explicitly; consider a bounded retry before later launches while preserving a coherent context version.
- **Source:** `packages/server/src/control/service.ts — setupFor`.

### C02. Context can describe a different source snapshot

- **Confirmed mechanism:** Context is read from the owner checkout and reused per run; editing agents work in ticket-based worktrees. That launch path does not bind context file hashes to each helper base commit.
- **Possible consequence:** A ticket still using the old directory layout may receive guidance from an owner checkout with a newer layout. The mismatch can cause wrong searches or rework.
- **Proposed control:** Keep trusted owner policy separate from source facts. Attach source hashes/commit provenance and validate source references against the agent checkout.
- **Source:** `packages/server/src/board/harness.ts — agentSetup; control/service.ts — startAgent, setupFor`.

### C03. Input and event queues have no size bound

- **Confirmed mechanism:** The adapter queue explicitly describes itself as unbounded. Messages sent while a worker starts also accumulate in an array. Existing message validation does not impose a total queue bound here.
- **Possible consequence:** A burst can create a backlog of stale or repetitive requests. Queued input may cause extra turns if consumed; queued events create memory/backpressure risk rather than directly generating tokens.
- **Proposed control:** Bound queue count/bytes; expose backpressure and per-message state. Coalesce only explicitly replaceable updates, never silently drop task instructions.
- **Source:** `packages/adapters/claude-code/src/managed/queue.ts — AsyncQueue; server/src/control/service.ts — pendingSends, sendTo`.

### C04. “Message sent” is not a delivery acknowledgment

- **Confirmed mechanism:** The engine returns success after emitting send-to-agent. Missing handles and rejected sends are logged later; that reply does not acknowledge consumption or reading.
- **Possible consequence:** The coordinator may wait, poll or repeat an instruction that never arrived. Race frequency and extra tokens have not been measured.
- **Proposed control:** Track accepted, queued, delivered-to-handle and failed states. Do not claim read acknowledgment without provider evidence.
- **Source:** `packages/orchestrator/src/lead-tools.ts — message_agent; server/src/control/service.ts — sendTo`.

### C05. Follow-up spending resets for each question

- **Confirmed mechanism:** Each ended-lead follow-up starts with EMPTY_LEDGER and zero turn usage, using the run per-agent limit. The budget is enforced per follow-up turn, not as a cumulative conversation allowance.
- **Possible consequence:** Illustrative ceiling: ten follow-ups at the default 500,000-token allowance permit 5,000,000 budget tokens before considering soft-cap overshoot. This is permission to spend, not actual consumption.
- **Proposed control:** Keep per-turn protection; propose a separate cumulative follow-up/project allowance and show remaining scope. Preserve accounting and explicit owner policy.
- **Source:** `packages/orchestrator/src/follow-up.ts — followUpChat, followUpBudgetTokens, followUpEvent`.

### C06. Large change inspection returns a bounded prefix

- **Confirmed mechanism:** The full lead view_change reply is capped at 32 KiB. The tool takes an agent ID, with no file/range cursor. Repeating it without a source change cannot page through the rest.
- **Possible consequence:** A large refactor can require repeated file discovery because later portions do not fit. The cap is intentional protection, not evidence that increasing it is the right fix.
- **Proposed control:** Offer a file manifest and bounded per-file/range inspection with explicit coverage/truncation. Keep a total inspection budget.
- **Source:** `packages/orchestrator/src/loop.ts — viewChangeReply; server/src/control/service.ts — leadTool(view_change)`.

### C07. Global check serialization can extend feedback loops

- **Confirmed mechanism:** Checks share a server-wide serial runner. The working-state timeout defaults to two hours. The current isRunOverdue path subtracts owner-only wait time; no dedicated harness-queue subtraction is apparent in this path. Review/plan-owner-wait states have their own handling.
- **Possible consequence:** Hypothetically, six ten-minute check jobs ahead create about one hour of waiting. Whether it times out a run depends on its state and remaining deadline. Waiting alone generates no model tokens; duplicate retries can.
- **Proposed control:** Expose queued versus active work, avoid duplicate in-flight checks, and design resource/deadline policy deliberately. Preserve required checks and isolation.
- **Source:** `packages/server/src/harness/runner.ts — queue; packages/server/src/control/service.ts — sweep; packages/orchestrator/src/commands.ts — isRunOverdue`.

## Delivery and verification limits to keep visible

Local target refs may lag origin; automated repair is triggered by supported reads/local events,
not a timer. Conditional verification is project policy, not a graph decision block. The resolver
is not an independent assessor, and delegated delivery does not automatically merge remote PRs.
The graph can intentionally omit checks; absence of a gate does not prove behavior is safe.

Final stages normally track whether a stage already ran. Later changes need fresh commit-bound
acceptance evidence; a previously completed stage is not a universal pass for a newer candidate.
See `packages/orchestrator/src/stages.ts: nextStage` and the dedicated resolution evidence binding.

## Suggested order

1. **Context degradation and freshness:** expose missing/truncated context and bind source facts to
   the actual checkout. Prevent a stale project map from creating wrong work.
2. **Message backpressure and delivery status:** preserve task instructions, bound backlog and
   distinguish accepted/queued/delivered/failed instead of claiming read acknowledgment.
3. **Aggregate admission:** add a separately reviewed project/run/follow-up spending policy rather
   than silently changing ADR-0014. Preserve unknown usage and soft-cap overshoot reporting.
4. **Progress and evidence:** measure retries after the current fixes, improve large-change
   inspection coverage, show check queue time, and scope final-evidence freshness work.
5. **Governance:** reconcile ADR-0030 and status/AGENTS wording now that code is merged. These shared
   authority files are not edited in this documentation PR.

Each implementation needs its own scoped work package, tests and any affected contract/ADR review.
Keep permission protections and required verification while reducing unnecessary work.
