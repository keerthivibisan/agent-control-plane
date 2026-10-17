# ADR-0022: Full auto mode

- **Status:** accepted — owner decisions in chat 2026-10-17 (docs/review-loop/STATUS.md); accepted by the coordinator on those decisions
  2026-10-17)
- **Date:** 2026-10-17
- **Deciders:** project owner (decisions); coordinator (review); RL-G agent (draft)
- **Amends:** ADR-0021 §1 (a fourth approval mode), ADR-0013 §4 (the gate's fallback for helpers
  in this mode), ADR-0016 (how the plan approval is recorded)
- **Plan:** [docs/review-loop/README.md](../review-loop/README.md) §10, progress
  `docs/review-loop/wp/RL-G.md`

## Context

Testing the review loop before the 0.1.0 release, the owner found that runs still ask too often:
"even now everything is asking me; I need a complete auto mode where I only see the final MR"
(STATUS.md, 2026-10-17). Under Auto edits and Auto (ADR-0021) every edit outside the helper's
worktree, every command that is not a harness check or an allowlisted command, and the plan itself
wait for the owner.

The owner decided (STATUS.md, last entry):

- a new mode, **Full auto**: the owner sees only the final ticket-branch merge request;
- helpers and the tester run in **Claude Code's own auto mode** (Agent SDK
  `permissionMode: 'auto'`: a classifier model reviews risky actions; reads and edits inside the
  project skip it) **plus the operating-system sandbox** for shell commands (writes only in the
  helper's worktree and a temp folder; secrets unreadable; `failIfUnavailable`);
- network for sandboxed commands: **the classifier decides** (no hard allowlist);
- **the plan is approved automatically**, still recorded on the ticket;
- the lead, planner and reviewers keep `default`, their read-only base sets and our gate; no
  subagents for anyone; `allowedTools` is never set; `main` changes only on the owner's click;
- if auto mode or the sandbox is unavailable, fail clearly, never run unprotected;
- whatever still reaches our `canUseTool` for a helper or tester is denied without asking.

Research summary (STATUS.md): the Claude Code docs on permission modes, sandboxing and sandbox
environments, the SDK permissions guide and the Anthropic engineering post on auto mode. The
classifier is a per-action control, not a boundary (about 17% false negatives on a small test);
the docs recommend an isolation boundary for unattended runs; auto-approved calls never reach
`canUseTool`; auto mode needs a supported model. The installed SDK (0.3.296, `sdk.d.ts`) confirms
`PermissionMode` includes `'auto'`, `system/init` reports the session's `permissionMode`, and
`SandboxSettings` has `enabled`, `failIfUnavailable`, `allowUnsandboxedCommands`,
`autoAllowBashIfSandboxed`, `filesystem.{allowWrite, denyWrite, denyRead, allowRead}` and
`network.*`. With `enabled: true` the CLI exits with an error result when the sandbox cannot start.

## Decision

1. **The mode.** `ApprovalModeSchema` gains `'full-auto'` (additive). It is a project default
   (`ProjectAgentSetup.approvals.mode`) or a per-run choice (`StartTicketRequest.approvalMode`),
   snapshotted with the run like the other modes. The legacy mapping never yields it, and
   `DEFAULT_APPROVAL_MODE` stays `auto-edits`.

2. **Helpers and the tester** (worker or tester specs in a Full auto run, including rework turns;
   never the lead, planner, reviewers or a follow-up turn) get, from the adapter:
   - `permissionMode: 'auto'` (never `bypassPermissions`; `canUseTool` is kept; `allowedTools` is
     never set; the `tools` base set is the role's, without `Agent`/`Task`);
   - `sandbox`, with no `network` block:
     - `enabled: true`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`,
       `autoAllowBashIfSandboxed: false`;
     - `filesystem.allowWrite: [worktree, run temp]`;
     - `filesystem.denyWrite: [worktree/.git, worktree/.claude]`;
     - `filesystem.denyRead`: the list in decision 3;
     - `filesystem.allowRead: [worktree, run temp]`;
   - `disallowedTools` deny rules for the file tools: `Read(//p/**)` and `Edit(//p/**)` for each
     deny-read path that does not contain the agent's own folders, and `Edit` of the worktree's
     `.git` and `.claude`;
   - `TMPDIR` set to the run's temp folder.

   Two choices go past the owner's literal list, each to the stricter side:
   `autoAllowBashIfSandboxed` defaults to true in the SDK, which would let every sandboxed command
   skip the classifier, so it is set to false and both layers apply to every command; and
   `allowRead` re-opens the worktree and temp folder, which live inside the app's data folder that
   `denyRead` closes. `denyWrite` keeps commands off the worktree's `.git` pointer and `.claude`,
   as ADR-0021's edit rule does for edits.

3. **Paths come from the server's configuration**, never from a run or an agent: the run's temp
   folder is `<dataDir>/sandbox-tmp/<runId>` (mode 0700, resolved through symlinks), created
   before a Full auto helper starts and removed when the run ends and at startup. The deny-read
   list is `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.netrc`, `~/.docker`, `~/.kube`,
   `~/.claude` (from the configured home), the data folder and Claude Code's config folder, each
   also as its real path when that differs.

4. **Fail closed.** The adapter ends the agent before any event when `system/init` does not report
   `permissionMode: 'auto'` (failure `auto-mode-unavailable`), or when an error result or a thrown
   error names the sandbox (`sandbox-unavailable`); the text is classified, never kept. The engine
   then sets a readable Latest line, emits a `full-auto-unavailable` diagnostic and tells the lead
   not to start more helpers; the agent ends like any failed turn (no change, FAILED). A temp
   folder that cannot be made fails the agent too.

5. **The gate never parks.** In Full auto a helper's or tester's request that still reaches
   `canUseTool` (an auto-mode escalation) runs only when the narrow Auto edits rules allow it (an
   edit in its own worktree, an exact harness check; recorded as `allowlist` with its rule), and is
   otherwise denied at once with a plain message and a `full-auto-denied` diagnostic. The project's
   command allowlist never overrides the classifier here. Nothing waits for the owner.

6. **The plan is approved automatically.** In a Full auto run `submit_plan` (lead or planner)
   approves the plan in the same command: no plan-waiting notice, the ticket branch is created, and
   the lead is told after it exists. The plan records `decidedBy: 'auto'` (an optional field on
   `TicketPlan`; the owner's decisions leave it absent); the server keeps it in the run snapshot
   (`autoApprovedPlanId`, no migration), and the ticket page shows "Approved automatically (Full
   auto)". No conversation text is stored for it. A plan that cannot be approved at once (the
   author over budget) waits for the owner as in the other modes.

7. **The lead** keeps `ask_owner`, but its brief says the run is in Full auto, the owner reviews
   once at the end, and it should decide every change itself and ask only when it truly cannot.

8. **Unchanged:** the lead, planner and reviewers (default mode, read-only base sets, our gate);
   the review loop; `main` changes only on the owner's merge of the ticket branch (ADR-0021 §4).

## Safety argument

- **The classifier is per action, not a boundary.** It can approve a harmful action, so Full auto
  does not rely on it alone:
  - the **OS sandbox** bounds every shell command: writes only in the helper's worktree and the
    run's temp folder; the credentials folders, the app's data and Claude Code's config are
    unreadable; no command may run outside it (`allowUnsandboxedCommands: false`), and the run
    stops if the sandbox cannot start (`failIfUnavailable`);
  - **role tool sets** keep subagents, web and messaging tools out of every context (ADR-0019 §7);
  - the **lead and reviewers stay read-only** and in default mode, so no agent with broad reach
    runs unattended;
  - the **owner's final merge** stays the only way anything reaches `main`, after review agents,
    the lead's decisions and the required harness checks on each change and on the tip.
- **Fail closed:** no auto mode or no sandbox means no work, with a reason, never a weaker mode.
- **No owner prompts to rubber-stamp:** anything still undecided is denied, not queued.

## Alternatives considered

- **Unsandboxed bypass (`bypassPermissions`).** No prompts, but no review and no boundary; the
  docs advise against it outside an isolated environment. Rejected.
- **Sandbox only, approve everything else (no classifier).** A hard boundary for commands, but
  edits and reads by the built-in tools, and network, would be unreviewed. Rejected: the owner
  chose both layers.
- **A hard network allowlist for sandboxed commands.** Stronger egress control, but package
  managers and tests need hosts that differ per project, and a wrong list makes runs fail in ways
  the owner cannot see. Rejected for now by the owner: the classifier decides; revisit if real runs
  show unwanted egress.

## Consequences

- **Cost:** auto mode's classifier makes extra model calls per reviewed action (not in the SDK's
  usage totals). With `autoAllowBashIfSandboxed: false` every command is reviewed.
- **Model requirement:** auto mode needs a supported model and account; otherwise every helper
  fails at start with a readable reason and the run cannot make changes.
- **Audit gap:** auto mode's per-action approvals are not visible to the app: only escalations
  reach the gate. The approvals tab of a Full auto run says so. `system/permission_denied`
  messages are not stored.
- **The sandbox covers commands only.** The file tools' deny rules cover the credentials folders
  but not the app's data folder (it holds the worktree); reads there are left to the classifier.
- **To verify in the consented real run** (RL-G driver, `ACP_REAL_RUN_MODE=full-auto`): that
  `system/init` reports `auto`; that sandboxed commands work with `~/.claude` unreadable; that the
  `//`-prefixed absolute deny rules are honoured; how often escalations reach the gate.
- Contract: `ApprovalMode += 'full-auto'`, `TicketPlan.decidedBy?`, `ManagedAgentSpec.fullAuto?`,
  `finished.failure?`, all additive. The engine's `ruleAllowedByMode('full-auto')` equals Auto
  edits'.
