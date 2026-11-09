# Flexible workflows (AR series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                                      | Status      | Branch                    | Merged |
| ---- | ------------------------------------------ | ----------- | ------------------------- | ------ |
| AR-0 | ADR-0037, plan                             | done        | `feature/workflow/arrows` |        |
| AR-1 | Core: v3 graph, roles, validator, compile  | done        | `feature/workflow/arrows` |        |
| AR-2 | Researcher role                            | not started |                           |        |
| AR-3 | Engine: research, hand-offs, plans, review | not started |                           |        |
| AR-4 | Server and DB                              | not started |                           |        |
| AR-5 | Web editor and plan approval               | not started |                           |        |
| AR-6 | Safety, docs, real run                     | not started |                           |        |

## Log

- 2026-11-09 Planned on the owner's request: one Agent block with roles derived from typed,
  labelled arrows; research and custom arrows; several planners with the owner picking one; review
  fan-out. AR-0 done.
- 2026-11-09 AR-1 (core) ready for review on `feature/workflow/arrows`: graph version 3 schemas
  (`WorkflowGraphV3Schema`; the unversioned names stay version 2 until AR-4/AR-5), `deriveRoles`,
  `canConnectV3`, `validateWorkflowGraphV3`, `compileWorkflowV3` (`compileWorkflow` takes both
  versions and runs it), `migrateWorkflowV2`/`downgradeWorkflowV3`/`storedWorkflowGraphV3`,
  `workflowTemplateV3`, v3 generators and mutations. The pool is `pool: true` on a helper agent.
  `researcher` is not yet a `RunAgentKind` (left to AR-2). A migrated v2 graph compiles to the same
  program for every template, generated and enumerated graph. The DB reads a v3 row; the server
  serves it as v2 until AR-4.
- 2026-11-09 AR-2 (researcher role) ready for review on `feature/workflow/arrows`: `researcher`
  is a `RunAgentKind` (read-only, project folder, no worktree; Claude read-only base set, Codex
  `:read-only` with `never`); new tool `report_findings` (1 to 16,384 characters, once per
  researcher) emits `record-findings`, kept in `RunState.findingsByAgent` for AR-3 and stored as
  ticket comments of kind `research` (author `app`, split into "(part i of n)" bodies over 8,000
  characters, the `ticket_comments.body` check). No migration. Adversarial rows R1 to R5.
