# ADR-0021: Approval modes, the review loop and the ticket branch

- **Status:** accepted — owner decisions in chat 2026-10-17 (docs/review-loop/README.md §1); accepted by the coordinator on those decisions
- **Date:** 2026-10-17
- **Deciders:** project owner (decisions, docs/review-loop/STATUS.md); coordinator (RL-0 draft)
- **Amends:** ADR-0013 §4–§5 and its 2026-10-13 amendment, ADR-0016 (stored text), ADR-0017 §4,
  ADR-0019 §2–§3, the ADR-0020 context
- **Plan:** [docs/review-loop/README.md](../review-loop/README.md) (RL series, v0.1.0)

## Context

Real ticket runs showed two problems (owner, 2026-10-17):

- **Approvals on every action.** Each helper asks the owner for every edit and command. The
  per-project allowlist (ADR-0013 amendment: `editInOwnWorktree`, `runHarnessChecks`) helps, but it
  is two switches with no per-run choice and no way to allow ordinary build commands.
- **The owner merges each change.** Every helper's change is merged into the owner's base branch
  one at a time (`reviewAction` → `WorkspaceManager.merge`, `merge --ff-only`), so review and merge
  wait on the owner, and later helpers start from a base that lacks earlier changes.

Today (docs/review-loop/README.md §2): a helper that finishes gets `review = 'pending'`; the run moves
to REVIEW once every helper has stopped (or the lead calls `request_review`); the server runs the
harness checks in each worktree; the owner merges or discards each change; the final code review
and unit tests (ADR-0019) run after those merges, and the engine stops the lead when they start
(the reason ADR-0020 exists).

## Decision

1. **Approval modes, snapshotted per run** (amends ADR-0013 §4 and its allowlist amendment).
   - `ApprovalMode` is `manual | auto-edits | auto`. A project holds a default
     (`ProjectAgentSetup.approvals.mode`); a ticket run may override it at start
     (`StartTicketRequest.approvalMode`). The run snapshots the result and keeps it for its whole
     life: changing the project later never changes a running run.
   - **Manual:** every edit, write and command asks, harness checks included.
   - **Auto edits:** Edit/Write/MultiEdit/NotebookEdit whose real path (realpath, no symlink escape)
     is inside the agent's own worktree and not under `.git` or `.claude`, plus a Bash call whose
     command exactly equals a harness check's argv joined by single spaces, run without asking.
   - **Auto:** Auto edits plus the project's command allowlist (decision 2).
   - Only **workers and testers** are covered. The lead, the planner and every reviewer always ask
     for anything not read-only. **The lead never approves a tool request**: approvals stay
     deterministic rules applied by the gate and checked again by the engine, which records the rule
     (`allowRule`: `edit-in-own-worktree | run-harness-check | command-allowlist`) on an approval
     decided by `allowlist`.
   - **New projects** start on `auto-edits` (`DEFAULT_APPROVAL_MODE`). **Existing projects** keep
     their behaviour: a setup without `approvals` maps from its legacy allowlist
     (`approvalsFromLegacy`: only a setup that pre-approved both edits and harness checks becomes `auto-edits`; any other mix becomes `manual`, so a legacy setup is never widened; no commands). The legacy
     `allowlist` field stays until the server and web move off it.

2. **The command allowlist and its format.** At most `MAX_COMMAND_PATTERNS = 30` patterns per
   project, each `{ argv, match }`:
   - `argv` is 1–8 tokens matching `^[A-Za-z0-9._/:=@+%,-]{1,200}$`; no token is an absolute path
     (also not after `=`, `:`, `,` or `@`) or contains `..`;
   - `argv[0]` is a bare command name (`^[a-z0-9][a-z0-9._-]*$`) and not one of
     `FORBIDDEN_ALLOWLIST_COMMANDS` (shells, `env`, `sudo`/`su`/`doas`, `xargs`, `eval`/`exec`,
     `command`/`builtin`, `nohup`/`timeout`/`nice`/`time`/`watch` and similar wrappers,
     `cd`/`export`/`alias`/`source`/`set`/`unset`, `ssh`/`scp`/`sftp`/`rsync`, `curl`/`wget`,
     `nc` and other socket tools);
   - `git` must be followed by one of `GIT_READ_ONLY_SUBCOMMANDS` (status, diff, log, show,
     rev-parse, ls-files, blame, grep), and no token may be `-c`, `-C`, `--git-dir`,
     `--work-tree`, `--exec-path`, `--config-env`, `-O…`/`--open-files-in-pager`, `--ext-diff` or
     `--output` (they change what git acts on, run a program, or write a file);
   - `match: 'exact'` allows exactly these words; `match: 'prefix'` allows these words followed by
     any further safe tokens. Owner default: an `npm` or `mvn` prefix allows any arguments.
   - The gate matches the **actual** command the same way: the whole command matches
     `^[A-Za-z0-9._/:=@+%,-]+( [A-Za-z0-9._/:=@+%,-]+)*$` (so no quoting, `$`, `;`, `|`, `&`,
     redirects, globs or newlines), every token passes the token rule, the git rules hold, and
     the call is not `run_in_background`. Anything else asks.

