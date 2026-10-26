# v0.3.1 (P series): status

Coordinator-owned. Plan: [README.md](README.md). Decision:
[ADR-0028](../decisions/0028-agent-effort-optional-checks-finish-block.md).

| WP  | Title                         | Status      | Branch           | Merged    |
| --- | ----------------------------- | ----------- | ---------------- | --------- |
| P-0 | ADR-0028, contract, plan      | done        |                  |           |
| P-A | Core, engine, server, adapter | done        | `wp/p-a-core`    | `b34062c` |
| P-B | Web                           | done        | `wp/p-b-web`     | `307d5a7` |
| P-C | Smooth linking in the editor  | in progress | `wp/p-c-linking` |           |
| P-V | Verification and release prep | not started |                  |           |

## Log

- 2026-10-26 v0.3.0 released. The owner asked for a patch release with effort per agent, optional
  and clearer Checks blocks, and a clearer final step. Decisions in ADR-0028. `release/0.3.1`
  created from `main` (`60ac0df`). P-0 done.
- 2026-10-26 P-A merged (`b34062c`): effort passed to the SDK, Checks blocks optional, final-merge
  gating per ADR-0028's amendment.
- 2026-10-26 P-B merged (`307d5a7`): effort select and chips, removable Checks blocks with plain
  copy, the Finish block. Full check ✓; e2e 113/113 after the chip spec fix.
- 2026-10-26 P-C started (owner request: "butter smooth" linking; `elkjs` allowed if needed): side
  connectors, magnetic drop, click-to-connect, "Link to…", reconnect, undo/redo, Tidy layout.
