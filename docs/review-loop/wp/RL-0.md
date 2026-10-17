# RL-0 — Coordinator contract: ADR-0021, core contract, migration 0006

> Progress file for RL-0. Only the agent working on RL-0 edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope and owned paths: `docs/review-loop/README.md` §9.

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Status  | review                                                 |
| Owner   | coordinator (drafted by an agent)                      |
| Branch  | `wp/rl-0-contract` (from `feature/ui-refresh` 7b581c8) |
| Started | 2026-10-17                                             |
| Updated | 2026-10-17                                             |

## Tasks

- [x] Core contract, additive (README §3), with contract tests
- [x] Compile-only placeholders where a new member broke an exhaustive type (listed below)
- [x] Migration `0006_review_loop.sql` (README §4), schema snapshot, migration test
- [x] ADR-0021 (proposed) and "amended by ADR-0021" pointers in ADR-0013/0016/0017/0019/0020
- [x] Handoff for RL-A, RL-B and RL-D (below)

## Work log (append-only; newest last)

| Date       | What was done                                                     | Commit    | Checks                                               |
| ---------- | ----------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| 2026-10-17 | Core contract + compile-only placeholders + contract tests        | `8f5ea8e` | format ✓ lint ✓ typecheck ✓ test 2284/2284 ✓ build ✓ |
| 2026-10-17 | Migration 0006, schema snapshot, migration test                   | `ed725c0` | format ✓ lint ✓ typecheck ✓ test 2291/2291 ✓ build ✓ |
| 2026-10-17 | ADR-0021 (proposed), ADR pointers, this progress file and handoff | (docs)    | format ✓ lint ✓ typecheck ✓ test 2291/2291 ✓ build ✓ |

## Handoff notes

### 1. Exported names (`@acp/core`, `@acp/core/api`)

**`workspace/workspace.ts`**

