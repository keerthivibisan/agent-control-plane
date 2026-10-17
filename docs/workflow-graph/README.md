# Editable workflow graphs (WG series, v0.2.0)

Coordinator-owned plan. Status: [STATUS.md](STATUS.md). Decision: [ADR-0023](../decisions/0023-editable-workflow-graphs.md).
Progress files: `wp/WG-*.md`, one per WP, edited only by that WP's agent (protocol:
`docs/phase-4/README.md` §9 with these paths). Branches `wp/wg-<id>-<slug>` come off
`feature/workflow-graph` and merge back with `--ff-only` after review. The finished feature merges
into `dev`, and the owner merges `dev` into `main` by MR. Agents and the coordinator never touch
`main`.

> **Read §"WG-0 refinements" at the end first.** WG-0 settled details the plan left open;
> where they differ from the text above them, the refinements win.

## Context

v0.1.0 shipped with a fixed workflow: plan → orchestrate → helpers → review → code-review →
unit-tests. The order is hard-coded in the engine (`stages.ts:nextStage`, `draft.ts:reconcile`),
and behaviour is keyed on five role kinds.

The owner wants each project to **draw its own agents and flow as a connectable graph**, with a
**per-agent approval mode**. Every review scenario must be expressible:

- (a) the lead reviews and merges itself;
- (b) a review agent sends its findings to the lead, who decides;
- (c) the reviewer sends comments straight to the helper for rework, in a loop, and the lead then
  merges.

In every scenario the owner still merges the ticket branch into `main` once.

**Owner decisions (2026-10-17):**

