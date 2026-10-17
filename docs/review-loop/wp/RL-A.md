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

- [ ] Legacy snapshot test, recorded on the code before any RL-A change
- [ ] Publish the exported signatures (below) for RL-B
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

| Date       | What was done | Commit | Checks |
| ---------- | ------------- | ------ | ------ |
| 2026-10-17 | Claimed RL-A  | (this) | —      |