3. **The review loop** (amends ADR-0013 §5 and ADR-0019 §2).
   - A worker or tester that finishes goes to `AWAITING_REVIEW` (no process, not terminal) and
     its worktree is **sealed** (committed). An empty change becomes `no-changes` and the agent
     SUCCEEDED; otherwise the change is `ready`.
   - **Reviewer** (`ProjectWorkflow.stages.review.reviewer`, run override at start): `agent` (the
     default) starts a read-only **change reviewer** on a detached checkout of the sealed commit,
     with the review stage's model, skill and agent file and `submit_review { verdict, findings }`
     as its only control tool; `lead` sends the change to the lead instead. The verdict is advice,
     never a gate.
   - **The lead decides** with `view_change`, `merge_change`, `request_rework { comments }`,
     `discard_change { reason }` or `ask_owner { question }`:
     - `merge_change` integrates the change with the ticket branch tip in the helper's worktree,
       requires the required harness checks to have passed **on that commit** (or starts them),
       then advances the ticket branch (decision 4);
     - `request_rework` sends the comments to the same helper in its own worktree (resuming its
       session) and is refused once `maxReworkRounds` (0–5, default 2) is reached, when the helper
       is over budget, or with no free helper slot; a rework turn never gets `canStartHelpers`;
     - `ask_owner` puts the change in `needs-owner`. The owner can take the same decisions
       (`decidedBy: owner`), including a rework round past the limit.
   - Change states (`ChangeState`): `sealing`, `ready`, `reviewing`, `decision`, then `merged`,
     `rework`, `discarded` or `needs-owner`; an empty change is `no-changes`. Every review round
     is recorded (`change_reviews`).
   - `request_review` now means "every change is decided; hand over". It is refused while a helper
     is live or a change is undecided; after it, `start_agent` is refused.
   - Limits: a change reviewer counts as one helper with its own budget; rework uses the helper's
     budget; `view_change` returns at most 32 KiB; the reviewer's brief holds a diff of at most
     64 KiB, sent and never stored. At depth 2 every change goes through the loop.

4. **The ticket branch and the owner's single final merge** (amends ADR-0013 §5 and ADR-0017 §4).
   - At plan approval the server creates `acp/<KEY>` (or `acp/<KEY>-r<n>` when taken) from the base
     branch tip, with git argument arrays only. Helper and tester worktrees start from its tip.
   - Only the server moves it, by compare-and-swap (`update-ref <new> <expected-old>`) after an
     `--is-ancestor` check and only while it is not checked out anywhere. The lead's tools ask the
     engine; they never name a ref or run git.
   - When the run reaches REVIEW the owner sees the combined change `base..tip` and its checks, and
     chooses **Merge** (a clean owner tree on the base branch; `merge --ff-only <tip>`), **Merge
     anyway** (a failed required check, with a typed reason), **Request changes** (a comment to the
     lead; the run returns to RUNNING) or **Discard** (`branch -D`). If the base moved, "Update
     from main" merges the base into the tip in a temporary worktree and runs the checks again.
   - `main` therefore changes only on the owner's click, once per run, as a fast-forward. Open
     ticket branches of NEEDS_REVIEW or CANCELLED runs are kept; unknown `acp/*` refs are never
     deleted.

5. **The final stages run on the ticket branch, before the owner's merge, and the lead stays
   live** (amends ADR-0019 §2–§3 and the ADR-0020 context).
   - The final code review reads a detached checkout of the ticket branch tip and posts to the
     lead (`post_review`); the tester starts from the tip and its change goes through the loop.
   - The run stays RUNNING with the lead live until no stage is left, then goes to REVIEW for the
     owner's merge. If the lead ends early, undecided changes go to `needs-owner` and the run to
     REVIEW. ADR-0020's follow-up turn still applies once the lead has ended.
   - Stop all: AWAITING_REVIEW agents become CANCELLED; the ticket branch stays open (it can only be
     discarded). Restart: AWAITING_REVIEW agents and change reviewers become NEEDS_REVIEW, undecided
     changes `needs-owner`; nothing is relaunched (ADR-0013 §7).

