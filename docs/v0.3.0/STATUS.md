# v0.3.0 (S series): status

Coordinator-owned. Plan: [README.md](README.md). Decision:
[ADR-0024](../decisions/0024-session-names-and-run-summaries.md).

| WP  | Title                                      | After    | Status          | Branch        | Merged |
| --- | ------------------------------------------ | -------- | --------------- | ------------- | ------ |
| S-0 | ADR-0024, contract, docs                   | —        | **done**        | release/0.3.0 | (this) |
| S-A | Titles, managed session DTO, run summaries | S-0      | **in progress** |               |        |
| S-B | Web: session names, run summary card       | S-0      | **in progress** |               |        |
| S-V | Verification, real run, release prep       | S-A, S-B | not started     |               |        |

## Log

- 2026-10-21 The owner approved v0.3.0: session names at start, and a cheap but proper run summary
  comment ("the lead alone can comment what are all done"). `release/0.3.0` was created from
  `release/0.2.0` `259feee`. S-0 started.
- 2026-10-21 S-0 done: ADR-0024 accepted, contract (`app` author, `ManagedAgentSpec.title`,
  `SessionSummaryDto.managed`), plan. 4,601 tests. S-A and S-B started in parallel.
