# R-C — Engine: planner, reviewer, tester stages

> Progress file for R-C. Only the agent working on R-C edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value           |
| ------- | --------------- |
| Status  | review          |
| Owner   | engine agent    |
| Branch  | `wp/r-c-engine` |
| Started | 2026-10-16      |
| Updated | 2026-10-16      |

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                 | Commit  | Checks                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| 2026-10-16 | Claimed R-C on `wp/r-c-engine` from `main` (eb458d6).                                                                                                                         | claim   | —                                                                                |
| 2026-10-16 | WIP engine: workflow snapshot, agent stages, separate planner, reviewer/tester stages, post_review, continueStages, controlToolsFor, prompts. Paused by owner.                | 6198d90 | typecheck ✗; orchestrator tests 366/366 ✓ (existing)                             |
| 2026-10-16 | Resumed; rebased on main (a532ef2). Decision B: `post_review` in `LeadToolInputs`; the adapter's lead set excludes it.                                                        | 1e9b64f | core 244 ✓, claude-code 269 ✓ (orchestrator still WIP)                           |
| 2026-10-16 | Engine compiles: post_review via the core schema, skills plugin names and `start-agent.skills`, policy for the new roles, `deriveRunWorkflow`, exports.                       | cb04a86 | format ✓ lint ✓ typecheck ✓ test ✓ (two server timeouts passed on rerun) build ✓ |
| 2026-10-16 | Tests: default equivalence, separate planner, code review, unit tests, both, Stop/Stop all, restart + Continue, skills/models, `deriveRunWorkflow`; allowlist takes any role. | 33f9d65 | format ✓ lint ✓ typecheck ✓ orchestrator 424/424 ✓                               |
| 2026-10-16 | Adapter toolsets per role and the skills plugin (decision E), fake-query tests.                                                                                               | b233ded | format ✓ lint ✓ typecheck ✓ claude-code 283/283 ✓                                |
| 2026-10-16 | Orchestrator README (stage rules, notes for R-G); rebased on main (c81e2f2); completion report; status `review`.                                                              | 7dbed43 | format ✓ lint ✓ typecheck ✓ test 1793/1793 ✓ build ✓                             |

## Handoff notes

### For R-G (server wiring)

The rules are in `packages/orchestrator/README.md`, "Workflow stage rules" and "Notes for R-G".
In short:

1. **Create a ticket run** with the project's workflow:

   ```ts
   const { limits, budget } = runSettingsFromSetup(setup);
   createRun(
     {
       runId,
       leadAgentRunId,
       projectId,
       title,
       budget,
       limits,
       registeredProjectIds,
       workflow, // the project_workflow row, or omit it / defaultProjectWorkflow() for Phase 4
       ticket: { ticketId, ...ticketRunPrompts(ticket, limits, workflow) },
     },
     ctx,
   );
   ```

   `workflow` is refused on a run without a ticket. In separate mode `ticketRunPrompts` returns
   `plannerPrompt` too.

2. **Persist:**
   - `EngineAgent.stage` → `agent_runs.stage`;
   - `RunState.workflow` (the snapshot): 0004 has no column for it. Store it with the run, for
     example next to the limits in `orchestration_runs.limits` JSON, or in a new migration.
     Without it after a reload the run behaves like the default workflow.
   - Keep `leadBrief`, `stagesHeld` and `EngineAgent.reviewPosts` with the live run, in memory
     like the ledger.
3. **`start-agent` effects by `kind`:**
   - `lead`, `planner`: read-only in the owner's project folder; deny their tool uses like the
     lead's (the engine also refuses the planner's).
   - `worker`, `tester`: a worktree from the current main branch (the tester's includes the merged
     change); the tester never gets `canStartHelpers`.
   - `reviewer`: the `create-review-checkout` effect comes just before; start it in that checkout.
   - Spec: `kind: effect.kind`, `model: effect.model ?? setup.model`, `leadTools` for the lead,
     the planner, the reviewer and depth-2 parent helpers (route calls through `leadToolCall`).
   - **Skills:** when `effect.skills` is present (bare names), build the run's skills plugin from
     the project checkout (ADR-0019 §4) and set
     `spec.skillPlugin = { path, skills: effect.skills.map(pluginSkillName) }`, giving
     `['acp-skills:<name>', …]`. The prompt already holds the line
     ``Use the project skill `acp-skills:<name>`.``
