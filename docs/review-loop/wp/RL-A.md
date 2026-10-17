# RL-A — Engine: approval policy, review loop, rework, ticket-branch handover

> Progress file for RL-A. Only the agent working on RL-A edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope and owned paths: `docs/review-loop/README.md` §5 and §9 (`packages/orchestrator/src/**` and
> its tests).

| Field   | Value                                                        |
| ------- | ------------------------------------------------------------ |
| Status  | review                                                       |
| Owner   | RL-A agent                                                   |
| Branch  | `wp/rl-a-engine` (rebased on `feature/ui-refresh` `6876ef5`) |
| Started | 2026-10-17                                                   |
| Updated | 2026-10-17                                                   |

## Tasks

- [x] Legacy snapshot test, recorded on the code before any RL-A change
- [x] Publish the exported signatures (below) for RL-B
- [x] Approval policy: `evaluateAllowlist(policy)`, `matchCommandAllowlist`, `ruleAllowedByMode`,
      `allowRule` on auto-approvals
- [x] State: `RunState.integration` / `approvalPolicy`, `createRun` inputs, `EngineChange`
- [x] Transitions: AWAITING_REVIEW edges, REVIEW → RUNNING, `isActiveAgentStatus`
- [x] Loop: seal, reviewer assignment, `submit_review`, lead change tools, owner overrides,
      checks, handover, final stages on the ticket branch, owner's final decision
- [x] Stop all, restart, depth 2, budgets, separate planner
- [x] Humanized activity lines
- [x] Tests for every transition and refusal; `pnpm check`; completion report

## Work log (append-only; newest last)

| Date       | What was done                                                      | Commit    | Checks                                                   |
| ---------- | ------------------------------------------------------------------ | --------- | -------------------------------------------------------- |
| 2026-10-17 | Claimed RL-A                                                       | `a2a0524` | —                                                        |
| 2026-10-17 | Legacy snapshot test recorded on the pre-RL-A engine               | `abb4740` | orchestrator: format ✓ lint ✓ typecheck ✓ test 477/477 ✓ |
| 2026-10-17 | Published the signatures for RL-B (below)                          | `a672151` | docs only                                                |
| 2026-10-17 | Engine: approval policy, loop, handover, ticket branch, tests (30) | `9cd80d6` | format ✓ lint ✓ typecheck ✓ test 2326/2326 ✓ build ✓     |
| 2026-10-17 | Tests: lifecycle (22) and approval policy (23)                     | `cf3f9f1` | format ✓ lint ✓ typecheck ✓ test 2371/2371 ✓ build ✓     |
| 2026-10-17 | Shared test fixtures; rebased on `feature/ui-refresh` `6876ef5`    | `8a95fd6` | orchestrator: test 552/552 ✓                             |
| 2026-10-17 | Status `review`, completion report                                 | (this)    | format ✓ lint ✓ typecheck ✓ test 2377/2377 ✓ build ✓     |

## Handoff notes

### Exported signatures for RL-B (published early; final list in the completion report)

Everything is pure, `(state, …, ctx) => EngineResult<T>` unless noted; refusals leave the state
unchanged. A run **without** `integration` (every run until RL-B passes `reviewLoop`) is the legacy
flow, byte for byte (`tests/legacy-snapshot.test.ts`, recorded before RL-A).

**Refusal reasons (compatible shim).** `Refusal` gains an optional `reason?: RefusalReason`. The
specific reasons ride on existing codes so that `server/src/control/errors.ts`'s exhaustive
`REFUSAL_STATUS` still compiles:

- code `unknown-agent`: `change-not-found`;
- code `review-not-allowed`: `change-not-decidable`, `change-busy`, `rework-limit`,
  `merge-conflict`, `checks-pending`, `checks-failed`, `legacy-review`, `no-ticket-branch`;
- code `workers-still-running`: `changes-undecided`;
- code `run-not-active`: `handed-over`, `ticket-branch-pending`.

Proposed follow-up: promote them to `RefusalCode`s once RL-B adds the status-map entries.

**`createRun` input (`CreateRunInput`, ticket runs):**

```ts
/** ADR-0021 review loop; absent = legacy flow. Ticket runs only. */
reviewLoop?: {
  ticketKey: string;            // e.g. 'WEB-12'; must give a valid ticketBranchName(ticketKey)
  reviewer: ChangeReviewerMode; // StartTicketRequest.reviewer ?? reviewStageOf(workflow).reviewer
  maxReworkRounds: number;      // StartTicketRequest.maxReworkRounds ?? reviewStageOf(...).maxReworkRounds
};
/** ADR-0021 approvals snapshot: approvalsOf(setup) with StartTicketRequest.approvalMode applied. */
approvals?: ProjectApprovals;
```

