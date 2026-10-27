# Conflict resolution and delegated delivery (CR series): plan

Owner request 2026-10-27: implement [PROPOSAL.md](PROPOSAL.md) ("policy-driven conflict
resolution and autonomous delivery"). Decision record:
[ADR-0030](../decisions/0030-conflict-resolution-and-delegated-delivery.md) (proposed). Status and
log: [STATUS.md](STATUS.md). Branch `feature/conflict-resolution` from `origin/dev`; the pull
request targets `dev`.

## Goal

When a ticket's target branch moves, the owner (or, when the project allows it, the app) updates
the ticket branch from the target in an isolated worktree. A clean merge needs no agent. A
conflicting merge is repaired by a resolver helper that edits file content only; the server owns
every git operation. The combined change is assessed, verified (or explicitly skipped) under the
project's policy, and then promoted to the ticket branch by compare-and-swap. Delivery (push and
pull request, or a local merge) happens automatically only when the project delegated it.

## Concrete contract changes (recorded before editing shared files)

All are additive. Old setups, graphs and runs keep their behaviour: an absent `automation` is
`DEFAULT_AUTOMATION` (manual resolution, required checks, escalate on missing checks, manual
delivery).

| Asset                                                                    | Change                                                                                                                                                                                                                                                                                                                              | Affected packages        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `core/src/workspace/conflict-resolution.ts` (new, exported from `index`) | `RepoPathPatternSchema` + `matchesPathPattern`; `ConflictResolutionPolicySchema`, `VerificationPolicySchema`, `DeliveryPolicySchema`, `ProjectAutomationSchema`, `DEFAULT_AUTOMATION`, `automationOf`; `classifyPaths`; `VerificationAssessmentSchema`; `decideVerification`; `policyFingerprint`; `HelperOutcomeKindSchema`. Pure. | core, server, web, orch. |
| `core/src/workspace/workspace.ts` (`ProjectAgentSetupSchema`)            | `automation: ProjectAutomationSchema.optional()`                                                                                                                                                                                                                                                                                    | core, server, web        |
| `core/src/api/workspace.ts` (`UpdateProjectSetupRequestSchema`)          | `automation: ProjectAutomationSchema.nullable().optional()` (absent keeps, `null` resets to the defaults)                                                                                                                                                                                                                           | server, web              |
| `core/src/api/conflict-resolution.ts` (new, exported from `api/index`)   | `ConflictResolutionDtoSchema` (separate `resolution`, `verification`, `review`, `delivery` dimensions, each with a status and an owner-readable reason), `ConflictResolutionViewDtoSchema`, `PromoteResolutionRequestSchema`                                                                                                        | server, web              |
| `core/src/orchestration/orchestration.ts` (`LeadToolInputs.report_work`) | `outcome?: 'completed' \| 'no-change' \| 'blocked'` and `assessment?` (classification, recommendation, proposed check ids, reason)                                                                                                                                                                                                  | orch., adapter, server   |
| `db/src/migrations/0012_conflict_resolution.sql` (new)                   | table `conflict_resolutions` (run, project, state, pinned commits, candidate, policy fingerprint, JSON record) with a partial unique index: one active operation per run                                                                                                                                                            | db, server               |
| `docs/decisions`                                                         | ADR-0030 (proposed); amendment notes on ADR-0021 §4, ADR-0025 §2, ADR-0027 §6, ADR-0028 §2                                                                                                                                                                                                                                          | docs                     |
| `AGENTS.md` rule 8                                                       | names ADR-0030's delegated delivery beside ADR-0025's owner click                                                                                                                                                                                                                                                                   | docs                     |

New HTTP routes (CSRF on every POST): `GET /api/runs/:id/conflict-resolution`,
`POST /api/runs/:id/conflict-resolution` (start), `POST …/cancel`, `POST …/promote`.

## Work packages (one branch, separate commits)

| WP   | What                                                                                                                       | Paths                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| CR-0 | Contracts above; ADR-0030; amendments                                                                                      | shared files listed above                                                       |
| CR-A | Engine: resolver helper, structured helper outcomes, no-change/blocked attempts counted                                    | `packages/orchestrator/**`                                                      |
| CR-B | DB repository for `conflict_resolutions`                                                                                   | `packages/db/src/repositories/review-loop/**`                                   |
| CR-C | Server: workspace preparation, operation service, policy gate, promotion, delegated delivery, restart recovery, routes     | `packages/server/**`                                                            |
| CR-D | Web: resolution panel with four statuses; "Update target / Resolve conflicts" visible with an open PR; Automation settings | `packages/web/src/features/{review-loop,project-setup}/**`, `lib/{api,copy}.ts` |
