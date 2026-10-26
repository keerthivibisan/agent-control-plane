# Approval modes, review loop and ticket branch (RL series, v0.1.0)

> **History.** This plan is kept for provenance: it records how this part of the app was planned and built with coding agents. It is not maintained, and parts of it are superseded by the specs and ADRs. Its status log and progress files were removed in v0.3.1; read them at tag `v0.3.0` (`git show v0.3.0:docs/review-loop/STATUS.md`). See [docs/history/README.md](../README.md).

> Status: `STATUS.md` (at tag `v0.3.0`: `docs/review-loop/STATUS.md`). Progress files: `wp/RL-*.md`, one per work package, edited only by
> its agent. The decision record is ADR-0021. Built on `feature/ui-refresh`, in the same 0.1.0
> release as the UI refresh.

## 1. Context and owner decisions (2026-10-17)

Testing real runs, the owner found two problems:

- helpers ask for approval on every action;
- each helper's change is merged into `main` by the owner one at a time, which means review and
  merge depend on the owner.

**Decisions:**

1. **Approval modes per ticket run.** The default comes from the project and can be overridden
   when a ticket run starts:
   - **Manual:** asks for everything, including harness checks.
   - **Auto edits:** Edit/Write inside the helper's own worktree, plus commands that exactly match
     a harness check, run without asking. This is the default for **new** projects only;
     existing projects keep their current setting.
   - **Auto:** Auto edits plus a per-project command allowlist.

   The **lead never approves tool requests**: approvals stay deterministic rules applied by the
   gate and the server.

2. **Review loop before merge.** When a helper finishes:
   - a reviewer reviews the change: a read-only **review agent** by default, or the lead;
   - the **lead decides**: merge into a **ticket branch** `acp/<KEY>`, send back for rework (at
     most 2 rounds by default), discard, or ask the owner;
   - required harness checks still gate each merge;
   - the final code review and unit tests run on the ticket branch;
   - the **owner merges the ticket branch into `main` once**: Merge, Merge anyway (with a
     reason), Request changes or Discard.
3. **Reviewer findings and the lead's rework and discard notes are stored as ticket comments.**
   No tool output or thinking is stored.
4. **Fixes:**
   - plan steps go to helpers only; a step for the lead is refused, since the lead is read-only;
   - the raw tool names in an agent's "Latest" line become readable labels.
5. **Coordinator defaults the owner can still change:**
   - Manual asks before harness checks too;
   - in the command allowlist, `git` is limited to read-only subcommands, while an `npm` or `mvn`
     prefix allows any arguments.

## 2. Today (file:line, at `cabf4e5`)

**From a helper finishing to COMPLETED:**

- `agentEvent` finished (orchestrator/commands.ts:346-375). Then `setAgentStatus` sets
  `review='pending'` (draft.ts:157-167).
- `reconcile` moves the run to REVIEW (draft.ts:344-358), or `request_review` does (commands.ts:660-670).
- The server runs the harness checks in each helper worktree (board/service.ts:320-347).
- The owner merges each change through `reviewAction` → `applyReview` → `WorkspaceManager.merge`,
  which does `merge --ff-only` into the owner's base branch (control/service.ts:1453-1508,
  1747-1803; workspace/manager.ts:328-415). The engine records it in `recordReview` (commands.ts:676-692).
- The post-merge stages follow (draft.ts:363-426): `startStage` stops the lead, and the reviewer
  reads a detached owner HEAD.

**Approvals:**

- The gate is `createCanUseTool` (adapters/claude-code/src/managed/permissions.ts:305-366).
- Server: `askOwner` → `allowlistVerdict` (control/allowlist.ts:63-78) → `evaluateAllowlist`
  (orchestrator/allowlist.ts:119-156) → engine `requestPermission` (commands.ts:395-464). An
  allowlist hit is recorded as `decidedBy:'allowlist'`.
- The allowlist `{editInOwnWorktree, runHarnessChecks}` is stored in `project_setup.setup`, read
  live on every request, and shown on the Workflow Helpers panel ("Pre-approved actions") and in
  the wizard.

**Bugs:**

- The prompts say `"Lead" for steps you do yourself` (plan.ts:221, 299).
- `summarizeToolUse` passes `mcp__acp__*` names through unchanged (adapter summary.ts:58-69).

## 3. Contract (`@acp/core`, coordinator commit RL-0; additive so everything still compiles)

**workspace.ts:**

