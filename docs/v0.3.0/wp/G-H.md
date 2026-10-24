# G-H

> Progress file for G-H. Only its agent edits it. Plan: [../README.md](../README.md), Part 2;
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md) §10.

| Field  | Value         |
| ------ | ------------- |
| Status | in-progress   |
| Branch | wp/g-h-source |

## Tasks

- [x] H1 Server: the ticket branch starts at its source's tip (`branch.from` ??
      `strategy.defaultSourceBranch` ?? the target), never switching the checkout; a missing
      source is refused (409 `source_branch_missing`); `sourceBranch` recorded (migration 0011)
      and exposed only when it differs from the target. Tests in temp repositories and through
      the routes.
- [ ] H2 Web: Settings "Start ticket branches from"; the ticket's "Start from" (branch settings
      and New ticket); the header's "from …"; the one-click create for `source_branch_missing`.
- [ ] H3 Web tests and one e2e for the settings and ticket flow.
- [ ] H4 Progress file, report.

## Work log

| Date       | What                               | Commit   | Checks     |
| ---------- | ---------------------------------- | -------- | ---------- |
| 2026-10-24 | Server: source branch, 0011, tests | this one | see commit |
