# WG-C: Server, db and adapter

> Progress file for WG-C. Only the agent working on WG-C edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-C row and the "WG-0 refinements".

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | review                                           |
| Owner   | WG-C agent (Claude Code)                         |
| Branch  | `wp/wg-c-server` (from `feature/workflow-graph`) |
| Started | 2026-10-18                                       |
| Updated | 2026-10-20                                       |

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
- [x] 6. API fuzz (correctness layer 3, server part)
- [x] 7. Integration tests: scenarios a, b, c to the owner's merge; named helper from a plan step;
      refused plan step; `maxInstances`; plan auto via the gate and tightened; v1-stored project;
      snapshot survives a restart; plus a mixed-mode run through the server
- [x] 8. Docs (`security.md`, `architecture.md`), status `review`, `pnpm check`, full e2e, report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                        | Commit  | Checks                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| 2026-10-18 | Claimed WG-C                                                                                                                                                         | b322cf6 | format ✓ lint ✓ typecheck ✓ test 3909/3909 ✓ build ✓                                            |
| 2026-10-18 | db: stored workflow v1/v2, graph write, v1 write refused over a graph; snapshot `graph`/`graphContext`; plan step helper round trip                                  | 2b7b064 | format ✓ lint ✓ typecheck ✓ test 3917/3917 ✓ build ✓                                            |
| 2026-10-18 | Server: `/workflow-graph` GET, PUT (422), validate; v1 routes 409 for a graph; skills and agent files used by graph nodes                                            | 8eeb914 | format ✓ lint ✓ typecheck ✓ test 3931/3931 ✓ build ✓                                            |
| 2026-10-18 | Runs: graph start (validate 409, ceilings, context, snapshot, prompts), restart reload, plan step helpers stored, run graph DTO; approvals per agent                 | 38407f6 | format ✓ lint ✓ typecheck ✓ test 3942/3942 ✓ build ✓ (package tests one at a time)              |
| 2026-10-18 | Adapter: launch protection per agent (auto mode + sandbox, or sandbox in `default`), mixed-mode and read-only-role tests; contract proposal 1                        | b7caf02 | format ✓ lint ✓ typecheck ✓ test 3951/3951 ✓ build ✓ (package tests one at a time)              |
| 2026-10-18 | Paused by the owner (progress file only; fuzz and scenario tests left uncommitted, see Resume here)                                                                  | (this)  | format ✓ (progress file only)                                                                   |
| 2026-10-20 | Rebased on `feature/workflow-graph`; `ManagedAgentSpec.sandbox` wired (adapter and server), fail-closed path removed                                                 | e399ba8 | format ✓ lint ✓ typecheck ✓ test 3971/3971 ✓ build ✓                                            |
| 2026-10-20 | API fuzz and scenario tests (the mixed-mode timeout was a test awaiting a parked approval)                                                                           | b4bb8a2 | format ✓ lint ✓ typecheck ✓ test 3971/3971 ✓ build ✓                                            |
| 2026-10-20 | Docs (`security.md` §4, `architecture.md` §8); status `review`; full e2e 62/62 on 7731/7741                                                                          | (this)  | format ✓ lint ✓ typecheck ✓ test 3971/3971 ✓ build ✓; e2e 62/62 ✓                               |
| 2026-10-20 | Rebased on `feature/workflow-graph` `c2a77d1` (WG-E merged); full e2e 60/63: three web specs still assert the version 1 live view and agent "used by" (see Findings) | (this)  | format ✓ lint ✓ typecheck ✓ test 4001/4001 ✓ build ✓ (package tests one at a time); e2e 60/63 ✘ |

## Resumed (2026-10-20)

