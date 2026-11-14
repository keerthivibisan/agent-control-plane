# Failure routing (FR series): status

Coordinator-owned. Plan: [README.md](README.md).

| WP   | Title                                       | Status      | Branch                             | Merged |
| ---- | ------------------------------------------- | ----------- | ---------------------------------- | ------ |
| FR-0 | ADR-0038, plan                              | done        | `feature/workflow/failure-routing` |        |
| FR-1 | Structured test results                     | not started |                                    |        |
| FR-2 | Failure context and authors                 | not started |                                    |        |
| FR-3 | Tester failures to the author or the lead   | not started |                                    |        |
| FR-4 | Core: When arrows, Author block, flow words | not started |                                    |        |
| FR-5 | Engine: routing, fix turns, lead tools      | not started |                                    |        |
| FR-6 | Web: When arrows and Flow in words          | not started |                                    |        |
| FR-7 | Safety, docs, real run                      | not started |                                    |        |

## Log

- 2026-11-14 Planned on the owner's request. Step 0 (every arrow's purpose reaches its agent; Remove
  in the panel heading) done on `feature/workflow/arrows` (`eb48741`, PR #22). FR-0 done.
- 2026-11-14 FR-1 done: `report_test_results` (core schema, tester-only role tool, Claude MCP and
  gate, Codex dynamic tool, engine `testResultsByAgent` and `record-test-results`, server
  `test-results` comments split like research findings, web "Test results" box with the status);
  the tester's brief asks for one call and no product-code fix.
