# WG-C: Server, db and adapter

> Progress file for WG-C. Only the agent working on WG-C edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-C row and the "WG-0 refinements".

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | in-progress                                      |
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
- [ ] 6. API fuzz (correctness layer 3, server part)
- [ ] 7. Integration tests: scenarios a, b, c to the owner's merge; named helper from a plan step;
      refused plan step; `maxInstances`; plan auto via the gate and tightened; v1-stored project;
      snapshot survives a restart
- [ ] 8. Docs (`security.md`, `architecture.md`), status `review`, `pnpm check`, full e2e, report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                        | Commit  | Checks                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| 2026-10-18 | Claimed WG-C                                                                                                                                         | b322cf6 | format ✓ lint ✓ typecheck ✓ test 3909/3909 ✓ build ✓                               |
| 2026-10-18 | db: stored workflow v1/v2, graph write, v1 write refused over a graph; snapshot `graph`/`graphContext`; plan step helper round trip                  | 2b7b064 | format ✓ lint ✓ typecheck ✓ test 3917/3917 ✓ build ✓                               |
| 2026-10-18 | Server: `/workflow-graph` GET, PUT (422), validate; v1 routes 409 for a graph; skills and agent files used by graph nodes                            | 8eeb914 | format ✓ lint ✓ typecheck ✓ test 3931/3931 ✓ build ✓                               |
| 2026-10-18 | Runs: graph start (validate 409, ceilings, context, snapshot, prompts), restart reload, plan step helpers stored, run graph DTO; approvals per agent | 38407f6 | format ✓ lint ✓ typecheck ✓ test 3942/3942 ✓ build ✓ (package tests one at a time) |
| 2026-10-18 | Adapter: launch protection per agent (auto mode + sandbox, or sandbox in `default`), mixed-mode and read-only-role tests; contract proposal 1        | (this)  | format ✓ lint ✓ typecheck ✓ test 3951/3951 ✓ build ✓ (package tests one at a time) |

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
