# Code map (CM series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0034](../decisions/0034-code-map.md) (accepted). Branch: `feature/codemap/code-map` from `dev`.

## Goal

Agents stop rediscovering the repository for every ticket, and people can see what is in a project
(owner, 2026-11-08). A deterministic, local code map per project, cached by git blob SHA, gives
agents a short repository map and a `code_map` query tool, passes the lead's findings to helpers,
and powers a "Code map" page with an explorable graph.

## Work packages

| WP   | What                                                                                                                           | Owned paths                                                                                      | After |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----- |
| CM-0 | ADR-0034, this plan                                                                                                            | `docs/decisions/**`, `docs/code-map/**`                                                          | —     |
| CM-1 | Contracts, migration, indexer (git blob cache, TS/JS symbols and imports, file-level others), the project code map REST API    | `packages/core/src/{codemap,api}/**`, `packages/db/**`, `packages/server/src/codemap/**`, routes | CM-0  |
| CM-2 | Agents: repository map in context, the `code_map` tool for every role (both adapters), content-free tool-call counts per agent | core orchestration, `packages/orchestrator/**`, both adapters, `packages/server/src/control/**`  | CM-1  |
| CM-3 | Plan to helper: likely files on plan steps, the helper brief with the files, their neighbourhood and the lead's notes          | core workspace, orchestrator, server control                                                     | CM-2  |
| CM-4 | Web: the Code map page (graph of files by folder, import edges, search, file details, commit and age, refresh)                 | `packages/web/**`                                                                                | CM-1  |
| CM-5 | Measured real runs (with and without the map) on a copy of a mid-size repository; docs                                         | verification driver, `docs/**`                                                                   | all   |

## Verification

- `pnpm check` green at every checkpoint; indexer tests on synthetic temp repositories (renames,
  deletes, unchanged blobs reused, unresolved imports, caps).
- The `code_map` tool never returns file content; adversarial: a symbol name that looks like an
  instruction is returned as data only.
- CM-5 compares read and search tool calls and tokens per role with and without the map.
