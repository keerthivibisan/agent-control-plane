# RL-G — Full auto mode

> Progress file for RL-G. Only the agent working on RL-G edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: the coordinator's brief (2026-10-17) from the owner decisions in STATUS.md (last log
> entry): a `full-auto` approval mode where helpers and the tester run in Claude Code's auto mode
> inside the OS sandbox, the plan is approved automatically, and the owner sees only the final
> ticket-branch merge.

| Field   | Value                                                                           |
| ------- | ------------------------------------------------------------------------------- |
| Status  | review                                                                          |
| Owner   | agent (RL-G)                                                                    |
| Branch  | `wp/rl-g-full-auto` (from `feature/ui-refresh` `8200cbc`, rebased on `5f8a457`) |
| Started | 2026-10-17                                                                      |
| Updated | 2026-10-17                                                                      |

## Tasks

- [x] 1. Core contract (additive): `ApprovalModeSchema += 'full-auto'` and the exhaustive records
- [x] 2. Engine: plan approved automatically in Full auto; lead brief; failure reporting
- [x] 3. Adapter: `permissionMode: 'auto'` + sandbox for helpers and the tester; fail closed
- [x] 4. Server: spec wiring, per-run temp dir, gate denies without asking, plan marker
- [x] 5. Web: Full auto option, warning, plan marker, approvals note; tests and e2e
- [x] 6. Docs: ADR-0022 (proposed), ADR-0021 pointer, review-loop README §10, CHANGELOG
- [x] 7. Real-run driver: `ACP_REAL_RUN_MODE=full-auto` (not executed)

## Work log (append-only; newest last)

| Date       | What was done                                                    | Commit    | Checks                                                            |
| ---------- | ---------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| 2026-10-17 | Claimed RL-G                                                     | `c9fb2c0` | —                                                                 |
| 2026-10-17 | Core: `full-auto`, `TicketPlan.decidedBy?`, spec and failure     | `56eb28c` | format ✓ lint ✓ typecheck ✓ test 2537/2537 ✓ build ✓              |
| 2026-10-17 | Engine: automatic plan approval, briefs, failure handling        | `67e2b7f` | format ✓ lint ✓ typecheck ✓ test 2548/2548 ✓ build ✓              |
| 2026-10-17 | Adapter: auto mode + sandbox options, fail closed                | `98a9112` | format ✓ lint ✓ typecheck ✓ test 2565/2565 ✓ build ✓              |
| 2026-10-17 | Server: spec paths, temp folder, gate, plan record               | `ee0623b` | format ✓ lint ✓ typecheck ✓ test 2573/2573 ✓ build ✓              |
| 2026-10-17 | Engine: the command allowlist never overrides an escalation      | `926638a` | format ✓ lint ✓ typecheck ✓ test 2574/2574 ✓ build ✓              |
| 2026-10-17 | Server test: the RL-B flow test retries a merge while checks run | `2f020a3` | format ✓ lint ✓ typecheck ✓ test 2580/2580 ✓ build ✓              |
| 2026-10-17 | Web: Full auto option, warning, plan marker, approvals note, e2e | `3211aeb` | test 2580/2580 ✓; e2e live 2/2 ✓ (full e2e at handback)           |
| 2026-10-17 | Real-run driver: `ACP_REAL_RUN_MODE=full-auto` (not executed)    | `475c60b` | format ✓ lint ✓ typecheck ✓ server 473/473 ✓ build ✓              |
| 2026-10-17 | Docs: ADR-0022, ADR-0021 pointer, README §10, CHANGELOG; review  | (this)    | docs only                                                         |
| 2026-10-17 | Rebased on `5f8a457`; full check and full e2e; to review         | (this)    | format ✓ lint ✓ typecheck ✓ test 2580/2580 ✓ build ✓; e2e 61/61 ✓ |

## Decisions and findings

1. **SDK keys (0.3.296 `sdk.d.ts`, checked).** `PermissionMode` has `'auto'`; `system/init` carries
   `permissionMode`; `SandboxSettings` has every key the owner listed, plus
   `autoAllowBashIfSandboxed` (default true) and `filesystem.allowRead`/`denyWrite`. With
   `enabled: true` the CLI exits with an error result when the sandbox cannot start.
2. **Two stricter choices beyond the owner's list** (ADR-0022 decision 2):
   `autoAllowBashIfSandboxed: false`, so the classifier still reviews sandboxed commands; and
   `allowRead: [worktree, temp]`, because worktrees and the temp folder live inside the data
   folder that `denyRead` closes. `denyWrite` covers the worktree's `.git` (the pointer git follows)
   and `.claude`.
3. **File-tool deny rules.** The sandbox covers commands only, so the adapter adds `Read(//p/**)` and
   `Edit(//p/**)` to `disallowedTools` for each deny-read path that does not contain the agent's
   folders (the data folder is left to the classifier), and `Edit` of `.git`/`.claude`. The `//`
   absolute spelling follows Claude Code's permission-rule docs; it is not yet verified on a real
   run.
4. **Gate rule.** What still reaches the gate in Full auto was escalated by the classifier: only
   the two narrow Auto edits rules may allow it (`ruleAllowedByMode('full-auto') ==
'auto-edits'`); the command allowlist never overrides it (commit `926638a`). Everything else is
   denied at once (`full-auto-denied`), never parked.
5. **Plan record without a migration.** `TicketPlan.decidedBy?: 'owner' | 'auto'` (only `auto` is
   set); the server keeps `autoApprovedPlanId` in the run snapshot JSON (`orchestration_runs.limits`)
   and fills `decidedBy` on the ticket detail and on reload. A plan inserted and approved in one
   command is now stored as approved (`syncPlans`).
6. **Fail closed.** The adapter aborts a Full auto agent whose `system/init` is not `auto` (also when
   the field is missing) before any event; a sandbox error result or thrown error is classified by
   keyword only. The engine sets a fixed Latest line, emits `full-auto-unavailable`, and tells the
   lead not to start more helpers; the agent then ends FAILED with no change.
7. **Flaky test found.** `tests/verification/review-loop/flow.test.ts` posted the final merge while
   the tip checks could still run; under a loaded `pnpm check` it got `409 checks_running` twice.
   It now retries like the owner would (`2f020a3`). No product change.

## Follow-ups (not in RL-G's paths or scope)

1. `docs/security.md` does not describe the approval modes (ADR-0021) or Full auto yet.
2. The consented real run (`ACP_REAL_RUN=1 ACP_REAL_RUN_MODE=full-auto`) must confirm:
   `system/init` reports `auto` for the default model; sandboxed commands work with `~/.claude`
   unreadable (Claude Code's shell snapshots live there); the absolute deny rules are honoured; how
   often escalations reach the gate.
3. RL-H (ticket-level options) touches the same approval-mode code and starts after RL-G.
