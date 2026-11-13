# Flexible workflows (AR series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                                      | Status      | Branch                    | Merged |
| ---- | ------------------------------------------ | ----------- | ------------------------- | ------ |
| AR-0 | ADR-0037, plan                             | done        | `feature/workflow/arrows` |        |
| AR-1 | Core: v3 graph, roles, validator, compile  | done        | `feature/workflow/arrows` |        |
| AR-2 | Researcher role                            | done        | `feature/workflow/arrows` |        |
| AR-3 | Engine: research, hand-offs, plans, review | done        | `feature/workflow/arrows` |        |
| AR-4 | Server and DB                              | done        | `feature/workflow/arrows` |        |
| AR-5 | Web editor and plan approval               | done        | `feature/workflow/arrows` |        |
| AR-6 | Safety, docs, real run                     | in-progress | `feature/workflow/arrows` |        |

## Resume here (paused 2026-11-09)

Paused on the owner's request while AR-3 was starting. To resume:

1. In `.claude/worktrees/arrows` (branch `feature/workflow/arrows`), the last commit is a **WIP**
   commit (`wip(orchestrator): AR-3 engine state types`) that does not typecheck: `state.ts` uses
   `AnyWorkflowGraph` without importing it. Fix the import first (or drop the commit and restart
   AR-3 from `65c7993`).
2. Continue **AR-3** (engine) with the brief in the plan (README.md, "Engine" 1–5): v3 run
   snapshots, pre-plan research stage, lead-started researchers, custom hand-offs, several planners
   (no auto-approve with 2 or more), review fan-out; graph-correctness simulator for v3.
3. **AR-5a** (editor on v3: Agent block and presets, arrow menu with Custom, label and purpose,
   role badges) can run in parallel in its own worktree from the AR-2 commit `65c7993`: it touches
   only `packages/web`, converts v2 API graphs with `migrateWorkflowV2` / `downgradeWorkflowV3`
   behind one adapter module, and gates saving v3-only parts with `canSaveToServer(graph)` until
   AR-4. It had not started (no work lost).
4. Then AR-4 (server and DB: v3 API, plan options storage), AR-5b (side-by-side plan picker), AR-6
   (safety, docs, real run; includes restricting Codex's Full auto temp folder to editing roles).

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
- 2026-11-09 Coordinator: AR-2 accepted. Follow-up for AR-6: the Codex `profileFilesystem` gives
  the Full auto temp folder to any role with `fullAuto`; restrict it to editing roles.
- 2026-11-09 Paused on the owner's request: AR-3 had only its state types (WIP commit); AR-5a had
  not started. See "Resume here".
- 2026-11-13 Resumed. Merged dev (ADR-0036); the AR-3 WIP builds again (graph type left v2). AR-3
  and AR-5a restarted in parallel.
- 2026-11-13 AR-3 (engine) ready for review on `feature/workflow/arrows`: v3 run snapshots
  (`RunState.graph` any version; the DB snapshot parser takes v3); researchers before planning
  (chains in order, parallel within the helper limit) and held planners or planning lead, whose
  brief quotes each finding as data with the arrow's label and purpose; the lead starts every
  other researcher with `start_agent` (findings reach it as a notice); custom hand-offs (start
  brief or notice, once per source; engine-started targets wait for unfinished sources); several
  planners → plan options, PLAN_REVIEW once all submitted or ended, `decidePlanOption` (no
  auto-approve); review fan-out (any rework wins, direct only on a direct route, "no verdict"
  told to the lead). Deferred: storing plan drafts and serving v3 run graphs (AR-4,
  `runGraphOf` throws `RunGraphVersionError` for a v3-only run graph), `researcherPrompt` wiring
  in the server (AR-4).
- 2026-11-13 Coordinator: AR-3 accepted; AR-5a (editor on v3, `84e6373`) merged from
  `feature/workflow/arrows-editor`. Full check green except load timeouts (Microsoft Defender at
  ~270% CPU) that pass alone. Next: AR-4 with AR-5b (plan picker) in one pass.
- 2026-11-13 AR-4 (server and DB) ready for review on `feature/workflow/arrows`: the workflow API,
  the run graph and new run snapshots carry version 3 (`stored` adds `v3`; a `PUT` stores version
  3 and still takes version 2, migrated; `WorkflowGraphVersionError` removed); the board passes
  `ticketResearcherPrompt` for graphs with researchers; migration 0016 adds `ticket_plan_options`
  (`ticket_plans` not rebuilt: a rebuild inside the migration transaction would cascade into plan
  comments) and the run store keeps the options across commits and restarts; `TicketDetailDto`
  gains `planOptions` and `POST /api/tickets/:id/plan-options/decision` calls `decidePlanOption`
  (`planOptionId` required with two or more). `deriveRunWorkflowGraph` reads the v3 graph by
  derived role (researchers included); the live graph draws researchers and arrow labels; the
  editor saves version 3 (adapter and "can't store yet" notice removed; templates and the wizard
  are version 3). API fuzz moved to the v3 generator.
- 2026-11-13 AR-5b (plan picker) ready for review: in plan review with plan options, the
  Comments tab shows the plans side by side (stacked below 1024px), each with its planner,
  summary, steps and "Approve this plan"; one Request changes box goes to every planner. A
  single planner's plan card is unchanged.
- 2026-11-13 Coordinator: AR-4 and AR-5b accepted. Plan options live in a new table
  `ticket_plan_options` (migration 0016) instead of new columns on `ticket_plans`: rebuilding that
  table inside the migration would cascade-delete comments pointing at plans.