- `ApprovalModeSchema = 'manual'|'auto-edits'|'auto'`.
- `CommandTokenSchema`: `^[A-Za-z0-9._/:=@+%,-]{1,200}$`; no absolute path and no `..`.
- `FORBIDDEN_ALLOWLIST_COMMANDS`: shells, `env`, `sudo`/`su`/`doas`, `xargs`, `eval`/`exec`,
  `command`/`builtin`, `nohup`/`timeout`/`nice`/`time`/`watch`, `cd`/`export`/`alias`/`source`/
  `set`/`unset`, `ssh`/`scp`/`rsync`, `curl`/`wget`, `nc`.
- `GIT_READ_ONLY_SUBCOMMANDS`: status, diff, log, show, rev-parse, ls-files, blame, grep.
- `CommandPatternSchema {argv: 1..8 tokens, match: 'exact'|'prefix'}`, refined so that argv[0]
  is bare and not forbidden, and `git` needs a read-only subcommand.
- `MAX_COMMAND_PATTERNS = 30`.
- `ProjectApprovalsSchema {mode, commands}` and `approvalsFromLegacy(allowlist)`: edits on →
  `auto-edits`, else `manual`.
- `ProjectAgentSetup.approvals` is optional, and `approvalsOf(setup)` falls back to the legacy
  mapping. The legacy `allowlist` field stays until RL-B/RL-D move off it.
- The `PlanStepSchema` doc says the role is the helper role that does the step.

**workflow.ts:** the `review` stage gains `reviewer: 'agent'|'lead'` (default `'agent'`),
`maxReworkRounds` 0..5 (default 2), and the agent-stage fields model, skill and agent (default
null). `stagesUsingSkill` and `stagesUsingAgent` cover `review`.

**orchestration.ts:**

- `AgentRunStatus += 'AWAITING_REVIEW'` (no process runs, not terminal).
- `ChangeStateSchema`: sealing, ready, reviewing, decision, rework, needs-owner, merged,
  discarded, no-changes.
- `LeadToolInputs += view_change {agentId}`, `merge_change {agentId}`,
  `request_rework {agentId, comments 1..4000}`, `discard_change {agentId, reason 1..500}`,
  `ask_owner {agentId, question 1..2000}`.
- The change reviewer gets `submit_review {verdict: 'approve'|'rework', findings 1..8000}`.
- `request_review` now means "every change is decided; hand over".

**adapters/managed.ts:** `ManagedAgentSpec.rework?: {resumeSessionId: string|null}` and
`reviewScope?: 'change'|'final'`.

**api:**

- `ChangeReviewDto`, `TicketBranchDto`.
- `RunDetailDto += approvalMode?, ticketBranch?`.
- `ApprovalDto += allowRule?`.
- `ReviewActionRequest += 'rework'`.
- `TicketBranchReviewDto`.
- `TicketBranchActionRequest {action: merge|merge-anyway|discard|request-changes, reason?, comment?}`.
- `RunWorkflowDto += review?` counts.
- `UpdateProjectSetupRequest += approvals?`.
- `StartTicketRequest {approvalMode?, reviewer?, maxReworkRounds?}`.

**Shared:** `CONTROL_TOOL_LABELS`, for example `agent_status` → "Checked a helper's status".

## 4. Migration `0006_review_loop.sql`

- **New tables:**
  - `ticket_branches`: `run_id` primary key with cascade, `project_id`, `branch`, `base_branch`,
    `base_commit`, `head_commit`, `state` (`open|merged|discarded`), `merged_commit`,
    timestamps. A unique index on `branch` where `state='open'`.
  - `change_reviews`: `id`, `run_id`, `agent_run_id`, `round`, `reviewer`
    (`agent|lead|owner`), `reviewer_agent_run_id`, `verdict`, `decision`, `decided_by`,
    `comment_id` (nullable foreign key to `ticket_comments`), `created_at`, `decided_at`. It
    holds no conversation text.
- **New columns:**
  - `managed_workspaces`: `change_state`, `rework_rounds` (default 0) and `head_commit`;
  - `check_runs.commit`;
  - `approvals.allow_rule`.
- **Kept in JSON:** approvals, review config and the per-run snapshot. Earlier migrations are
  never edited.

## 5. Engine (RL-A)

**State:**

- `RunState.integration? {reviewer, maxReworkRounds, handedOver}`. When it is absent, the run uses
  the legacy flow.
- `RunState.approvalPolicy? {mode, commands}`.
- `EngineAgent.change? {state, round, verdict, reviewerAgentRunId}` and `reviewsAgentRunId?`.

**New edges:**

- Agent: RUNNING/STARTING/BLOCKED → AWAITING_REVIEW. AWAITING_REVIEW →
  STARTING (rework) / SUCCEEDED / CANCELLED / FAILED / NEEDS_REVIEW (restart).
