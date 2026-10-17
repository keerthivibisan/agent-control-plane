# RL-G — Full auto mode

> Progress file for RL-G. Only the agent working on RL-G edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: the coordinator's brief (2026-10-17) from the owner decisions in STATUS.md (last log
> entry): a `full-auto` approval mode where helpers and the tester run in Claude Code's auto mode
> inside the OS sandbox, the plan is approved automatically, and the owner sees only the final
> ticket-branch merge.

| Field   | Value                                                     |
| ------- | --------------------------------------------------------- |
| Status  | in-progress                                               |
| Owner   | agent (RL-G)                                              |
| Branch  | `wp/rl-g-full-auto` (from `feature/ui-refresh` `8200cbc`) |
| Started | 2026-10-17                                                |
| Updated | 2026-10-17                                                |

## Tasks

- [ ] 1. Core contract (additive): `ApprovalModeSchema += 'full-auto'` and the exhaustive records
- [ ] 2. Engine: plan approved automatically in Full auto; lead brief; failure reporting
- [ ] 3. Adapter: `permissionMode: 'auto'` + sandbox for helpers and the tester; fail closed
- [ ] 4. Server: spec wiring, per-run temp dir, gate denies without asking, plan marker
- [ ] 5. Web: Full auto option, warning, plan marker, approvals note; tests and e2e
- [ ] 6. Docs: ADR-0022 (proposed), ADR-0021 pointer, review-loop README, CHANGELOG
- [ ] 7. Real-run driver: `ACP_REAL_RUN_MODE=full-auto` (not executed)

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks |
| ---------- | ------------- | ------ | ------ |
| 2026-10-17 | Claimed RL-G  | (this) | —      |

## Decisions and findings

(filled in as the work goes)
