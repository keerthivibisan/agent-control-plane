# Failure routing (FR series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                                       | Status      | Branch                             | Merged |
| ---- | ------------------------------------------- | ----------- | ---------------------------------- | ------ |
| FR-0 | ADR-0038, plan                              | done        | `feature/workflow/failure-routing` |        |
| FR-1 | Structured test results                     | done        | `feature/workflow/failure-routing` |        |
| FR-2 | Failure context and authors                 | done        | `feature/workflow/failure-routing` |        |
| FR-3 | Tester failures to the author or the lead   | done        | `feature/workflow/failure-routing` |        |
| FR-4 | Core: When arrows, Author block, flow words | done        | `feature/workflow/failure-routing` |        |
| FR-5 | Engine: routing, fix turns, lead tools      | done        | `feature/workflow/failure-routing` |        |
| FR-6 | Web: When arrows and Flow in words          | done        | `feature/workflow/failure-routing` |        |
| FR-7 | Safety, docs, real run                      | not started |                                    |        |

## Log

- 2026-11-14 Planned on the owner's request. Step 0 (every arrow's purpose reaches its agent; Remove
  in the panel heading) done on `feature/workflow/arrows` (`eb48741`, PR #22). FR-0 done.
- 2026-11-14 FR-1 done: `report_test_results` (core schema, tester-only role tool, Claude MCP and
  gate, Codex dynamic tool, engine `testResultsByAgent` and `record-test-results`, server
  `test-results` comments split like research findings, web "Test results" box with the status);
  the tester's brief asks for one call and no product-code fix.
- 2026-11-14 FR-2 done: core `FailureContext` and `findAuthors` (file match; none → all helpers,
  flagged unknown); seals report changed paths (`EngineChange.files`); one renderer quotes every
  agent or tool text; the lead gets it on failing tests, change and merge checks (a harness that
  could not run is `harness-failed`), review rework (all routes), merge conflicts and ADR-0030
  resolutions.
- 2026-11-14 FR-3 done: a tester's failures never rework the tester. Failing test results and a
  tester's Checks block (`lead`) go to the lead with the context, and the handover is undone so it
  can start a fixer; `onFailure: helper` on a tester means the author: one known author whose
  change is merged gets a fix turn (a new helper of its node from the ticket branch); several,
  none or no room go to the lead.
- 2026-11-14 FR-4 done: core `when` arrow (`on` 1–5 events, `maxRounds` 1–5) and Author block;
  sources tester (tests-failed), Checks block (checks/harness-failed), change reviewer
  (review-rework), ticket merge (merge-conflict); targets helper, Lead or Author
  (`when-target-invalid`, `when-event-invalid`, `when-duplicate-route`; a block's "ask me" wins).
  `program.failureRoutes`: When arrows, then routes derived from reviewer rework arrows and "back
  to the helper" (`derived: true`; old fields unchanged, equivalence tests extended).
  `describeWorkflow` + `renderWorkflowDescription` for the lead brief and the web panel.
- 2026-11-14 FR-5 done (engine and server): one failure router (`failure-router.ts`) asked first
  by every failure (tester results, change and merge Checks blocks, change review incl. fan-out,
  merge conflicts incl. ADR-0030); only the owner's When arrows route, derived routes keep today's
  paths. Helper target: rework of the failing change when it is that block's helper's, else a new
  helper from the ticket branch; Author: the one known author, else the lead; Lead: context and
  purpose. Rounds per arrow and failing change; no free slot or room → lead (no queue). The lead
  is told every fix with its fixId; `reroute_fix` (stop, move in the same round, or take over) and
  `view_workflow`; "Your workflow" in the lead's first brief. Server: one-line app comment
  (`failure-routed`), ids and kind in logs.
- 2026-11-14 Coordinator: FR-5 and FR-6 accepted; FR-6 merged from
  `feature/workflow/failure-routing-web`. Full check green: 6921 tests.