6. **Stored scope** (amends ADR-0016, ADR-0009). Reviewer findings and the lead's rework and
   discard notes (and the owner's rework comments) are stored as **ticket comments**; the review
   round row only points at the comment. No diff, tool input or output, or thinking is stored.

Plan-step fix (same series): every plan step goes to a helper role; `submit_plan` refuses the roles
lead, the lead, planner and orchestrator. Control-tool names in an agent's "Latest" line use
`CONTROL_TOOL_LABELS` instead of raw `mcp__acp__*` names.

## Safety argument

- **Refs.** The lead (and every agent) only causes its own run's ticket branch to move, through
  the server's compare-and-swap after an ancestry check. No agent runs git; no model text reaches
  a ref name, which comes from the ticket key and is checked against
  `^acp/[A-Z]{2,6}-[1-9]\d*(-r[1-9]\d*)?$`.
- **`main`.** It changes only on the owner's click, as a clean fast-forward of a branch whose
  every change was reviewed, decided and checked, plus the checks on the tip itself.
- **Approvals.** The lead never approves a tool request. Each mode is a fixed rule set in the gate,
  checked again by the engine (`ruleAllowedByMode`), and recorded with its rule. The lead, planner
  and reviewers are never covered by a mode.
- **Commands.** A command allowlist entry cannot name a shell, a command runner, a privilege tool
  or a network tool, and the gate's whole-command match leaves no shell syntax to interpret.
- **Accepted risk.** Under Auto edits and Auto, agent-written code can run unasked with the owner's
  privileges, inside the agent's worktree: an allowed `npm test` runs whatever the helper wrote.
  This is the same risk ADR-0017 already accepts for harness checks, now without a click per run.
  Manual mode remains for projects where it is not acceptable, and the Workflow page says so in
  plain words.

## Alternatives considered

- **Let the lead approve tool requests.** Fewer prompts, but it makes a model the gate for
  side effects. Rejected by the owner.
- **Keep the owner merging each change into `main`.** Simple and safe, but the owner stays the
  bottleneck and later helpers miss earlier changes. Rejected by the owner.
- **The lead merges into `main` directly.** Removes the bottleneck but lets an agent move the
  owner's branch. Rejected: the ticket branch gives the same flow with one owner merge.
- **A reviewer verdict that blocks.** It would make an agent's opinion a gate (rejected in
  ADR-0019 too); the harness checks stay the automated gate and the lead decides.
- **Free-form shell allowlist (regex or glob).** Easy to write, hard to make safe. Rejected for
  token patterns with exact or prefix match.

## Consequences

- **Contract (RL-0, coordinator):** additive `@acp/core` types and helpers (README §3); compile-only
  placeholders in the engine, adapter, server and web keep the new paths unreachable until RL-A,
  RL-B and RL-D replace them (docs/review-loop/wp/RL-0.md).
- **Migration 0006:** `ticket_branches`, `change_reviews`, `managed_workspaces.change_state`,
  `rework_rounds`, `head_commit`, `check_runs.commit_sha`, `approvals.allow_rule`. Approvals, the
  review settings and the run snapshot stay in JSON.
- **Engine (RL-A):** the loop, rework, handover, final stages on the ticket branch, and the
  plan-role fix. **Server, db and adapter (RL-B):** ticket-branch git flows, checks per commit, the
  gate's modes, the change tools and the final-merge routes. **Web (RL-D):** the approvals editor,
  the Start dialog, change cards and the ticket-branch card.
- Runs started before this ADR keep the legacy flow (no snapshot, no ticket branch).
- **Settled at acceptance (2026-10-17):**
  - the legacy mapping never widens a setup: edits on with checks off maps to `manual`, not
    `auto-edits`;
  - the column is `commit_sha`, because `commit` is an SQL keyword;
  - the ticket-branch request has a fifth action, `update-from-base`, for "Update from main";
  - `RunDetailDto.changes` carries the change cards;
  - enum-like columns are length-checked in SQL and value-checked by Zod, as in 0002–0005.
