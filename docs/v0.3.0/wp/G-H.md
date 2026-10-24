# G-H

> Progress file for G-H. Only its agent edits it. Plan: [../README.md](../README.md), Part 2;
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md) §10.

| Field  | Value         |
| ------ | ------------- |
| Status | review        |
| Branch | wp/g-h-source |

## Tasks

- [x] H1 Server: the ticket branch starts at its source's tip (`branch.from` ??
      `strategy.defaultSourceBranch` ?? the target), never switching the checkout; a missing
      source is refused (409 `source_branch_missing`); `sourceBranch` recorded (migration 0011)
      and exposed only when it differs from the target. Tests in temp repositories and through
      the routes.
- [x] H2 Web: Settings "Start ticket branches from"; the ticket's "Start from" (branch settings
      and New ticket); the header's "from …"; the one-click create for `source_branch_missing`,
      also in the "Start with options…" dialog.
- [x] H3 Web tests and one e2e for the settings and ticket flow.
- [x] H4 Progress file, report.

## What the server does

- **Plan** (`workspace/ticket-branch-plan.ts`): `source` = the ticket's `branch.from`, else the
  strategy's `defaultSourceBranch`, else null (the target). The strategy's default source joins
  the protected long-lived names.
- **Creating** (`workspace/manager.ts`, `startOf`): the target is resolved exactly as before (its
  tip, or the checked-out branch without one; `target-branch-missing` first). A source that is
  null or the target's own name changes nothing. Otherwise `git rev-parse --verify --quiet
refs/heads/<source>^{commit}` (local only, no fetch) → missing: `source-branch-missing`
  ("The branch release/2.0, which the ticket branch starts from, does not exist in the project
  yet"), HTTP 409 `source_branch_missing` through the existing workspace error mapping. The
  branch is `git branch --no-track <name> <source tip>`: no checkout, no switch (tested with a
  dirty owner tree and the recorded git calls). The source is reserved, so a ticket branch can
  never take its name (refused as long-lived). `ticket_branches.base_commit` is the source's tip
  (the diff base for what the ticket did); `base_branch` stays the target.
- **Start** (`board/service.ts`): a plan with only a source (no target, no own name) is checked
  before the run too, so the refusal comes at Start, not at plan approval.
- **Patch**: `branch.from` follows the other fields (value sets, `null` resets to the project's,
  absent keeps; `branch: null` clears all three).
- **Recorded and shown**: `TicketBranchDto.sourceBranch` only when the row's source is not the
  target.
- **Merging back, unchanged**: the owner's merge needs the target to be an ancestor of the tip.
  A source strictly ahead of the target fast-forwards the target (the source's commits go with
  it, as git would); a source the target has moved past gives `base_moved` ("…update it from dev
  first"), and Update from target then the merge work. Push & open PR uses the target as base.

## Storage: migration 0011 (additive)

`ALTER TABLE ticket_branches ADD COLUMN source_branch TEXT` (nullable, length 1–200; the name is
checked with `GitBranchNameSchema` in the repository). **A migration was unavoidable:** no
existing column holds it, and the run snapshot (`orchestration_runs.limits`) is rewritten from
the engine state by the run store, so a field there would be dropped or need an engine change.
Rows before 0011 read with `sourceBranch: null`. Back up the live database before it, as for
0008–0010. Tests updated for the new column: db schema snapshot, `migration-0008.test.ts`
(the full chain now adds the column), `migration-0010.test.ts` (no longer the last).

## What the UI shows where

- **Settings → Branches:** "Start ticket branches from", a select of the project folder's local
  branches with "Same as the target branch (dev)" first and default. Empty or the target's own
  name is saved as no start branch. A saved branch the folder doesn't list stays selected,
  marked "(not in the project folder)", with G-F's warning and Create it (from the target). A
  preset switch keeps the choice. Not in the new-project wizard (no folder to list yet).
- **A ticket's Branch (sidebar):** "Start from" with "This ticket" or "Project default
  (release/1.0)" / "(the target branch)"; once the run made the branch, "Started from" when it
  was not the target. **Change** and **New ticket** (under More options): "Start from", a
  combobox of the local branches; a typed branch that is missing gets "Create <name> from
  <target>" right under it. New ticket now passes `projectId`, so its target is a combobox too
  (G-F's follow-up).
- **Ticket header:** "feature/WEB-21 → dev · from release/1.0" (created, or planned before the
  run).
- **Start refused** (`source_branch_missing`): G-F's fix box, now `missingStartBranch`, says
  "release/2.0, which this ticket's branch starts from, isn't a branch in the project folder
  yet. Create it, and the ticket starts again." with "Create release/2.0 from main", on the board,
  in the header and (G-F's follow-up) inside the "Start with options…" dialog, which starts again
  with its own options.

## Work log

| Date       | What                                 | Commit    | Checks                                                                                                                                    |
| ---------- | ------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-24 | Server: source branch, 0011, tests   | `84db7d6` | typecheck(db, server) ✓ eslint ✓ prettier ✓ vitest db 71/71 ✓ server 13 files 138/138 ✓                                                   |
| 2026-10-24 | Web: settings, ticket fields, header | `e1010f3` | typecheck(web) ✓ eslint ✓ prettier ✓ vitest 13 files 277/277 ✓                                                                            |
| 2026-10-24 | e2e, progress file, status review    | this one  | e2e github 16/16, ticket + review-loop 17/17 ✓; server whole package 835/837 (2 load timeouts, both files 19/19 alone) ✓; typecheck(-r) ✓ |

## Decisions and findings

- **Migration 0011** instead of a JSON field (above).
- **The source is never a ticket branch:** reserved in creation and in the Start check, and the
  strategy's default source is protected like its base and target.
- **A source equal to the target** is the same as none everywhere (server, saved strategy, DTO,
  header), so old and new data read the same.
- **A missing target is reported before a missing source**; once created, Start shows the next
  refusal, if any.
- **Copy:** additions only. `BRANCHING_COPY.card.tip` still says branches are "created from its
  target branch"; it is right unless a start branch is set (the new field's hint says so).
- **`branch_prefs` length:** the 0008 column allows 500 characters of JSON; three 200-character
  names would exceed it (the database refuses the write, not the request schema). Real names
  are far shorter; not changed here.

## Proposed (not made)

- ADR-0025 §5 (Storage) and docs/v0.3.0/README.md: mention migration 0011
  (`ticket_branches.source_branch`) and the backup before it.
- `BRANCHING_COPY.card.tip`: "…created from its start branch (the target unless you set one)…".