| Name                                                           | Kind                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApprovalModeSchema`, `ApprovalMode`, `APPROVAL_MODES`         | `'manual' \| 'auto-edits' \| 'auto'`                                                                                                        |
| `DEFAULT_APPROVAL_MODE`                                        | `'auto-edits'`, for **new** projects only                                                                                                   |
| `AllowRuleSchema`, `AllowRule`                                 | `'edit-in-own-worktree' \| 'run-harness-check' \| 'command-allowlist'` (same strings as the engine's `AllowlistRule`, plus the new one)     |
| `MAX_COMMAND_PATTERNS` (30), `MAX_COMMAND_PATTERN_TOKENS` (8)  | numbers                                                                                                                                     |
| `COMMAND_TOKEN_PATTERN`, `BARE_COMMAND_PATTERN`                | regexes                                                                                                                                     |
| `isSafeCommandToken(token): boolean`                           | token charset, no absolute part (also after `=`, `:`, `,`, `@`), no `..` — **use it in `matchCommandAllowlist` for the actual command too** |
| `FORBIDDEN_ALLOWLIST_COMMANDS: readonly string[]`              | argv[0] never allowed                                                                                                                       |
| `GIT_READ_ONLY_SUBCOMMANDS: readonly string[]`                 | status, diff, log, show, rev-parse, ls-files, blame, grep                                                                                   |
| `isForbiddenGitOption(token): boolean`                         | `-c`, `-C`, `-O…`, `--git-dir`, `--work-tree`, `--exec-path`, `--config-env`, `--open-files-in-pager`, `--ext-diff`, `--output` (and `=…`)  |
| `CommandTokenSchema`, `CommandPatternSchema`, `CommandPattern` | `{ argv: CommandToken[1..8], match: 'exact' \| 'prefix' }` with the argv[0] and git refinements                                             |
| `ProjectApprovalsSchema`, `ProjectApprovals`                   | `{ mode, commands: CommandPattern[≤30] }`, unique `(match, argv)`                                                                           |
| `approvalsFromLegacy(allowlist): ProjectApprovals`             | edits on → `auto-edits`, else `manual`; `commands: []`                                                                                      |
| `approvalsOf(setup): ProjectApprovals`                         | `setup.approvals ?? approvalsFromLegacy(setup.allowlist)`                                                                                   |
| `ProjectAgentSetup.approvals?`                                 | optional; `allowlist` kept                                                                                                                  |
| `CheckRun.commit?: string \| null`                             | optional (db column `check_runs.commit_sha`)                                                                                                |

**`workspace/workflow.ts`**

| Name                                                                           | Kind                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `ChangeReviewerModeSchema`, `ChangeReviewerMode`                               | `'agent' \| 'lead'`                                                                       |
| `DEFAULT_MAX_REWORK_ROUNDS` (2), `MAX_REWORK_ROUNDS` (5), `ReworkRoundsSchema` | int 0..5                                                                                  |
| `ProjectWorkflow.stages.review`                                                | `requireChecks: true` + optional `reviewer`, `maxReworkRounds`, `model`, `skill`, `agent` |
| `ReviewStageSettings`, `reviewStageOf(workflow)`                               | the review stage with defaults applied (`agent`, 2, null, null, null)                     |
| `stagesUsingSkill`, `stagesUsingAgent`                                         | now include `'review'` (between helpers and code-review)                                  |

**`orchestration/orchestration.ts`**

| Name                                                                                                                                                                                                                                                | Kind                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AgentRunStatus` + `'AWAITING_REVIEW'`                                                                                                                                                                                                              | after `BLOCKED` in the enum                                                               |
| `ChangeStateSchema`, `ChangeState`, `FINAL_CHANGE_STATES`                                                                                                                                                                                           | sealing, ready, reviewing, decision, rework, needs-owner, merged, discarded, no-changes   |
| `ChangeReviewerKindSchema` (`agent \| lead \| owner`), `ChangeVerdictSchema` (`approve \| rework`), `ChangeDecisionSchema` (`merge \| merge-anyway \| rework \| discard \| ask-owner`), `ChangeDeciderSchema` (`lead \| owner`)                     | the `change_reviews` enums                                                                |
| `GitCommitSchema`                                                                                                                                                                                                                                   | `^[0-9a-f]{7,64}$`                                                                        |
| `TicketBranchStateSchema` (`open \| merged \| discarded`), `TicketBranchNameSchema`                                                                                                                                                                 | `^acp/[A-Z]{2,6}-[1-9]\d*(-r[1-9]\d*)?$`                                                  |
| `ticketBranchName(ticketKey, attempt = 0)`                                                                                                                                                                                                          | `acp/WEB-12`, `acp/WEB-12-r<attempt>`; throws on bad input                                |
| `LeadToolInputs` + `view_change {agentId}`, `merge_change {agentId}`, `request_rework {agentId, comments 1..4000}`, `discard_change {agentId, reason 1..500}`, `ask_owner {agentId, question 1..2000}`, `submit_review {verdict, findings 1..8000}` | all trimmed strings                                                                       |
| `CHANGE_DECISION_TOOL_NAMES`                                                                                                                                                                                                                        | the lead's five change tools                                                              |
| `CHANGE_REVIEWER_TOOL_NAMES`                                                                                                                                                                                                                        | `['submit_review']`                                                                       |
| `REVIEW_LOOP_TOOL_NAMES`                                                                                                                                                                                                                            | both lists; used only by the placeholders (remove its uses when wiring)                   |
| `CONTROL_TOOL_LABELS: Readonly<Record<LeadToolName, string>>`, `controlToolLabel(name)`                                                                                                                                                             | plain past-tense labels for bare names; null for anything else (strip `mcp__acp__` first) |

**`adapters/managed.ts`:** `ManagedAgentSpec.rework?: { resumeSessionId: string | null }`,
`ManagedAgentSpec.reviewScope?: ReviewScope` (`'change' | 'final'`; absent = `final`).

**`api/orchestration.ts`:** `ApprovalDto.allowRule?: AllowRule | null`;
`ChangeReviewRoundDto` (`id, round, reviewer, reviewerAgentRunId, verdict, decision, decidedBy,
commentId, createdAt, decidedAt`); `ChangeReviewDto` (`agentRunId, role, state, reworkRounds,
maxReworkRounds, headCommit, changedFiles, conflictFiles, checks, reviews`); `TicketBranchDto`
(`runId, branch, baseBranch, baseCommit, headCommit, state, mergedCommit, createdAt, updatedAt`);
`RunDetailDto.approvalMode?`, `.ticketBranch?: TicketBranchDto | null`, `.changes?:
ChangeReviewDto[]`; `TicketBranchReviewDto` (`runId, ticketBranch, files, diff, diffTruncated,
checks, baseMoved`); `ReviewActionRequest.action` + `'rework'` with `comment` (required for
rework); `TicketBranchActionRequest` (`merge | merge-anyway | discard | request-changes |
update-from-base`, `reason` required for merge-anyway, `comment` for request-changes).

**`api/workspace.ts`:** `UpdateProjectSetupRequest.approvals?`; `StartTicketRequestSchema`,
`StartTicketRequest` (`approvalMode?`, `reviewer?`, `maxReworkRounds?`).

