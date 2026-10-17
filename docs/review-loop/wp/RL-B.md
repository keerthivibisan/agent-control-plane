# RL-B — Server, db repositories, git flows and adapter for the review loop

> Progress file for RL-B. Only the agent working on RL-B edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope and owned paths: `docs/review-loop/README.md` §6, §9.

| Field   | Value                                                |
| ------- | ---------------------------------------------------- |
| Status  | in-progress                                          |
| Owner   | agent (RL-B)                                         |
| Branch  | `wp/rl-b-server` (from `feature/ui-refresh` 06f540d) |
| Started | 2026-10-17                                           |
| Updated | 2026-10-17                                           |

## Tasks

- [ ] db repositories: ticket branches, change reviews, 0006 columns, snapshot approvals and integration
- [ ] WorkspaceManager git flows (ticket branch, seal, integrate, advance, final merge, update from base,
      discard) and per-worktree / per-repository serialization (coordinator request from U-V)
- [ ] Checks per commit (helper commits, ticket tip) and the per-commit merge gate
- [ ] Control service and routes: engine effects, `merge_change`, `view_change`, change-reviewer brief,
      ticket-branch routes, owner `rework`, DTO fields, Start options, setup approvals, gate modes
- [ ] Adapter: change tools, change reviewer tools, rework resume, "Latest" labels
- [ ] Rebase on `feature/ui-refresh` after RL-A, wire the real engine calls

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks |
| ---------- | ------------- | ------ | ------ |
| 2026-10-17 | Claimed RL-B  | (this) | —      |