- Paused 2026-10-18 (`844eb24`), resumed 2026-10-20. Rebased onto `feature/workflow-graph`
  (`58050e5`, with the coordinator's `ManagedAgentSpec.sandbox` contract `1a341dc`): the commits
  in the log above before the pause now have these ids: claim `7d02483`, db `8035f82`, server
  routes `163a7ae`, runs `b51b652`, adapter `a08212e`, pause note `1e283e6` (after the second
  rebase onto `c2a77d1`).
- Proposal 1 is wired (`e399ba8`). The fail-closed path for a tightened Full auto block is
  **removed**; the only start refusal left there is a sandbox temp folder that cannot be made
  (`full-auto-unavailable`, as before).
- The mixed-mode test's timeout was a **test bug**: it awaited a tester command that parks for the
  owner under Auto edits. It now decides it through `/api/approvals/:id` (`b4bb8a2`). No engine or
  server bug.

## Decisions and findings

### Proposal 1 (contract, coordinator): the sandbox without auto mode on `ManagedAgentSpec` — accepted (`1a341dc`), wired (`e399ba8`)

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

### Decisions (for review)

- **All new non-legacy ticket runs are graph runs.** A version 1 or default project runs its
  workflow migrated with the project mode (`migrateWorkflowV1`) and also keeps its version 1
  `workflow` snapshot (for the version 1 live view until WG-E). Legacy test-only runs
  (`legacyTicketRuns`) of version 1 projects are unchanged; a graph project in legacy mode starts
  its graph without the review loop.
- **Ceilings:** `graphContext.approvalCeilings` = [ticket mode, one-run mode], each only when set;
  `reviewer`/`maxReworkRounds` only when the ticket or run sets them. The run's
  `approvalPolicy.mode` = `tightenMode(null, projectMode, ...ceilings).mode` (so `RunDetailDto
.approvalMode` is that tightened mode).
- **Project review defaults** for `resolveRunOptions` (which fill the run's review-loop record and
  `RunDetailDto.reviewer`/`maxReworkRounds`): a version 1 workflow's review stage, as before; for
  a stored graph, `agent` when it has a change reviewer else `lead`, and the largest rework edge.
- **Change cards** (`ChangeReviewDto.maxReworkRounds`) come from each change's review route:
  `leadRounds`, plus `reviewerRounds` on route c.
- **Run start validation** uses the project's helper limit and mode only (skills and agent files
  give warnings, which never block); the API fuzz checks the save and start verdicts against the
  validator.
- **`usedBy`** (version 1 stage ids): a version 1 project answers exactly as before; a graph
  project answers its agent blocks whose id is a version 1 stage id. Delete guards: version 1
  stages for version 1 projects (unchanged messages), graph blocks for graph projects ("used by
  these workflow blocks: …").
- **Plan steps** are stored with the helper node the engine resolved (`planStepHelpers`), and
  reloaded into `planStepHelpers` when every step of a plan has one.
- **Gating on a loaded machine:** some commits were gated with the same steps as `pnpm check` but
  package tests one at a time (noted in their `Checks:` lines); the final gate was a plain
  `pnpm check`.

### Finding: three web e2e specs need updating once WG-C and WG-E are together (not in WG-C's paths)

Full e2e on the rebased branch (ports 7731/7741): **60 passed, 3 failed** (63 tests). WG-E's
ticket and review-loop specs (mocked `/workflow-graph`) pass. The three failures appear only
because the real `GET /api/runs/:id/workflow-graph` and `GET /api/projects/:id/workflow-graph`
are now served, so the web switches from the version 1 views to the graph views, which these specs
do not expect:

- `e2e/workspace.spec.ts:228` waits for `live-plan` (version 1 live view). The graph view's block is
  `live-node-plan-approval` (`LiveGraphNodes.tsx`).
- `e2e/review-loop-live.spec.ts:426` (and :494, :508) waits for `live-owner-merge`. The graph view's
  block is `live-node-owner-merge`.
- `e2e/skills.spec.ts:283` mocks only the version 1 `GET /api/projects/:id/workflow` to put agent
  `reviewer` on two stages; the Skills page now reads "Used by" from `/workflow-graph`
  (`SkillsPage.tsx`, `nodesUsingAgent`), which the spec does not mock, so it shows none. The spec
  should mock `/workflow-graph` too (or use the server's `usedByNodes`), and its expected labels
  become block labels (for a version 1 lead-mode project the plan stage's agent sits on the
  `Lead` block, the code review on `Code reviewer`).

These are `packages/web/e2e/**` changes (WG-D held its spec updates for exactly this, see STATUS).
The server answers per the DTOs; no server change is needed.
