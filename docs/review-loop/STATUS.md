# Review loop (RL series) — status

Coordinator-owned. Plan: [README.md](README.md). Branches `wp/rl-<id>-<slug>` come off
`feature/ui-refresh` (the 0.1.0 line) and are merged back with `--ff-only` after review.

| WP   | Title                                                    | After      | Status      | Branch           | Merged    |
| ---- | -------------------------------------------------------- | ---------- | ----------- | ---------------- | --------- |
| RL-0 | ADR-0021, core contract (additive), migration 0006       | —          | **done**    | wp/rl-0-contract | `3a46106` |
| RL-A | Engine: review loop, rework, handover, plan-role fix     | RL-0       | in-progress | wp/rl-a-engine   | —         |
| RL-B | Server, db, git and adapter: ticket branch, gate modes   | RL-0, RL-A | in-progress | wp/rl-b-server   | —         |
| RL-D | Web: approvals editor, Start dialog, change cards, merge | RL-0, U-V  | in-progress | wp/rl-d-web      | —         |
| RL-V | Verification and one consented real run                  | all        | todo        | —                | —         |

## Owner decisions (2026-10-17)

- **Modes:** Manual, Auto edits (the default for new projects only), Auto. The lead never
  approves tool requests.
- **Review:** a review agent reviews each change by default (the lead can be chosen instead).
  The lead merges into the ticket branch or asks for rework (2 rounds by default). The owner
  merges the ticket branch into `main` once.
- **Stored text:** reviewer findings and the lead's rework and discard notes are kept as ticket
  comments.
- **Release:** built on `feature/ui-refresh`, in 0.1.0.
- **Coordinator defaults:**
  - Manual also asks before harness checks;
  - in the command allowlist, `git` is limited to read-only subcommands, while an `npm` or `mvn`
    prefix allows any arguments.

## Log

- 2026-10-17 planner fix (`64b54fd`): plan steps go to helpers; a step for the lead or the planner
  is refused.
- 2026-10-17 RL-0 merged (`3a46106`): the additive core contract, migration 0006 and ADR-0021.
  - Coordinator change: the legacy approvals mapping never widens a setup. Edits only maps to
    `manual`; only edits and checks together map to `auto-edits`.
  - ADR-0021 accepted on the owner's decisions.
  - Coordinator check: 2,292 tests.
- 2026-10-17 RL-A and RL-B started in parallel. RL-B codes against the RL-0 signatures and rebases
  after RL-A.
- Note: the owner's running dev server has not restarted, so migration 0006 has not been applied
  to the live database yet. It applies on the next start from this branch.
- 2026-10-17 U-V merged (the UI refresh is complete). RL-D (web) started against the contract with
  fixtures. RL-B also gets U-V's server finding: serialize git operations per worktree in
  `WorkspaceManager`.