**State.** P = persist it; the rest is live-only, because a restart makes every undecided change
`needs-owner`.

```ts
RunState.integration?: RunIntegration;      // P (run snapshot JSON)
RunState.approvalPolicy?: ProjectApprovals; // P (run snapshot JSON)
interface RunIntegration {
  reviewer: ChangeReviewerMode; maxReworkRounds: number; handedOver: boolean; // P
  ticketKey: string;           // P
  ticketBranch: string | null; // P (also ticket_branches.branch); null until ticketBranchCreated
}
EngineAgent.change?: EngineChange;      // workers and the tester of a loop run
EngineAgent.reviewsAgentRunId?: string; // a change reviewer: whose change it reviews
interface EngineChange {
  state: ChangeState;                  // P managed_workspaces.change_state
  round: number;                       // P managed_workspaces.rework_rounds (0 = first review)
  verdict: ChangeVerdict | null;       // this round's review-agent verdict
  reviewer: ChangeReviewerKind | null; // this round's reviewer; null until assigned
  reviewerAgentRunId: string | null;   // this round's review agent
  headCommit: string | null;           // P managed_workspaces.head_commit
  changedFiles: number | null;
  readyAt: string | null;              // reviewer queue order (oldest first)
  checks: 'pending' | 'passed' | 'failed' | null; // as the server reported
  conflictFiles: readonly string[];    // from the last merge attempt
  merging: boolean;                    // a merge-change effect is out, no result yet
  turnFailed: boolean;                 // the helper's last turn ended with an error
}
EngineApproval.allowRule?: AllowRule | null; // on auto-approvals of runs with approvalPolicy
```

**Commands (RL-B calls them):**

```ts
ticketBranchCreated(state, branch: string, ctx): EngineResult // after create-ticket-branch
changeSealed(state, agentRunId,
  { changed: boolean; headCommit: string | null; changedFiles: number | null }, ctx): EngineResult
//   changed false → no-changes, agent SUCCEEDED; changed + headCommit → ready;
//   changed + headCommit null (the seal failed) → needs-owner
checkChangeAction(state, agentRunId,
  action: 'merge' | 'merge-anyway' | 'rework' | 'discard' | 'ask-owner', by: ChangeDecider): Refusal | null
beginChangeMerge(state, agentRunId, { by: ChangeDecider; anyway?: boolean }, ctx): EngineResult
//   the owner's merge: sets merging and emits merge-change (the lead's goes through merge_change)
recordChangeDecision(state, agentRunId, {
  decision: ChangeDecision; by: ChangeDecider;
  outcome?: 'merged' | 'discarded' | 'no-changes'; // required for merge / merge-anyway
  comments?: string;   // rework comments (required), discard reason, ask-owner question
  headCommit?: string; // the commit the ticket branch now points at
}, ctx): EngineResult<string> // value: the reply for the lead's merge_change, or for the owner
changeMergeBlocked(state, agentRunId,
  | { reason: 'merge-conflict'; files: readonly string[] }
  | { reason: 'checks-pending' }
  | { reason: 'checks-failed'; failed: readonly string[] }
  | { reason: 'failed' }, ctx): EngineResult<string> // clears merging; value: the reply
checksFinished(state, agentRunId | null,
  { commit: string; requiredPassed: boolean; failed: readonly string[] }, ctx): EngineResult
requestReview(state, ctx) // loop runs: the handover, same rules as the lead's request_review
checkTicketBranchAction(state, action: TicketBranchActionRequest['action']): Refusal | null
recordTicketBranchDecision(state, outcome: 'merged' | 'discarded', ctx): EngineResult // → COMPLETED
requestTicketChanges(state, comment: string, ctx): EngineResult // REVIEW → RUNNING, to the lead
```

**Lead tool hooks.** `leadToolCall` handles the five change tools and `submit_review`.

- `view_change`: `value` is the engine's bounded summary. The server appends the diff with
  `viewChangeReply(summary, diff): string`, which caps the whole reply at `VIEW_CHANGE_MAX_BYTES`
  (32 KiB, UTF-8).
- `merge_change`: on success the state has `change.merging = true` and the effects hold
  `merge-change`. The server seals, integrates, checks and advances, then calls
  `recordChangeDecision` (merged or no-changes) or `changeMergeBlocked`, and returns **that**
  result's `value` to the lead.

**Effects (new or extended):**

