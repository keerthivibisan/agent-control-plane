# Redesign status (coordinator-maintained)

> Only the coordinator edits this file. Agents record progress in `docs/redesign/wp/<WP>.md`.
> Plan and owned paths: [README.md](README.md) §7.

| WP  | Title                                               | Depends  | Status      | Branch | Merged     |
| --- | --------------------------------------------------- | -------- | ----------- | ------ | ---------- |
| R-0 | [Contracts, ADRs, progress files](wp/R-0.md)        | approval | **done**    | `main` | 2026-10-16 |
| R-A | [Shell, navigation, visual system](wp/R-A.md)       | R-0      | in-progress | —      | —          |
| R-C | [Engine: planner, reviewer, tester](wp/R-C.md)      | R-0      | in-progress | —      | —          |
| R-G | [Server and db wiring, migration 0004](wp/R-G.md)   | R-0, R-C | todo        | —      | —          |
| R-D | [Skills: server module and page](wp/R-D.md)         | R-0, R-A | todo        | —      | —          |
| R-F | [Tokens: query, route, page](wp/R-F.md)             | R-0, R-A | todo        | —      | —          |
| R-E | [Harness page](wp/R-E.md)                           | R-A      | todo        | —      | —          |
| R-B | [Workflow page](wp/R-B.md)                          | R-A, R-G | todo        | —      | —          |
| R-H | [Board, ticket, settings simplification](wp/R-H.md) | R-A, R-G | todo        | —      | —          |
| R-V | [Verification](wp/R-V.md)                           | all      | todo        | —      | —          |

**Also running:** Phase 4's P4-H server-side verification (`wp/p4-h-verify`; see `docs/phase-4/STATUS.md`).

**Environment notes:** these are the same as Phase 4 (STATUS there):

- use a pnpm 10 shim on `PATH`;
- vitest timeouts under heavy load are environmental, so rerun before treating one as a failure;
- e2e runs on free ports of 7500 or above. The owner's app runs on 7420/5173.
