# WG-C: Server, db and adapter

> Progress file for WG-C. Only the agent working on WG-C edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-C row and the "WG-0 refinements".

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | paused                                           |
| Owner   | WG-C agent (Claude Code)                         |
| Branch  | `wp/wg-c-server` (from `feature/workflow-graph`) |
| Started | 2026-10-18                                       |
| Updated | 2026-10-18                                       |

## Tasks

- [x] 1. db: `project_workflow` reads `StoredWorkflowJsonSchema` (v1 or v2), writes v2; a v1 write
      over a stored v2 graph is refused (typed error → 409); the run snapshot gains `graph?` and
      `graphContext?` (Zod on read and write; older snapshots parse); plan steps keep `helper`
- [x] 2. Server, project workflow: `GET`/`PUT /api/projects/:id/workflow-graph`,
      `POST …/workflow-graph/validate`; skills and agent files "used by" from the graph; delete
      guards from the graph; v1 `GET /workflow` answers 409 for a v2-stored project
- [x] 3. Server, runs: `startTicket` validates (409 `workflow_invalid`), builds the ceilings and
      `graphContext`, compiles, snapshots `graph` and `graphContext`; restart reloads them;
      `ticketRunPrompts` from the program; `GET /api/runs/:id/workflow-graph`
- [x] 4. Control service: approvals per agent (`effectiveMode`, per-agent Full auto gate and
      allowlist; the lead, planner and reviewers never covered)
- [x] 5. Adapter: launch per agent from `agentLaunchMode` (auto mode + sandbox, sandbox only with
      `default`, never auto for the lead, planner or reviewers)
- [ ] 6. API fuzz (correctness layer 3, server part) — written and passing, uncommitted
- [ ] 7. Integration tests: scenarios a, b, c to the owner's merge; named helper from a plan step;
      refused plan step; `maxInstances`; plan auto via the gate and tightened; v1-stored project;
      snapshot survives a restart — 10 written and passing (restart: in graph-runs, committed);
      the server-level mixed-mode test times out; uncommitted
- [ ] 8. Docs (`security.md`, `architecture.md`), status `review`, `pnpm check`, full e2e, report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                        | Commit  | Checks                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| 2026-10-18 | Claimed WG-C                                                                                                                                         | b322cf6 | format ✓ lint ✓ typecheck ✓ test 3909/3909 ✓ build ✓                               |
| 2026-10-18 | db: stored workflow v1/v2, graph write, v1 write refused over a graph; snapshot `graph`/`graphContext`; plan step helper round trip                  | 2b7b064 | format ✓ lint ✓ typecheck ✓ test 3917/3917 ✓ build ✓                               |
| 2026-10-18 | Server: `/workflow-graph` GET, PUT (422), validate; v1 routes 409 for a graph; skills and agent files used by graph nodes                            | 8eeb914 | format ✓ lint ✓ typecheck ✓ test 3931/3931 ✓ build ✓                               |
| 2026-10-18 | Runs: graph start (validate 409, ceilings, context, snapshot, prompts), restart reload, plan step helpers stored, run graph DTO; approvals per agent | 38407f6 | format ✓ lint ✓ typecheck ✓ test 3942/3942 ✓ build ✓ (package tests one at a time) |
| 2026-10-18 | Adapter: launch protection per agent (auto mode + sandbox, or sandbox in `default`), mixed-mode and read-only-role tests; contract proposal 1        | b7caf02 | format ✓ lint ✓ typecheck ✓ test 3951/3951 ✓ build ✓ (package tests one at a time) |
| 2026-10-18 | Paused by the owner (progress file only; fuzz and scenario tests left uncommitted, see Resume here)                                                  | (this)  | format ✓ (progress file only)                                                      |

## Resume here

- **Committed and green:** tasks 1–5 (db `2b7b064`, project workflow routes `8eeb914`, runs and
  approvals per agent `38407f6`, adapter `b7caf02`).
