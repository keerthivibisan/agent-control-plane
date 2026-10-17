# Review loop (RL series) — status

Coordinator-owned. Plan: [README.md](README.md). Branches `wp/rl-<id>-<slug>` come off
`feature/ui-refresh` (the 0.1.0 line) and are merged back with `--ff-only` after review.

| WP   | Title                                                    | After      | Status      | Branch | Merged |
| ---- | -------------------------------------------------------- | ---------- | ----------- | ------ | ------ |
| RL-0 | ADR-0021, core contract (additive), migration 0006       | —          | in-progress | —      | —      |
| RL-A | Engine: review loop, rework, handover, plan-role fix     | RL-0       | todo        | —      | —      |
| RL-B | Server, db, git and adapter: ticket branch, gate modes   | RL-0, RL-A | todo        | —      | —      |
| RL-D | Web: approvals editor, Start dialog, change cards, merge | RL-0, U-V  | todo        | —      | —      |
| RL-V | Verification and one consented real run                  | all        | todo        | —      | —      |

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