```ts
| { type: 'start-agent'; …; rework?: { resumeSessionId: string | null };
    reviewScope?: ReviewScope; fromBranch?: string }
//   fromBranch: create the worker's or tester's worktree from this ticket branch's tip
| { type: 'create-review-checkout'; agentRunId: string; commit?: string;
    reviewsAgentRunId?: string; ticketBranch?: string }
//   commit + reviewsAgentRunId: a change reviewer, detached at the sealed commit (the server
//   appends the ≤ 64 KiB diff to its brief); ticketBranch: the final reviewer, detached at the
//   ticket tip; neither: the legacy main-branch checkout
| { type: 'review-comment'; agentRunId: string; body: string;
    changeOf?: string; round?: number; verdict?: ChangeVerdict }
| { type: 'seal-change'; agentRunId: string }
| { type: 'create-ticket-branch'; ticketKey: string } // at plan approval, before any helper
| { type: 'merge-change'; agentRunId: string; by: ChangeDecider; anyway: boolean }
| { type: 'discard-change'; agentRunId: string } // remove the helper's worktree (idempotent)
| { type: 'change-round'; agentRunId: string; round: number; reviewer: ChangeReviewerKind;
    reviewerAgentRunId: string | null; verdict: ChangeVerdict | null;
    decision: ChangeDecision | null; decidedBy: ChangeDecider | null }
//   upsert the change_reviews row (agentRunId, round)
| { type: 'change-comment'; agentRunId: string; round: number; author: 'lead' | 'owner';
    kind: 'rework' | 'discard' | 'ask-owner'; body: string }
//   a ticket comment, linked to that round's row
```

**Approvals:** `AllowlistInput.policy?: ProjectApprovals` is preferred; `allowlist` becomes
optional and is used only when `policy` is absent. `AllowlistRule` is core's `AllowRule`; the
verdict is `{ allowed: true; rule; checkId?; pattern? }`. `matchCommandAllowlist(command,
patterns): CommandPattern | null` and `ruleAllowedByMode(mode, rule): boolean`.
`requestPermission` re-checks the verdict's rule against `state.approvalPolicy.mode` and records
`allowRule`.

### Final signatures: changes from the early list

- `beginChangeMerge` returns `EngineResult<string>` (the published list said `EngineResult`).
  Nothing else changed.
- Also exported: `viewChangeReply`, `changeSummary`, `VIEW_CHANGE_MAX_BYTES`, `MergeBlocked`,
  `ChangeAction`, `DecisionInput`, `undecidedChanges`, `isFinalChangeState`, `activeHelperCount`,
  `isActiveAgentStatus`, `isChangeReviewer`, `isStageAgent`, `changeReviewerBrief`,
  `changeReviewerLaunchFields`, `REFUSAL_REASONS`, `RefusalReason`, and the types
  `RunIntegration` and `EngineChange`.

### Notes for RL-B (server, db, adapter)

1. **Persist** `integration` and `approvalPolicy` with the run snapshot, and each change's `state`,
   `round` and `headCommit` (`managed_workspaces`). After a reload, `recoverAfterRestart` moves
   every undecided change to `needs-owner`, so the live-only fields can start empty
   (`verdict: null`, `checks: null`, `merging: false`, and so on).
2. **Session for rework.** The engine records a loop helper's first `started` session id in
   `agent.sessionId`. When you load agents from the database, fill `sessionId` from
   `agent_run_sessions` so that `start-agent.rework.resumeSessionId` can resume the session.
3. **Ticket branch.** Carry out `create-ticket-branch` before any later effect, then call
   `ticketBranchCreated(branch)`. `start_agent` is refused until then (`ticket-branch-pending`).
   If creation fails, the engine has no failure command: stop the run (`cancelRun`) and log it.
4. **`merge_change`.** `leadToolCall` → `merge-change` effect → seal, then integrate, then checks on
   that commit, then compare-and-swap. Then call `recordChangeDecision({ decision: 'merge', by,
outcome: 'merged' | 'no-changes', headCommit })` or `changeMergeBlocked(...)`, and answer the
   lead with that result's `value`. A stopped helper's change has `headCommit: null`: the seal
   is the first step of the merge anyway.
5. **Owner per-change actions** (`ReviewActionRequest` on loop runs):
   - first `checkChangeAction(…, by: 'owner')`;
   - merge or merge-anyway: `beginChangeMerge(…, { by: 'owner', anyway })`, then the same as
     step 4;
   - rework or discard: `recordChangeDecision(…, { decision, by: 'owner', comments })`.

   `recordReview` and `checkReviewAction` refuse loop runs (`legacy-review`).

6. **Owner's final decision:** `checkTicketBranchAction(action)`, then the git work, then:
   - `recordTicketBranchDecision('merged' | 'discarded')`;
   - or `requestTicketChanges(comment)`; store the comment as the owner's ticket comment;
   - `update-from-base` has no engine command beyond the check.