- Run: REVIEW → RUNNING, only for the owner's "request changes" while the lead is live.
- `isActiveAgent` means live and not AWAITING_REVIEW. It is used for concurrency,
  `liveWorkers()` and BLOCKED.

**Loop:**

1. A worker or tester that finishes goes to AWAITING_REVIEW and `seal-change`.
2. `changeSealed(id,{changed})`: a change becomes `ready`; no change becomes `no-changes` and
   SUCCEEDED.
3. `reconcile` handles the oldest `ready` change first:
   - with reviewer `agent` and a free slot: `create-review-checkout{agentRunId, commit}` and
     `start-agent` with the review stage's skill, agent file and model;
   - with reviewer `lead`: an engine message to the lead.
4. `submit_review` emits a `review-comment` and passes the verdict and findings to the lead.
5. The lead uses `merge_change`, `request_rework`, `discard_change` or `ask_owner`:
   - `merge_change`: `checkChangeAction`, then the server merges, then `recordChangeDecision`.
   - `request_rework` is refused when rounds ≥ max, over budget, or with no free slot. Otherwise
     the round goes up by 1, the agent goes to STARTING, and `start-agent{rework}`. A rework turn
     never gets `canStartHelpers`.
   - `ask_owner` counts toward "needs you". The owner can make the same decisions, recorded as
     `decidedBy: owner`, and can grant a round past the limit.

**Handover and the final stages:**

- `request_review` is refused while any helper is live or any change is undecided. Otherwise it
  sets `handedOver`, and `start_agent` is refused from then on.
- The final code review and the unit tests run on the ticket branch while the run stays RUNNING
  and the lead stays live. The final reviewer reads a detached tip and `post_review` sends to the
  lead. The tester starts from the tip and goes through the loop.
- When no stage is left, the run goes to REVIEW for the owner's final merge.
- If the lead ends early, unfinished changes go to `needs-owner` and the run to REVIEW.

**Stops, restart and limits:**

- Stop all: AWAITING_REVIEW agents become CANCELLED, and the ticket branch stays open (it can
  only be discarded).
- Restart: AWAITING_REVIEW agents and change reviewers become NEEDS_REVIEW, and unfinished
  changes `needs-owner`. Nothing is relaunched.
- Separate-planner mode: `decidePlan(approve)` emits `create-ticket-branch` before the lead
  starts.
- Depth 2: every change goes through the loop.
- Budgets:
  - a change reviewer has its own budget and counts as one helper;
  - rework uses the helper's own budget;
  - `view_change` returns at most 32 KiB.

**Fixes:**

- The plan prompts give every step to a helper role. `submitPlan` refuses the roles lead,
  the lead, planner and orchestrator.
- Labels: the adapter uses `CONTROL_TOOL_LABELS`, and the engine writes specific lines such as
  "Checked on API builder" or "Merged API builder into acp/WEB-12".

## 6. Server, git and adapter (RL-B)

**Git:** argument arrays only, with `SAFE_GIT_CONFIG` and `COMMIT_CONFIG`.

**WorkspaceManager:**

- `createTicketBranch`: `symbolic-ref`, `rev-parse`, then `branch --no-track` with the name
  `acp/<KEY>` or `acp/<KEY>-r<n>`, checked against `^acp/[A-Z]{2,6}-[1-9]\d*(-r[1-9]\d*)?$`. It
  happens at plan approval.
- `create(..., {from})`: helper and tester worktrees start from the ticket tip.
- `seal`.
- `integrate`: `merge --no-ff` of the ticket tip in the helper's worktree. On a conflict it
  records the conflicting file names and aborts.
- `advanceTicketBranch`: after an `--is-ancestor` check and a check that the branch is not
  checked out (`worktree list`), a compare-and-swap `update-ref`.

**`merge_change`:**

1. Seal.
2. No difference from the tip: `no-changes`.
3. Integrate. On a conflict, refuse with `merge-conflict` and the file names.
4. Require that the required checks passed on this commit, or start them; `checksFinished` then
   messages the lead.
5. Advance the ticket branch and release the worktree.
6. **F-2:** a ticket branch moved outside the app (`ticket-branch-moved`) or checked out in
   another folder (`ticket-branch-checked-out`) sends the change to the owner at once, and the
   lead is told not to retry (only the owner can reset or free the branch). A merge that fails
   for a git reason (`failed`) is offered "Try again" until it failed `MAX_FAILED_MERGES` (3)
   times in a row; then the change goes to the owner.

