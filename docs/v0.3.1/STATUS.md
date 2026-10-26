# v0.3.1 (P series): status

Coordinator-owned. Plan: [README.md](README.md). Decision:
[ADR-0028](../decisions/0028-agent-effort-optional-checks-finish-block.md).

| WP  | Title                                         | Status      | Branch                | Merged    |
| --- | --------------------------------------------- | ----------- | --------------------- | --------- |
| P-0 | ADR-0028, contract, plan                      | done        |                       |           |
| P-A | Core, engine, server, adapter                 | done        | `wp/p-a-core`         | `b34062c` |
| P-B | Web                                           | done        | `wp/p-b-web`          | `307d5a7` |
| P-C | Smooth linking in the editor                  | done        | `wp/p-c-linking`      | `ced2192` |
| P-D | Lost helper sessions while the owner reviews  | in progress | `wp/p-d-session-loss` |           |
| P-O | Open-source readiness, docs and agent context | done        | `wp/p-o-open-source`  | `1ed05ad` |
| P-V | Verification and release prep                 | in progress |                       |           |

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
- 2026-10-26 P-C paused by the owner. Its work is saved as a WIP commit on `wp/p-c-linking`
  (unchecked; the Link to… menu was half done). Resume from that branch.
- 2026-10-26 P-C resumed by the owner: a new agent continues from the WIP commit on
  `wp/p-c-linking`.
- 2026-10-26 Owner report: after the lead escalates a helper's change, the helper's session is lost
  a few minutes later and the ticket has to be cancelled and redone. P-D investigates and fixes it.
  The coordinator's read-only look at the live database found no recorded failure (runs ended
  cancelled, or `NEEDS_REVIEW` on a server restart); the approval timeout (15 min) and run timeout
  (2 h) don't match "a few minutes".
- 2026-10-26 Owner request: open-source readiness for a LinkedIn post (README, architecture, agent
  context, contributing, remove unwanted files, readiness audit). P-O started. Branch scan: no
  private paths or real secrets; git history on `main` has the local user name in 12 commits'
  worktree paths (owner decision: rewrite history or not, before making the repo public).
- 2026-10-26 P-C merged (`ced2192`): side connectors and edge strips, magnetic drop (80 px),
  instant link when one kind fits, click-to-connect, "Link to…", moving link ends, undo/redo (50),
  Tidy layout (the existing layout; `elkjs` not needed). Full check ✓; e2e 117/117.
- 2026-10-26 P-O merged (`1ed05ad`): internal coordination logs removed (readable at tag `v0.3.0`),
  finished series plans moved to `docs/history/`, README, architecture, AGENTS.md, CLAUDE.md and
  CONTRIBUTING rewritten for outside contributors, issue and PR templates, readiness audit in
  [wp/P-O.md](wp/P-O.md). Format ✓; links 247/247 ✓. Coordinator applied its package.json
  proposal (`610421d`). Left to the owner: CI on pull requests (reverses the 2026-10-17 decision),
  the git-history decision, private vulnerability reporting and repo topics in GitHub.
- 2026-10-26 Owner decisions: CI runs on pull requests, including forks (`ci:` commit);
  the git history stays as it is (the local user name in 12 old commits is accepted).