**`api/redesign.ts`:** `RunWorkflowDto.review?` (`waiting, inReview, rework, needsOwner, merged,
discarded, noChanges, reworkRounds`).

### 2. Compile-only placeholders to replace

Each is marked `RL-0 placeholder` in the code.

| Where                                                                             | What it does now                                                                                                                         | Who replaces it                                                                                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/orchestrator/src/transitions.ts` `AGENT_TRANSITIONS.AWAITING_REVIEW`    | outgoing edges only (`STARTING, SUCCEEDED, FAILED, CANCELLED, NEEDS_REVIEW`); **no edge into it**, so it is unreachable but not terminal | RL-A: add RUNNING/STARTING/BLOCKED → AWAITING_REVIEW; update `tests/transitions.test.ts` `EXPECTED_AGENT` (also a placeholder entry) |
| `packages/orchestrator/src/lead-tools.ts` `leadToolCall`                          | the six new tools are refused with `run-not-active` ("This run has no review loop…") after the caller checks                             | RL-A                                                                                                                                 |
| `packages/orchestrator/src/lead-tools.ts` `controlToolsFor`                       | the lead's list leaves out `REVIEW_LOOP_TOOL_NAMES`; the reviewer still gets only `post_review`                                          | RL-A (lead with the loop: + `CHANGE_DECISION_TOOL_NAMES`; change reviewer: `submit_review`)                                          |
| `packages/adapters/claude-code/src/managed/permissions.ts` `LEAD_ROLE_TOOL_NAMES` | leaves out `REVIEW_LOOP_TOOL_NAMES`, so no MCP server offers them; tests in `tests/managed/{permissions,adapter}.test.ts` assert this    | RL-B (`managedToolNames` by `reviewScope`/run)                                                                                       |
| `packages/adapters/claude-code/src/managed/lead-tools.ts` `DESCRIPTIONS`, `all`   | descriptions and tool definitions for the six tools (needed by `Record<LeadToolName, …>`)                                                | RL-B may reword                                                                                                                      |
| `packages/server/src/control/service.ts` `reviewAction`                           | `action: 'rework'` → 409 `rework_unavailable`, before any merge path (test in `tests/board/flow.test.ts`)                                | RL-B                                                                                                                                 |
| `packages/web/src/lib/copy.ts` `AGENT_STATUS_COPY.AWAITING_REVIEW`                | "Waiting for review" (tone `waiting`)                                                                                                    | RL-D (final wording)                                                                                                                 |

Not changed and worth knowing: `packages/web/src/features/control/run-state.ts` `LIVE_AGENT` does not
include `AWAITING_REVIEW` (it is not "live" for Stop buttons: no process runs) — RL-D decides.
`isLiveAgentStatus('AWAITING_REVIEW')` is `true` in the engine because it has outgoing edges; RL-A's
`isActiveAgent` must exclude it (README §5).

### 3. Proposed engine signatures (RL-A exports, RL-B calls) — agreed stubs

All follow the existing style: pure, `(state, …, ctx) => EngineResult<T>`, refusals with codes,
effects in order. New refusal codes RL-A will likely need: `change-not-found`,
`change-not-decidable`, `rework-limit`, `merge-conflict`, `checks-pending`, `checks-failed`,
`changes-undecided`, `handed-over`.

```ts
// RunState additions (RL-A, README §5)
interface RunIntegration {
  reviewer: ChangeReviewerMode;
  maxReworkRounds: number;
  handedOver: boolean;
}
interface EngineChange {
  state: ChangeState;
  round: number;
  verdict: ChangeVerdict | null;
  reviewerAgentRunId: string | null;
}
// RunState.integration?: RunIntegration; RunState.approvalPolicy?: ProjectApprovals
// EngineAgent.change?: EngineChange; EngineAgent.reviewsAgentRunId?: string

/** Server: the seal effect finished. `changed` false → `no-changes` and the agent SUCCEEDED. */
export function changeSealed(
  state: RunState,
  agentRunId: string,
  result: { changed: boolean; headCommit: string | null; changedFiles: number | null },
  ctx: EngineContext,
): EngineResult;

/** Before the server merges (lead `merge_change` or owner `merge`/`merge-anyway`): may it? */
export function checkChangeAction(
  state: RunState,
  agentRunId: string,
  action: 'merge' | 'merge-anyway' | 'rework' | 'discard',
  by: ChangeDecider,
): Refusal | null;

