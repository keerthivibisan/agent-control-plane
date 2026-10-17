# RL-A — Engine: approval policy, review loop, rework, ticket-branch handover

> Progress file for RL-A. Only the agent working on RL-A edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope and owned paths: `docs/review-loop/README.md` §5 and §9 (`packages/orchestrator/src/**` and
> its tests).

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Status  | in-progress                                            |
| Owner   | RL-A agent                                             |
| Branch  | `wp/rl-a-engine` (from `feature/ui-refresh` `06f540d`) |
| Started | 2026-10-17                                             |
| Updated | 2026-10-17                                             |

## Tasks

- [x] Legacy snapshot test, recorded on the code before any RL-A change
- [x] Publish the exported signatures (below) for RL-B
- [ ] Approval policy: `evaluateAllowlist(policy)`, `matchCommandAllowlist`, `ruleAllowedByMode`,
      `allowRule` on auto-approvals
- [ ] State: `RunState.integration` / `approvalPolicy`, `createRun` inputs, `EngineChange`
- [ ] Transitions: AWAITING_REVIEW edges, REVIEW → RUNNING, `isActiveAgent`
- [ ] Loop: seal, reviewer assignment, `submit_review`, lead change tools, owner overrides,
      checks, handover, final stages on the ticket branch, owner's final decision
- [ ] Stop all, restart, depth 2, budgets, separate planner
- [ ] Humanized activity lines
- [ ] Tests for every transition and refusal; `pnpm check`; completion report

## Work log (append-only; newest last)

| Date       | What was done                                        | Commit    | Checks                                                   |
| ---------- | ---------------------------------------------------- | --------- | -------------------------------------------------------- |
| 2026-10-17 | Claimed RL-A                                         | `ea41e09` | —                                                        |
| 2026-10-17 | Legacy snapshot test recorded on the pre-RL-A engine | `1ae4307` | orchestrator: format ✓ lint ✓ typecheck ✓ test 477/477 ✓ |
| 2026-10-17 | Published the signatures for RL-B (below)            | (this)    | docs only                                                |

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
