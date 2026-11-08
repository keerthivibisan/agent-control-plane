# Code map (CM series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                                | Status      | Branch                     | Merged |
| ---- | ------------------------------------ | ----------- | -------------------------- | ------ |
| CM-0 | ADR-0034, plan                       | done        | `feature/codemap/code-map` |        |
| CM-1 | Contracts, migration, indexer, API   | done        | `feature/codemap/code-map` |        |
| CM-2 | Agents: map in context, tool, counts | not started |                            |        |
| CM-3 | Plan to helper bundle                | not started |                            |        |
| CM-4 | Web: Code map page                   | not started |                            |        |
| CM-5 | Measured real runs, docs             | not started |                            |        |

## Log

- 2026-11-08 Planned and started on the owner's go-ahead ("start a new branch from the latest dev
  and start to implement this", with a Code map page per project). Branch `feature/codemap/code-map`
  from `origin/dev` (`50bcfc1`, includes the CX series). CM-0 done.
- 2026-11-08 CM-1 done: core code map contracts and graph views, migration 0014 (blobs by
  (project, blob SHA), manifests, entries; newest 5 kept), indexer (git ls-tree, TypeScript AST,
  file-level others, caps, workspace package resolution), REST summary/refresh/graph/file/search.