/** After the server acted (merged into the ticket branch, discarded, …). Records the round. */
export function recordChangeDecision(
  state: RunState,
  agentRunId: string,
  decision: {
    decision: ChangeDecision;
    by: ChangeDecider;
    outcome?: 'merged' | 'discarded' | 'no-changes';
    comments?: string;
    headCommit?: string;
  },
  ctx: EngineContext,
): EngineResult;

/** Server: the required checks on `commit` finished; messages the lead, may unblock a merge. */
export function checksFinished(
  state: RunState,
  agentRunId: string | null /* null = ticket tip */,
  result: { commit: string; requiredPassed: boolean; failed: readonly string[] },
  ctx: EngineContext,
): EngineResult;

/** Gate re-check (README §6): is this rule allowed under the run's mode? */
export function ruleAllowedByMode(mode: ApprovalMode, rule: AllowRule): boolean;
/** Pure command matcher; build on isSafeCommandToken / isForbiddenGitOption from core. */
export function matchCommandAllowlist(
  command: string,
  patterns: readonly CommandPattern[],
): CommandPattern | null;
/** evaluateAllowlist gains the policy instead of the legacy allowlist. */
export interface AllowlistInput {
  policy: ProjectApprovals; /* …existing fields */
}
```

**New and changed `EngineEffect`s:**

```ts
| { type: 'seal-change'; agentRunId: string }                       // commit the worktree; then changeSealed
| { type: 'create-ticket-branch'; ticketKey: string }               // at plan approval (both planner modes), before helpers
| { type: 'create-review-checkout'; agentRunId: string; commit?: string } // commit set: detached checkout of the sealed change (change reviewer); absent: today's main-branch checkout
| { type: 'start-agent'; …existing; rework?: { resumeSessionId: string | null }; reviewScope?: ReviewScope }
| { type: 'integrate-change'; agentRunId: string }                  // optional split of merge_change; or keep the merge in the server
```

`start-agent{rework}` maps to `ManagedAgentSpec.rework` (never with `canStartHelpers`);
`reviewScope: 'change'` maps to `ManagedAgentSpec.reviewScope` and the adapter gives
`CHANGE_REVIEWER_TOOL_NAMES`. The existing `review-comment` effect carries the reviewer's findings
(RL-B links the comment to the `change_reviews` row).

### 4. Storage notes for RL-B

- Approvals, the review stage settings and the run's snapshot stay in JSON: extend
  `StoredRunSnapshotParser` (`packages/db/src/repositories/redesign/run-audit.ts`) with
  `approvals?: ProjectApprovals` and `integration?: { reviewer, maxReworkRounds, handedOver }`.
- `CheckRunInsertInput` is `Omit<CheckRun, 'id'>`, so it now accepts `commit`, but the repository
  does not store it yet: write it to `check_runs.commit_sha` and read it back as `commit`.
- `ticket_branches` references `orchestration_runs (project_id, id)` (new unique index
  `orchestration_runs_project_run`), so insert with the run's own project.
- `change_reviews.decision`, `decided_by` and `decided_at` must be set together (CHECK).

## Blockers / proposed contract changes

_None blocking._ Points for the coordinator to confirm (also in ADR-0021 "Open points"):

1. **Legacy mapping widens one case:** a project with `editInOwnWorktree: true`,
   `runHarnessChecks: false` maps to `auto-edits`, which auto-approves exact harness checks.
   Followed README §3 literally; the alternative is to map that case to `manual`.
2. **`check_runs.commit_sha`**, not `commit`: `commit` is an SQL keyword (`ADD COLUMN commit`
   fails). The TypeScript field is still `CheckRun.commit`.
3. **Enum columns are length-checked, not value-checked**, as 0002–0005 document ("validated with
   Zod … so a later value needs no rebuild"). The brief asked for CHECKs on enums; structural
   CHECKs (commits, counters, merged-iff-merged_commit, decided-together) are in.
4. **Additions beyond README §3:** `RunDetailDto.changes?` (the change cards need a source),
   `TicketBranchActionRequest` action `update-from-base` ("Update from main", README §6),
   `CheckRun.commit?`, `GitCommitSchema`, `TicketBranchNameSchema`/`ticketBranchName`,
   `FINAL_CHANGE_STATES`, `reviewStageOf`, `isSafeCommandToken`, `isForbiddenGitOption`, and the
   tool-name lists. More forbidden commands than listed (`mksh`, `ash`, `busybox`, `pwsh`,
   `setsid`, `stdbuf`, `chroot`, `sftp`, `ncat`, `netcat`, `socat`, `telnet`) and more forbidden
   git options (`-O`, `--open-files-in-pager`, `--ext-diff`, `--output`: they run a program or
   write a file).
5. **Review-stage fields are `.optional()` + `reviewStageOf()`, not zod `.default()`:** a default
   makes them required in `ProjectWorkflow`'s output type and breaks typed literals in the web
   (`workflowView`) and orchestrator tests. Same back-compat, no consumer changes.

## Completion report (AGENTS.md §9)

## Completion report — RL-0

1. **Summary:** the additive `@acp/core` contract for ADR-0021 with contract tests, migration 0006
   with its tests, and ADR-0021 (proposed) with pointers in the ADRs it amends. No behaviour
   changes: compile-only placeholders keep the new paths unreachable.
2. **Files changed:**
   - created: `packages/core/tests/review-loop-contracts.test.ts`,
     `packages/db/src/migrations/0006_review_loop.sql`,
     `packages/db/tests/review-loop/migration-0006.test.ts`,
     `docs/decisions/0021-approval-modes-review-loop-ticket-branch.md`,
     `docs/review-loop/wp/RL-0.md`;
   - modified (core): `src/workspace/workspace.ts`, `src/workspace/workflow.ts`,
     `src/orchestration/orchestration.ts`, `src/adapters/managed.ts`, `src/api/orchestration.ts`,
     `src/api/workspace.ts`, `src/api/redesign.ts`, `tests/orchestration-contracts.test.ts`;
   - modified (placeholders, §2 above): `packages/orchestrator/src/{transitions,lead-tools}.ts`,
     `packages/orchestrator/tests/transitions.test.ts`,
     `packages/adapters/claude-code/src/managed/{lead-tools,permissions}.ts`,
     `packages/adapters/claude-code/tests/managed/{adapter,permissions}.test.ts`,
     `packages/server/src/control/service.ts`, `packages/server/tests/board/flow.test.ts`,
     `packages/web/src/lib/copy.ts`;
   - modified (db tests): `tests/schema.test.ts`, `tests/__snapshots__/schema.test.ts.snap`
     (additions only), `tests/redesign/migration-0005.test.ts` (version list now a prefix);
   - modified (docs): `docs/decisions/README.md`, ADR-0013, 0016, 0017, 0019, 0020 (pointers only).
3. **Commands run and actual results** (`pnpm check` from the root, Node 22.21.1, pnpm 10.26.1):
   format:check ✓; lint ✓ (0 warnings); typecheck ✓ (7 packages); test ✓ 2291 passed (core 285,
   adapter-demo 12, orchestrator 472, adapter-claude-code 323, db 175, web 605, server 419); build ✓.
   The core commit alone was also checked with 0006 set aside: 2284 passed.
4. **Acceptance criteria:**
   - every README §3 schema/type/constant/helper exists and is exported → met (§1 above);
   - additive and backward compatible; `pnpm check` passes → met (legacy setups, workflows, run
     details, approvals and review requests parse; tests in `review-loop-contracts.test.ts`);
   - exhaustive switches/Records over `AgentRunStatus` and `LeadToolName` → met with the
     placeholders in §2 (orchestrator transitions and lead tools, adapter lead tools, web copy),
     plus the server `rework` guard;
   - command-pattern refusal tests (metacharacters, absolute paths, `..`, forbidden commands, git
     non-read-only and `-c`/`-C`, fuzz) → met;
   - `approvalsFromLegacy`, labels complete → met;
   - migration 0006 STRICT, constraints, FKs, indexes; applies fresh and on a 0005 DB with data,
     old rows intact; snapshot reviewed → met (`migration-0006.test.ts`); no repositories → met;
   - ADR-0021 drafted with Context, Decision, Safety, Alternatives, Consequences; index row;
     pointers → met;
   - handoff with names, placeholders and engine signatures → met (this file).
5. **Assumptions:** see "Blockers / proposed contract changes" 1–5 (documented here and in
   ADR-0021).
6. **Contract or shared-file changes needed:** none beyond this WP. `docs/decisions/**` was edited
   as the coordinator's RL-0 task. `docs/review-loop/STATUS.md` was not edited.
7. **Known gaps / follow-ups:** the placeholders in §2; the db repositories for the new tables and
   columns (RL-B); `matchCommandAllowlist`/`ruleAllowedByMode` (RL-A); the per-run snapshot parser
   (RL-B); ADR-0021 acceptance by the coordinator/owner.
8. **Next recommended task:** RL-A (engine) against §3's signatures; RL-B can start in parallel on
   the git flows and repositories using the stubs in §3.
