# RL-D — Web: approval modes, Start dialog, change cards, ticket-branch merge

> Progress file for RL-D. Only the agent working on RL-D edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope and owned paths: `docs/review-loop/README.md` §7 and §9 (`packages/web/**`).

| Field   | Value                                             |
| ------- | ------------------------------------------------- |
| Status  | in-progress                                       |
| Owner   | agent (RL-D)                                      |
| Branch  | `wp/rl-d-web` (from `feature/ui-refresh` 6876ef5) |
| Started | 2026-10-17                                        |
| Updated | 2026-10-17                                        |

## Tasks

- [ ] 1. Approvals: Workflow Helpers panel (modes, command list editor, warning), wizard mode,
      Settings summary
- [ ] 2. Review stage panel: reviewer, rework rounds, review agent's model/skill/agent file
- [ ] 3. Start dialog (board and ticket page) posting `StartTicketRequest`
- [ ] 4. Ticket page: change cards, owner overrides, ticket-branch card and actions
- [ ] 5. Live workflow graph: review counts, rework edge, "Owner merges" gate, "Waiting for
      review"
- [ ] 6. Copy: add-only section; control tool labels from core
- [ ] 7. Legacy runs unchanged
- [ ] 8. Tests: component tests, e2e full loop on mocked routes, screenshots

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks |
| ---------- | ------------- | ------ | ------ |
| 2026-10-17 | Claimed RL-D  | (this) | docs   |