4. **New effects:**
   - `create-review-checkout { agentRunId }`: a temporary detached worktree of main (the "Run checks
     now" mechanism, ADR-0017);
   - `remove-review-checkout { agentRunId }`: remove it (emitted after the reviewer's abort, and by
     `recoverAfterRestart` for an interrupted reviewer);
   - `review-comment { agentRunId, body }`: store a `TicketComment` with author `reviewer`,
     `runId`, `planId: null`. The body is already redacted and capped at 8,000 characters.
5. **Routes and checks:**
   - expose `continueStages(state, ctx)` (an owner "Continue" action, refused with
     `run-not-active`, `run-cancelling`, `workers-still-running` or `review-not-allowed`);
   - serve `deriveRunWorkflow(state, workflow?)` as `RunWorkflowDto`;
   - the server's review and checks code still tests `kind === 'worker'`
     (`board/checks.ts:94` and `:153`, `control/service.ts:586` and `:970`,
     `control/mappers.ts:63`, `board/service.ts:181` and `:201` helper counts): let the tester
     through, and count the reviewer and tester as helpers;
   - `evaluateAllowlist` now takes any `AgentRoleKind`; pass the agent's real kind.
6. **The run stays `REVIEW`** while the reviewer and the tester work (the transition table is
   pinned by tests). The ticket stage is then `IN_REVIEW`; the live graph shows which stage is
   active. The ticket is DONE when the run is COMPLETED, as before.

## Blockers / proposed contract changes

None open. Decisions A (`ManagedAgentSpec.kind: AgentRoleKind`) and E (`skillPlugin`) landed on
main. B (`post_review`) is in commit 1e9b64f on this branch. C (a planner chat role) is deferred.

One possible follow-up, not needed for R-G: in separate mode the adapter still shows the lead
`submit_plan` (the spec has no field that says the mode). The engine refuses the call with a clear
message. A small optional contract field would hide it, for example
`ManagedAgentSpec.controlTools?: readonly LeadToolName[]` filled from `controlToolsFor`.

## Completion report (AGENTS.md §9)

## Completion report — R-C

1. **Summary.** The engine takes and snapshots the project's workflow, runs the separate planner,
   the post-merge code review and unit tests stages, records each agent's stage, and derives the
   live stage states. The adapter gives every role its toolset and passes the skills plugin. The
   default workflow behaves exactly like Phase 4.
2. **Files changed.**
   - Created: `packages/orchestrator/src/{stages,plan-read,review-tool,run-workflow}.ts`;
     `packages/orchestrator/tests/{workflow-helpers.ts,separate-planner.test.ts,post-merge-stages.test.ts,workflow.test.ts}`;
     `packages/adapters/claude-code/tests/managed/roles.test.ts`.
   - Modified: `packages/orchestrator/src/{state,draft,commands,plan,lead-tools,policy,allowlist,index}.ts`,
     `packages/orchestrator/README.md`; `packages/adapters/claude-code/src/managed/{permissions,lead-tools,adapter,messages,index}.ts`,
     `packages/adapters/claude-code/tests/managed/{permissions,adapter}.test.ts` (lead set without
     `post_review`); `packages/core/src/orchestration/orchestration.ts` and
     `packages/core/tests/orchestration-contracts.test.ts` (decision B, own commit);
     `docs/redesign/wp/R-C.md`.
   - Deleted: none.
3. **Commands and results** (Node 22.21.1, pnpm 10.26.1, after rebasing on main c81e2f2):
   `pnpm check` exit 0: format ✓, lint ✓, typecheck ✓, test 1793/1793 ✓ (core 244, demo 12,
   orchestrator 424, claude-code 283, db 153, web 354, server 323), build ✓. An earlier run had two
   server timeouts (`smoke.test.ts`, `restart.test.ts`) that passed on rerun.
4. **Acceptance criteria.**
   - Workflow taken and snapshotted at run creation; default equals Phase 4: **met** (existing
     366 tests unchanged and green; `workflow.test.ts` replays the full ticket flow with and
     without `defaultProjectWorkflow()` and compares every effect, value and state).
   - Separate planner (read-only, `submit_plan` only, revises on comments, stops on approval, lead
     starts with the plan and cannot change it): **met** (`separate-planner.test.ts`).
   - Code-review stage (read-only reviewer, detached checkout effect, `post_review` comments,
     capped and redacted, never blocks): **met** (`post-merge-stages.test.ts`).
   - Unit-tests stage (tester worker, fixed brief, same review and merge): **met**.
   - Sequencing, helper limit, Stop and Stop all in every stage, restart without relaunch: **met**
     (`stagesHeld` + `continueStages`).
   - `stage` per agent and `deriveRunWorkflow`: **met** (validated with `RunWorkflowDtoSchema`).
   - Skills: one line per stage skill naming `acp-skills:<name>`, names on the effect, no file
     content: **met**.
   - Adapter toolsets per role with fake-query tests, plus `skillPlugin`: **met**
     (`roles.test.ts`), except that the lead in separate mode still sees `submit_plan` (engine
     refuses it; see the follow-up above).
   - Audit of `kind === 'lead'` / `'worker'` branches: **met** in the orchestrator (policy, lead
     tools, permissions, allowlist, review, Stop all, chat text) and the managed adapter. Server
     branches are listed for R-G.
5. **Assumptions** (documented in the orchestrator README):
   - Post-merge stages run while the run stays REVIEW, so `RUN_TRANSITIONS` is unchanged.
   - They run only when at least one helper's change was merged.
   - The lead is stopped when the first post-merge stage starts.
   - A reviewer that fails or is stopped finishes its stage, and so does an owner-discarded tester
     change. A restart-interrupted reviewer is re-run only through Continue.
   - In lead mode the lead's model is the orchestrate stage's, else the plan stage's.
   - Planner chat shows as `lead` (decision C).
   - No new refusal codes; existing codes are reused.
   - Post cap: 5 posts per reviewer.
6. **Contract or shared-file changes:** decision B, made as approved (own commit). Nothing else is
   needed; the optional `controlTools` field is above.
7. **Known gaps and follow-ups:**
   - R-G wiring (above).
   - The workflow snapshot needs a place in the db.
   - R-V must check in the real smoke run that skills load through the plugin and that the
     reviewer's `disallowedTools` hold.
   - The lead still sees `submit_plan` in separate mode.
8. **Next recommended task:** R-G part 2 (run-service wiring of these stages).