- **Building blocks with rules:** a palette with validated connections, not free-form.
- **Templates:** offered at project creation and on the Workflow page ("Lead only", "Today's
  setup", "Reviewer ↔ helper loop"), or build your own.
- **Approval modes:** each agent node sets its own mode. Ticket and run settings can only
  **tighten** it, never loosen it.
- **Sandbox:** a node configured as Full auto **keeps the OS sandbox** even when a ticket tightens
  it.
- **Plan auto-approval:** decided by a switch on the **Plan approval** block.
- **Helpers:** a helper **pool and named helpers** (e.g. "Frontend helper"), each with its own
  agent file, skill, model and mode.
- **Coordinator defaults:**
  - in loop (c) the lead is told about each round;
  - "Lead reviews" stays as a ticket/run override;
  - a plan step with no matching helper node is refused, with the list of helper nodes.

**Branches:** `dev` from `main` (`b6a1f27`), then `feature/workflow-graph`, then
`wp/wg-*`.

## Approach: a graph of rule-checked building blocks

Each node type maps to one of today's role kinds, and its **capabilities are fixed** by that type.
Owners only choose and wire blocks. Every safety invariant stays enforced in the engine, server and
adapter, so no graph can switch one off:

- `main` changes only through the owner's merge;
- the ticket branch moves only through the lead's `merge_change`, the checks and compare-and-swap;
- read-only by kind;
- plan-first in `checkStartAgent`;
- worktrees only for helpers and the tester;
- limits and hard caps;
- no subagents.

This answers ADR-0019's objection to a free-form editor. **No SQL migration:** today's workflow
migrates to a graph whose node ids equal the old stage ids, so `agent_runs.stage` and old run
snapshots keep parsing.

### 1. Graph model (core, `packages/core/src/workspace/workflow-graph.ts`)

- **Node types and their fixed capabilities:**

  | Node type                                          | Kind     | Behaviour                                                                    |
  | -------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
  | `planner`                                          | planner  | read-only, `submit_plan`                                                     |
  | `lead`                                             | lead     | read-only; helper, change and handover tools; plans when there is no planner |
  | `helper-pool`                                      | worker   | own worktree, reviewable change, approval mode                               |
  | `helper` (named: label, description, maxInstances) | worker   | own worktree, reviewable change, approval mode                               |
  | `reviewer` scope `change`                          | reviewer | read-only, `submit_review`                                                   |
  | `reviewer` scope `final`                           | reviewer | read-only, `post_review`                                                     |
  | `tester`                                           | tester   | own worktree from the ticket tip, approval mode                              |

  Plus the gates `ticket`, `plan-approval` (`auto: boolean`), `checks`, `ticket-merge`,
  `owner-merge` and `done`. All of this is in a `NODE_CAPABILITIES` table, and the `stages.ts`
  predicates are derived from it.

- **Node config:** model, skills (at most 3), agent file. Approval mode only on edit-capable nodes;
  the discriminated union makes it unrepresentable on read-only nodes. No free-text prompt override:
  extra instructions go through the node's agent file.
- **Edge types:**
  - `flow`, `assigns`, `review`, `findings` (`on: every-verdict | approved`), `rework` (`maxRounds`
    0–5) and `merge`;
  - editor positions are optional, and nodes without one are auto-laid out.
- **Versions:**
  - `WorkflowGraph {version: 2, template, nodes, edges, legacyV1?}`;
  - `StoredWorkflowSchema = v2 | v1`;
  - `migrateWorkflowV1(v1, approvals)` is pure and lossless, with golden tests proving the same
    launch fields as today for every v1 combination.
- **Templates** in core: `lead-only`, `todays-setup` (with a planner toggle) and
  `reviewer-helper-loop`.

### 2. Validation (`validateWorkflowGraph`, pure, shared by the editor, PUT and `createRun`)

- **Counts:**
  - exactly one each of ticket, plan-approval, lead, checks, ticket-merge, owner-merge and done;
  - at most one planner and at most one pool;
  - at least one helper node;
  - named helpers at most `HARD_MAX_HELPERS`, with unique labels that are not coordinator words.
- **Edge-type matrix** (`canConnect`, also used for live drag checks):
  - assigns: lead or planner → helper;
  - review: helper or tester → change-reviewer or lead;
  - findings: change-reviewer → lead;
  - rework: change-reviewer or lead → a node it reviews;
  - merge: lead → checks only.
- **Paths:**
  - plan path `ticket → author → plan-approval (→ lead)`;
  - every helper and tester has exactly one review route;
  - `findings.on = approved` needs reviewer rework edges (scenario c);
  - only the lead merges, through the checks;
  - after the merge, a linear chain `ticket-merge → (final reviewer | tester)* → owner-merge → done`;
  - acyclic except for rework edges;
  - every node reachable.
- **Messages:** plain-language errors and warnings with a node or edge id; warnings for missing
  skills or agent files and for limits.

### 3. Engine (`packages/orchestrator`)

- **Compiled program:** `compileWorkflow(graph, ceilings) → WorkflowProgram` (pure, in core), built
  in memory when a run is created or loaded and never persisted. It holds:
  - the lead, the planner and `planAutoApprove`;
  - the helper nodes, each with its launch fields, effective mode, `maxInstances`,
    `canStartHelpers` and review route `{by: lead}` or `{by: agent, reviewer, then: lead|direct,
rounds}`;
  - `finalStages[]`;
  - `nodeModes`.
- **Node-keyed agents:** `EngineAgent.stage` becomes `WorkflowNodeId`. The `stages.ts` helpers
  (`skillsFor`, `stageModelFor`, `stageAgentFor`, `agentStage`, `stagesForRole`) become
  `launchFieldsFor(program, nodeId)`, with the same precedence: node > agent file > project.
- **Program replaces the fixed rules:**
  - `nextStage` iterates `program.finalStages`;
  - `isSeparatePlanner` comes from the program;
  - one lead is kept (DB index 0005).
- **Named helpers:** additive `submit_plan.steps[].helper?` and `start_agent.helper?`.
  - Resolution: explicit id, else a role equal to a node label, else the pool; otherwise refuse
    with the list.
  - A `maxInstances` check is added per node.
  - The briefs list the helper nodes.
- **Review routes in `loop.ts`:**
  - (a) and (b) are today's lead and agent paths per route.
  - (c): `submitReview` with `then: direct` reworks the helper directly while rounds and budget
    allow (`decidedBy: 'reviewer'`). The lead gets an info line each round. When the reviewer
    approves, or the rounds run out, the change goes to `decision` and the lead merges or decides.
- **Approval per agent:**
  - `effectiveMode(state, agent) = nodeModes[agent.stage] ?? approvalPolicy.mode`;
  - `tightenMode(node, ticketCeiling, runCeiling)`;
  - `evaluateAllowlist` and `ruleAllowedByMode` work per agent;
  - Full auto per agent;
  - a node configured as Full auto keeps the sandbox when tightened.
- **Plan:** auto-approval follows `plan-approval.auto`; plan-first stays enforced otherwise.
- **Live state:** `deriveRunWorkflow` keyed by node id.
- **Unchanged:** restart, stop, budget and handover behaviour.

### 4. Server, db and adapter

- **Storage:**
  - `project_workflow` JSON accepts v1 or v2; the service migrates v1 with the setup, and PUT
    always writes v2;
  - the run snapshot gains `graph?` and `nodeModes?` (v1 still parses);
  - the `agent_runs.stage` parser becomes node ids;
  - `change_reviews.decided_by` gains `'reviewer'` (Zod only).
- **`startTicket`:** validate (409 `workflow_invalid`) → ceilings from `resolveRunOptions`, now read
  as maximums → compile → `createTicketRun({graph, nodeModes})`.
- **Control service:** per-agent `effectiveMode` in `askOwner`, `fullAutoGate` and `checkAllowlist`;
  per-agent `fullAuto` spec; skills and agent files in use per node.
- **API (coordinator):**
  - `GET` and `PUT /api/projects/:id/workflow {graph}` (422 with issues);
  - `POST …/workflow/validate`;
  - `GET /api/workflow-templates`;
  - `CreateProjectRequest.workflowTemplate?`;
  - `RunWorkflowDto {graph, nodes[]}`;
  - `StartTicketRequest.approvalMode` documented as "at most".
- **Adapter:** essentially unchanged, since toolsets come from the kind (ADR-0019 §7). New tests
  cover a mixed-mode run (a manual named helper and a full-auto pool) and check that the lead and
  reviewers never get `auto`.

### 5. Web

- **Editor (`features/workflow/editor/`):**
  - `GraphEditor`: React Flow with draggable nodes, typed handles (only valid connections), delete,
    and an edge-type menu;
  - `Palette`;
  - `NodePanel`: label, model, skills, agent file, mode with its warning, max instances, can start
    helpers, reviewer scope;
  - `EdgePanel`: rounds, findings on;
  - `IssuesList`: live, click to focus;
  - `TemplatePicker`: reset to a template, restore my earlier setup;
  - Save is disabled while there are errors, and unsaved changes are guarded.
- **Elsewhere:**
  - the project wizard gets a template step;
  - the live ticket view renders the **run's snapshot graph** read-only, with node states;
  - the Start dialog and run options say "Approval mode: at most …".

## Work packages

The protocol is the same as before: STATUS and progress files under `docs/workflow-graph/`; the
coordinator reviews and merges `--ff-only`; `pnpm check` and e2e before each merge.

| WP   | What                                                                                                    | Owned paths                                                                                                       | After           |
| ---- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------- |
| WG-0 | Coordinator: ADR-0023, graph schemas and types, API DTOs, additive contract fields, `tightenMode`, docs | `packages/core/src/workspace/workflow-graph.ts`, `core/src/api/**`, `docs/decisions/**`, `docs/workflow-graph/**` | —               |
| WG-A | Core logic: validate, compile, migrate-v1 (golden tests), templates, capabilities                       | `core/src/workspace/graph/**` + tests                                                                             | WG-0            |
| WG-B | Engine: program-driven stages, routes a/b/c, per-agent mode, named helpers, node live state             | `packages/orchestrator/**`                                                                                        | WG-A            |
| WG-C | Server, db and adapter                                                                                  | `packages/server/**`, `packages/db/src/repositories/**`, `adapters/claude-code/src/managed/**`                    | WG-B (stubs OK) |
| WG-D | Web editor and wizard template step                                                                     | `web/src/features/workflow/**`, `features/project-setup/**`                                                       | WG-A (fixtures) |
| WG-E | Web live view, run options, copy                                                                        | `web/src/features/ticket/LiveWorkflow.tsx`, `features/review-loop/**`, `lib/copy.ts`                              | WG-C DTOs       |
| WG-V | Verification: e2e per scenario; consented real runs for a, b, c and one mixed-mode run                  | `e2e/**`, real-run driver                                                                                         | all             |

**Order:** WG-0 → WG-A (WG-D starts on fixtures) → WG-B → WG-C in parallel with WG-E → WG-V. The
release: the feature merges into `dev`, and the owner raises the MR from `dev` to `main`, merges it
and tags the release.

## Critical files

- **Change:**
  - `packages/core/src/workspace/workflow.ts` (v1, kept, and migrated);
  - `packages/orchestrator/src/{stages,loop,review-tool,plan,draft,commands,policy,run-workflow,lead-tools,allowlist}.ts`;
  - `packages/server/src/control/service.ts`, `board/service.ts`;
  - `packages/db/src/repositories/redesign/{workflow,run-audit}.ts`;
  - `packages/web/src/features/workflow/**`, `features/ticket/LiveWorkflow.tsx`.
- **Reuse:**
  - `resolveRunOptions` (as ceilings);
  - `reviewStageOf`;
  - `resolveAgentModel`;
  - `isNonHelperRole`;
  - `assignReviewers`, `startChangeReviewer` and `applyDecision` in `loop.ts`;
  - `fullAutoOf` and `applyFullAuto`;
  - `buildWorkflowGraph`'s layout as auto-layout.

## Graph correctness: how we prove it

Who builds what:

- **WG-A:** the generator, the mutants, and the validator/compile/`canConnect` agreement (layers 3
  and 5's golden migrations).
- **WG-B:** the simulator, the exploration, and the exhaustive soundness/completeness checks
  (layers 1, 2 and 4), all in `packages/orchestrator/tests/graph-correctness/`.
- **WG-C:** the API fuzz.

The goal has two parts: every graph the validator accepts runs to the owner's final merge with
every safety rule intact; every graph that could break a rule or get stuck is rejected.

1. **A run simulator (the oracle).** A pure, deterministic `simulateWorkflow(program, script)`
   drives the **real engine commands** (`createRun`, `submitPlan`, `changeSealed`, `submitReview`,
   `merge_change`, `request_review`, …) with scripted fake agents. It runs as fast as the existing
   orchestrator tests and needs no I/O.
   - **Scripts** choose each agent's behaviour: reviewer verdicts (approve, rework), helpers that
     change files or not, a failed check, a helper that fails, the lead that asks the owner, the
     owner's answers.
   - **Invariants checked on every step of every trace:**
     - nothing edits or runs before an approved plan, unless the plan gate is auto;
     - only helper and tester nodes edit, only in their own worktree;
     - only the lead merges, only through the checks;
     - `main` changes only on the owner's merge;
     - rework rounds never exceed the edge limit;
     - every reviewable change reaches a final state;
     - final stages run in chain order, at most once;
     - each agent's permission mode is at most its node's mode; the lead and reviewers are
       always `default`;
     - **the run always terminates**: no idle-lead deadlock (the bug real run 1 found), no
       infinite loop.
2. **Exploring all behaviours of each graph.** For a given valid graph, enumerate every script up
   to the round limits: every approve/rework sequence for each reviewer, plus failure and owner
   branches. This is a small bounded model check of that graph's state space, run on every template
   and on every graph in layer 3.
3. **Generated graphs** (property tests with a seeded in-house generator; no new dependency).
   - **Random valid graphs** are built only from legal moves: add a named helper, route its review
     to the lead or a reviewer, add a rework edge, add final stages, toggle the planner. Expected:
     the validator accepts, `compileWorkflow` succeeds, and layer 2 finds no invariant violation or
     deadlock. Thousands of seeds run in CI, and a failure prints its seed and the shrunken graph.
   - **Mutants:** take each valid graph and apply one mutation at a time: delete an edge, add a
     forbidden edge type (helper → checks, tester → reviewer findings, reviewer → merge), add a
     second lead, add a non-rework cycle, give a read-only node a mode, give a named helper a
     duplicate label, cut the owner-merge, leave a helper with no review route, and so on. Expected:
     the validator rejects with a **specific issue code**, and `compileWorkflow` refuses.
   - **Agreement checks:**
     - `canConnect` (the editor) and `validateWorkflowGraph` never disagree;
     - `compileWorkflow` never accepts anything the validator rejects;
     - the server's PUT and `createRun` reject the same graphs (API fuzz: mutated graphs → 422).
4. **Exhaustive small graphs.** Enumerate **every** graph up to a small size from the building
   blocks: up to 2 named helpers, 1 pool, 1 change reviewer, the planner on or off, and up to 2
   final stages, with all legal and illegal edge choices. That's a few thousand graphs.
   - **Soundness:** if the validator accepts, the simulator finds no violation or deadlock for any
     script.
   - **Completeness:** if the simulator can reach a violation or deadlock, the validator must have
     rejected it. Any graph the simulator flags but the validator accepted is a **validator gap**,
     and the test names it.
   - **Coverage:** the test fails if a validator rule is never the reason for some rejection, which
     flags dead rules.
5. **Oracles from today's code.**
   - **Golden v1 tests:** every v1 workflow migrates to a graph that produces the **same event
     trace** as the current engine in the same script.
   - **Templates:** each template's expected trace is pinned as a snapshot.
6. **Real runs (consented each time):** scenarios (a), (b) and (c), plus mixed modes, check the
   same invariants from `system/init` and the database with real Claude.

## Verification

- **Golden tests:** every v1 workflow migrates and compiles to identical launch fields and stage
  order, so today's behaviour is preserved. The existing 2,623 tests and 62 e2e stay green.
- **Unit tests:** every validation rule; each template valid; the three review routes; per-agent
  mode tightening and the sandbox kept; named-helper resolution and refusals; plan auto via the
  gate.
- **e2e:** draw a graph in the editor (palette, connect, an invalid drag refused, issues shown),
  save, start a ticket, and see the live graph follow the run, for each template.
- **Real runs (consented each time):** scenarios (a), (b) and (c), plus mixed modes. They check
  each agent's `permissionMode` and sandbox from `system/init`, the owner prompts per mode, and the
  final merge.

## WG-0 refinements (binding; they override the plan text above)

The contract is in `packages/core/src/workspace/workflow-graph.ts` (plus `node-id.ts`), and the
DTOs in `packages/core/src/api/redesign.ts` ("workflow graph" section).

1. **`assigns` edges come only from the lead.** The planner plans for the helper nodes the lead
   assigns; its brief lists them. `canConnect('assigns')` is lead → `helper` | `helper-pool`.
2. **`findings` has no `on` field.** Route (c) is "the change reviewer also has a `rework` edge
   to that helper". A reviewer without a findings edge to the lead is an error
   (`reviewer-no-findings`).
3. **The lead's rework rounds come from a lead → helper `rework` edge**, with 0 rounds when there
   is none (the lead can still merge, discard or ask the owner). `ReviewRoute` carries
   `leadRounds`, and on route (c) also `reviewerRounds`.
4. **Skills:** an agent node has `skills` (at most 3), and version 1's single `skill` migrates to
   `[skill]`.
5. **Approval modes:**
   - an editing node's `approvalMode: null` means the project's mode;
   - `tightenMode(node, project, ...ceilings)` returns `{mode, sandbox}`;
   - `sandbox` is true when the configured mode (the node's own, or else the project's) is Full
     auto.
6. **Plan auto-approval:** `planAutoApprove = planGate.auto && every ceiling is full-auto`.
   Validator warnings:
   - `full-auto-plan-manual`: an editing node runs Full auto while the gate asks;
   - `plan-auto-without-full-auto`: the gate is auto but no editing node is Full auto.
7. **Overrides** (`CompileContext`):
   - `reviewer: 'lead'` reroutes every change to the lead; `'agent'` has no effect;
   - `maxReworkRounds` replaces every rework edge's rounds for the run.
8. **No `/api/workflow-templates` endpoint.** Templates and the validator are pure functions in
   core, which the web imports directly (web depends on core). `CreateProjectRequest` is
   unchanged: the wizard PUTs the chosen template's graph.
9. **New endpoints beside the version 1 ones during the transition:**
   - `GET`/`PUT /api/projects/:id/workflow-graph`, plus `POST …/workflow-graph/validate` (422
     `workflow_invalid` with `issues`);
   - `GET /api/runs/:id/workflow-graph` (`RunWorkflowGraphDto`).

   WG-C serves them, WG-D and WG-E switch the web, and WG-V removes the version 1 endpoints and
   DTOs.

10. **The run snapshot:** `RunState.workflow` stays for version 1 runs. WG-B adds `graph?`. A run
    with a graph compiles its program from the snapshot; a version 1 run migrates its snapshot
    with `migrateWorkflowV1` and compiles that.
11. **Ids:** node and edge ids match `^[a-z][a-z0-9-]{0,39}$`, which fits `agent_runs.stage`
    (1–40 characters).
12. **Issue codes** are the fixed enum `GraphIssueCodeSchema`. A new code is a contract change
    (ask the coordinator).
13. **Pre-approved contract changes made in WG-B, not WG-0**, because each one only means
    something once the engine uses it (the adapter pins the lead's tool inputs):
    - `LeadToolInputs.start_agent.helper?` and `submit_plan.steps[].helper?`
      (`WorkflowNodeIdSchema`, from `workspace/node-id.ts`);
    - `ChangeDeciderSchema` gains `reviewer` (widening it changes `emitRound` and change comments)
      together with route (c). It is Zod only: `change_reviews.decided_by` has no SQL enum
      (migration 0006).
14. **Changed behaviour (CHANGELOG):** a ticket can no longer choose a mode looser than its node.