**Bounds after lost work (F-2):** a change whose seal failed for any reason waits for the owner
(`needs-owner`, or `decision` for F-1's switched branch), and the lead may discard it, never merge
or rework it. A helper whose change was discarded or could not be saved is a lost attempt. A plan
step (its helper node and role) may lose `max(2, 1 + maxReworkRounds)` attempts (times the plan's
steps with that role), and the run that many times its plan steps; then `start_agent` is refused
(`attempts-exhausted`) and the lead hands over. Merged and no-change work never counts.

**Checks:** run on each sealed or integrated helper commit, and on the ticket tip at REVIEW (a
detached temporary checkout), stored with `commit`.

**Final merge:**

- `GET /api/runs/:id/ticket-branch` returns `diff base..tip` and the checks.
- `POST` (CSRF) with:
  - `merge`: the owner's tree must be clean and on the base branch, then
    `merge --ff-only <tip>` and `branch -d`. If `base-moved`, it offers "Update from main" (a
    merge in a temporary worktree, then the checks again).
  - `discard`: `branch -D` and the worktrees are cleaned up.
  - `request-changes`: the comment goes to the lead and the run returns to RUNNING.
- Then COMPLETED and the ticket DONE.
- Open branches are kept for NEEDS_REVIEW and CANCELLED runs. Unknown `acp/*` refs are never
  deleted.

**startTicket:** reads `StartTicketRequest` and snapshots the approvals and review settings into
the run.

**Gate:**

- Workers and testers only:
  - manual: ask;
  - auto-edits: auto-approve an edit whose real path is in its own worktree, not under `.git` or
    `.claude`, and an exact harness-check command;
  - auto: auto-edits plus `matchCommandAllowlist`.
- `matchCommandAllowlist`: the whole command matches
  `^[A-Za-z0-9._/:=@+%,-]+( [A-Za-z0-9._/:=@+%,-]+)*$`, argv[0] is bare, no token is an absolute
  path or contains `..`, and the call is not `run_in_background`. For `git`: no `-c`, `-C` or
  `--git-dir`/`--work-tree`/`--exec-path`/`--config-env`, and a read-only subcommand.
- The engine checks again with `ruleAllowedByMode` and records `allowRule`.
- Tools:
  - the lead gets the five change tools;
  - the change reviewer gets read-only tools plus `submit_review`, reading a detached checkout of
    the sealed commit, with a brief that includes a diff of at most 64 KiB (sent, never stored);
  - a rework turn resumes the helper's session in its own worktree.

## 7. Web (RL-D)

- **Workflow page:**
  - Helpers panel: **Approvals**, with the mode (Manual / Auto edits (recommended) / Auto), a
    command list editor, and a plain warning that agent-written code can run unasked.
  - Review panel: reviewer (Review agent / Lead), rework rounds, and the review agent's skill,
    agent file and model.
- **Start dialog:** a per-run override of the mode, reviewer and rounds.
- **Wizard:** the mode.
- **Settings:** a summary that links to Workflow.
- **Ticket:**
  - Changes tab: change cards with the state chip, checks, reviewer findings, decision history
    and conflict files. The owner's override buttons show only for `needs-owner` changes or when
    there is no lead.
  - A ticket-branch card: the combined diff, checks, and Merge into main / Merge anyway (with a
    reason) / Request changes / Discard.
- **Live graph:** review counts, a "rework ×n" edge, an "Owner merges" gate, and "Waiting for
  review".
- **Copy:** the new statuses and "Auto (allowlist: command)".

## 8. ADR-0021 (proposed, then accepted by the owner)

**Decisions:**

1. Approval modes, snapshotted per run (amends ADR-0013 §4).
2. The command allowlist and its format.
3. The review loop.
4. The ticket branch and the owner's single final merge (amends ADR-0013 §5 and ADR-0017 §4).
5. The final stages run on the ticket branch before the owner's merge, and the lead stays live
   (amends ADR-0019 §2–3 and the ADR-0020 context).
6. Stored scope (amends ADR-0016): findings and the lead's notes as ticket comments.

**Safety:**

- The lead only moves its run's ref, through server-side compare-and-swap.
- `main` changes only on the owner's click, as a clean fast-forward.
- The lead never approves tool requests.
- Under Auto edits and Auto, agent-written code can run unasked with the owner's privileges, as
  ADR-0017 already accepts for checks.

## 9. Work packages

| WP   | Who                    | Owned paths                                                                                                                       | After      |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RL-0 | coordinator            | ADR-0021, `packages/core/src/**` contract (additive), `packages/db/src/migrations/0006_review_loop.sql` and its schema test, docs | —          |
| RL-A | engine                 | `packages/orchestrator/src/**` and tests                                                                                          | RL-0       |
| RL-B | server, db and adapter | `packages/server/src/**`, `packages/db/src/repositories/**`, `packages/adapters/claude-code/src/managed/**` and tests             | RL-0, RL-A |
| RL-D | web                    | `packages/web/src/**` and tests and e2e                                                                                           | RL-0, U-V  |
| RL-V | verification           | one consented real run: two helpers, one rework, review agent, auto-edits mode, one final merge                                   | all        |
| RL-G | full auto              | core `ApprovalMode` (additive), `packages/{orchestrator,adapters/claude-code,server,web,db}/src/**` and tests, ADR-0022, docs     | RL-V       |

**Order:**

- RL-A runs first against the contract. RL-B starts after RL-A's exported signatures exist
  (`checkChangeAction`, `changeSealed`, `recordChangeDecision`, `checksFinished`,
  `evaluateAllowlist(policy)`, `matchCommandAllowlist`), or in parallel with stubs agreed in the
  RL-0 handoff.
- RL-D starts after U-V merges, using fixtures.

**Tests:** fake adapters everywhere, plus real temporary git repos for the git flows. Listed per
WP in the design notes (§5–§7).

## 10. Full auto (RL-G, ADR-0022 proposed)

Owner decision (2026-10-17, STATUS.md): a mode where the owner sees only the final ticket-branch
merge.

- **Mode:** `full-auto` ("Full auto"), a fourth `ApprovalMode`: the project default (Workflow
  page, wizard) or a per-run choice (Start dialog), snapshotted with the run.
- **Plan:** `submit_plan` approves it in the same command (lead or planner). The plan records
  `decidedBy: 'auto'` (kept in the run snapshot as `autoApprovedPlanId`); the ticket page shows
  "Approved automatically (Full auto)". An author over budget leaves it for the owner.
- **Helpers and the tester** (adapter): `permissionMode: 'auto'` plus `sandbox` (`enabled`,
  `failIfUnavailable`, `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: false`,
  writes only in the worktree and `<dataDir>/sandbox-tmp/<runId>`, `.git`/`.claude` in the
  worktree not writable, the credentials folders, the data folder and Claude's config unreadable;
  no network block, the classifier decides), file-tool deny rules, and `TMPDIR` in the temp folder.
- **Fail closed:** a session whose `system/init` is not in `auto`, or a sandbox that cannot start,
  ends the agent with `failure: 'auto-mode-unavailable' | 'sandbox-unavailable'`, a readable Latest
  line, a `full-auto-unavailable` diagnostic and a note to the lead.
- **Gate:** what still reaches it for a helper or tester runs only by the Auto edits rules and is
  otherwise denied at once (`full-auto-denied`); the command allowlist never overrides the
  classifier; nothing is parked for the owner.
- **Unchanged:** the lead, planner and reviewers (default mode, read-only); no subagents; the
  review loop; `main` changes only on the owner's merge.
- **Real run:** `ACP_REAL_RUN=1 ACP_REAL_RUN_MODE=full-auto` with the RL-V driver, only after the
  owner's consent in chat.

## 11. Ticket-level run options (RL-H)

Owner decision (2026-10-17, STATUS.md): a ticket can keep its own run options, "if we need some
ticket to be manual".

- **Options:** approval mode, reviewer (review agent or lead) and rework rounds. Each is "Project
  default" unless set; an unset option follows the project, also after a project change.
- **Precedence when a run starts:** the one-run override (`StartTicketRequest`, "Start with
  options…") > the ticket's options > the project's settings (`resolveRunOptions` in core). The
  run snapshots the result, as before; changing the ticket later never reaches a started run. The
  command allowlist stays the project's.
- **Contract (additive):** `TicketRunOptionsSchema {approvalMode?, reviewer?, maxReworkRounds?}`;
  `Ticket.runOptions?` (so `TicketDto` and `TicketCardDto`); `CreateTicketRequest.runOptions?`;
  `UpdateTicketRequest.runOptions?` as a patch where `null` puts an option back to the project
  default (and `runOptions: null` clears all).
- **Storage:** migration `0007_ticket_run_options.sql`, a nullable JSON column
  `tickets.run_options` (NULL = all project default), read and written by
  `createReviewLoopRepositories().ticketRunOptions` so the Phase 4 tickets repository stays as
  shipped.
- **Web:** the New ticket dialog (approvals visible, reviewer and rounds under "More options",
  each "Project default (<value>)"); the ticket page's Run options (view and Change); a board
  badge when the ticket's options differ from the project's; the Start dialog starts at the
  ticket's options and marks them "This ticket".