- **Uncommitted (in the worktree, not staged), task 6 and most of task 7:**
  - `packages/server/tests/workflow/graph-fuzz.test.ts` (new): the API fuzz, 50 generated graphs
    PUT 200 and start a ticket; 12 base graphs × every mutation (> 250 cases) PUT 422, validate
    `ok: false` with the validator's exact issues, start 409 when stored directly. **Passes**
    (about 5 s).
  - `packages/server/tests/board/graph-scenarios.test.ts` (new): scenarios a, b, c to the owner's
    merge; named helper from a plan step (kept across a restart); refused plan step listing the
    helper nodes; `maxInstances`; plan auto via the gate, tightened by a ticket, and a gate that
    asks; a version 1 project with the same briefs, stages and models. **These 10 pass.** One
    test I added last, "a mixed-mode run through the server" (Manual named helper, Full auto
    pool, Auto edits tester to the tester's start), **times out at 60 s**, so nothing was
    committed.
- **Next concrete step:** debug that test (run it alone with `-t "mixed-mode"`). Likely causes to
  check first: an `await` on a permission that never resolves (`tester.ask('Bash', …)` in Auto
  edits parks for the owner and is awaited: do not await it, or decide it through
  `/api/approvals/:id`), or the tester not starting because the denied Manual helper's change
  is still undecided when the lead calls `request_review` (decide or discard it first). Fix or
  drop that test, then run the check, commit task 6/7 ("test(server): API fuzz and workflow
  graph scenarios (WG-C)").
- **Then:** task 8: docs (`docs/security.md` and `docs/architecture.md`: approval modes per
  node, tighten-only, graph runs, the 409/422 codes), status `review`, `pnpm check`, the full e2e
  on free ports (`ACP_E2E_PORT=7731 ACP_E2E_CONTROL_PORT=7741 pnpm --filter @acp/web test:e2e`,
  never 7420 or 5173), and the completion report.
- **Machine load:** the shared machine reached load 30+, and the parallel `pnpm check` then timed
  out unrelated server tests at 5 s. The last three commits were checked with the same steps but
  package tests one at a time (`pnpm -r --workspace-concurrency=1 --if-present run test`), all
  green (3951 tests).
- **Open question for the coordinator:** contract proposal 1 below (`ManagedAgentSpec.sandbox?`).
  Until it lands, a Full auto node that a ticket or run tightens fails closed at start
  (diagnostic `sandbox-without-auto-mode-unsupported`).
- **Decisions taken (for review):** version 1 and default projects now start graph runs (their
  workflow migrated) and still snapshot the version 1 workflow; legacy test-only runs of version 1
  projects are unchanged; the version 1 `GET`/`PUT /workflow` answer 409 `workflow_is_graph` for a
  graph project; a run start with an invalid stored graph answers 409 `workflow_invalid`; a PUT
  with errors answers 422 `workflow_invalid`; change cards take their round limit from each
  change's route.

## Decisions and findings

### Proposal 1 (contract, coordinator): the sandbox without auto mode on `ManagedAgentSpec`

- **What:** an additive field that asks the adapter for Full auto's OS sandbox, deny rules and
  temp folder while the session stays in `permissionMode: 'default'`.
- **Why:** a node configured as Full auto that a ticket or run tightens must keep its sandbox
  (owner decision, ADR-0023 §5, `agentLaunchMode` → `{autoMode: false, sandbox: true}`), but
  `ManagedAgentSpec.fullAuto` always means auto mode plus the sandbox, so the server cannot ask
  for the sandbox alone without loosening the agent. Until the field exists, the server **fails
  such an agent closed** (it ends FAILED before any process starts, diagnostic
  `sandbox-without-auto-mode-unsupported`); it never runs it unsandboxed or in auto mode.
- **Proposed diff** (`packages/core/src/adapters/managed.ts`):

  ```ts
  /**
   * ADR-0023 §5: a `worker` or `tester` whose node is configured as Full auto but which a ticket
   * or run tightened: the same OS sandbox, deny rules and temp folder as `fullAuto`, while the
   * session stays in `permissionMode: 'default'`, so the server's gate decides every request by
   * the tightened mode. Never set together with `fullAuto`; ignored for other roles and
   * follow-ups. If the sandbox cannot start the agent ends with `finished.failure`.
   */
  sandbox?: FullAutoSpec;
  ```

- **Then (WG-C, two lines):** `launchProtectionOf` in
  `adapters/claude-code/src/managed/full-auto.ts` returns `{autoMode: false, paths: spec.sandbox}`
  for it (the options builder, `applyProtection` with `autoMode: false`, and its tests are already
  in place), and the server's `fullAutoFor` sends `sandbox` instead of failing closed.
- **Who is affected:** core (one optional field), the adapter, the server; the web and the
  engine are not.