7. **Comments and rows:**
   - `review-comment` with `changeOf` is the change reviewer's findings (author `reviewer`); link
     it to the `change_reviews` row (`changeOf`, `round`);
   - `change-comment` is a ticket comment by `lead` or `owner`;
   - `change-round` upserts the row for (`agentRunId`, `round`).
8. **`review` field.** In loop runs `agent.review` stays null until the change is final
   (`merged` / `discarded` / `no-changes`). The server's "a new pending review" triggers never fire
   for loop runs (board/service.ts:304, control/service.ts:628). Checks run through
   `merge-change` and `checksFinished`.
9. **No process.** AWAITING_REVIEW agents have no process. Stop all emits no `abort-agent` for
   them. Stop and `message_agent` are refused for them.
10. **Gate.** Pass `policy: run.approvalPolicy` to `evaluateAllowlist` for runs that have one. The
    engine checks the verdict again and records `allowRule` (approvals decided by `allowlist`
    only).

## Completion report — RL-A

1. **Summary:** The engine half of ADR-0021, as pure functions:
   - approval modes and the command matcher;
   - the review loop (seal, review agent or lead, submit_review, the five change tools, owner
     overrides, checks);
   - the handover with the final stages on the ticket branch;
   - the owner's single final decision;
   - Stop all, restart, depth 2 and budgets.

   Runs without `reviewLoop` are byte-identical to before (a legacy snapshot recorded on the
   pre-RL-A engine).

2. **Files changed:**
   - created:
     - `packages/orchestrator/src/{loop,change-commands,summary}.ts`;
     - `packages/orchestrator/tests/{legacy-snapshot,review-loop,review-loop-lifecycle,approval-policy}.test.ts`;
     - `tests/loop-helpers.ts`;
     - `tests/__snapshots__/legacy-snapshot.test.ts.snap`;
     - this progress file;
   - modified:
     - `packages/orchestrator/src/{allowlist,commands,draft,errors,index,lead-tools,plan,policy,review-tool,run-workflow,stages,state,transitions}.ts`;
     - `tests/transitions.test.ts` (the RL-0 placeholder rows).
3. **Commands run and actual results** (`pnpm check` from the root, Node 22.21.1, pnpm 10.26.1,
   after rebasing on `6876ef5`):
   - format:check ✓;
   - lint ✓ (0 warnings);
   - typecheck ✓;
   - test ✓ 2377 passed (core 285, adapter-demo 12, orchestrator 552, adapter-claude-code 323,
     db 175, web 611, server 419);
   - build ✓.
4. **Acceptance criteria:**
   - integration and approval-policy snapshot; legacy runs unchanged → met
     (`legacy-snapshot.test.ts`; existing tests unchanged except the RL-0 placeholder rows);
   - AWAITING_REVIEW edges, `isActiveAgentStatus`, `liveWorkers`, BLOCKED → met;
   - the loop (seal, reviewers oldest first, lead as reviewer, submit_review, view, merge, rework
     with its three limits, discard, ask_owner, owner overrides with an extra round, checks) → met;
   - handover and the final stages with the lead live; REVIEW → RUNNING on request changes; the
     lead ending early → met;
   - `create-ticket-branch` in both planner modes; `fromBranch` → met;
   - Stop all, restart, depth 2, budgets (32 KiB `view_change`), separate planner → met;
   - mode-rule table and matcher fuzz → met;
   - humanized activity lines → met.
5. **Assumptions** (documented in the code comments and here):
   - an errored helper turn still enters the loop;
   - a helper stopped mid-turn (lead or owner Stop, a budget deny, a crash while parked) leaves
     its work at `decision` (lead live) or `needs-owner`: merge or discard, never rework;
   - the owner's rework of an over-budget helper raises its cap by one agent budget (like a
     budget raise);
   - a seal that fails is reported as `changed: true, headCommit: null` → `needs-owner`;
   - the final stages run once: they do not run again after the owner's "request changes";
   - REVIEW never completes by itself in loop runs, even with nothing merged; the owner merges or
     discards the (possibly empty) branch;
   - agent messages are held while the lead is BLOCKED and listed when it resumes.
6. **Contract or shared-file changes proposed (not made):**
   - promote the `Refusal.reason` values to `RefusalCode`s, with `REFUSAL_STATUS` entries in
     `server/src/control/errors.ts` (RL-B owns that file);
   - optionally, an engine command for a failed ticket-branch creation.
7. **Known gaps and follow-ups:**
   - `docs/orchestration-lifecycle.md` and the README "Status" are not updated: outside RL-A's
     owned paths;
   - the server, db and adapter wiring is RL-B's;
   - a change reviewer that has submitted but not yet ended still holds a slot and blocks
     `request_review` until it ends.
8. **Next recommended task:** RL-B rebases on this branch and wires the notes above; then RL-D
   and RL-V.
