# ADR-0023: Editable workflow graphs

- **Status:** accepted: owner decisions in chat 2026-10-17 (`docs/workflow-graph/STATUS.md` at tag `v0.3.0`);
  accepted by the coordinator on those decisions
- **Date:** 2026-10-17
- **Deciders:** project owner (decisions); coordinator (draft and review)
- **Amends:**
  - ADR-0019 §1 (the fixed stage sequence becomes a graph of building blocks);
  - ADR-0021 §1 (the approval mode is set per editing node; ticket and run modes only tighten);
  - ADR-0021 §3 (three review routes);
  - ADR-0022 (Full auto per node, plan auto-approval on the plan gate).
- **Plan:** [docs/history/workflow-graph/README.md](../history/workflow-graph/README.md)

## Context

In 0.1.0 a project's workflow is a fixed sequence (plan → orchestrate → helpers → review →
code-review → unit-tests) with a few switches. The owner wants each project to draw its own agents
and flow, with an approval mode for each agent, and to express every review scenario:

- (a) the lead reviews and merges;
- (b) a review agent sends its findings to the lead, who decides;
- (c) the reviewer sends comments straight to the helper for rework, in a loop, and the lead then
  merges.

ADR-0019 rejected a free-form editor because it could build workflows that skip a safety rule.
The owner decided (2026-10-17):

- building blocks with rules, not free-form;
- templates to start from, or build your own;
- each agent node sets its mode, and ticket and run settings only tighten it;
- a Full auto node keeps the sandbox when tightened;
- the plan gate's own switch decides plan auto-approval;
- a helper pool plus named helpers.

## Decision

### 1. A workflow is a graph of typed building blocks

`WorkflowGraph` (version 2, `@acp/core`) holds:

- agent nodes: `planner`, `lead`, `helper-pool`, `helper` (named), `reviewer` (scope `change` or
  `final`) and `tester`;
- gates: `ticket`, `plan-approval`, `checks`, `ticket-merge`, `owner-merge` and `done`;
- typed edges: `flow`, `assigns`, `review`, `findings`, `rework` (with `maxRounds` 0–5) and
  `merge`.

Agent nodes set a model, up to three skills and an agent file. Editing nodes also set an approval
mode. There is no free-text prompt override; extra instructions go in the node's agent file.

### 2. Capabilities are fixed by node type

`NODE_CAPABILITIES` maps each type to a role kind. The engine, server and adapter derive tools,
worktrees and approval handling from the kind (ADR-0019 §7), never from the wiring. No graph can
change any of these rules:

- read-only kinds;
- only helpers and the tester edit, each in its own worktree;
- plan-first;
- only the lead merges into the ticket branch, through the required checks and compare-and-swap;
- `main` changes only on the owner's merge;
- limits and hard caps;
- no subagents, web or messaging tools.

A read-only node has no approval-mode field at all.

### 3. Validation decides which graphs may run

`validateWorkflowGraph` is pure and lives in core. The editor, the PUT and the run start share it,
and it returns issues with stable codes. A graph with an error cannot be saved or started. Its
rules:

- **Counts:** exactly one of each gate and of the lead; at most one planner and one pool; at least
  one helper node.
- **Edge matrix (`canConnect`):** which edge types may connect which node types.
- **Plan path:** the ticket leads to whoever writes the plan, then to the plan gate.
- **Review routes:** exactly one review route per editing node.
- **Merge path:** only the lead merges, through the checks.
- **Final chain:** a linear chain from the ticket merge, through final reviewers and testers, to
  the owner's merge.
- **Structure:** acyclic except for rework edges; every node reachable.

### 4. A valid graph compiles to a program

`compileWorkflow(graph, context)` is pure and lives in core. It returns the `WorkflowProgram` the
engine runs: the lead, the planner, plan auto-approval, the helper nodes with their review routes
and modes, the change reviewers, the final stages in order, and every editing node's mode.

The program is built in memory from the run's snapshot of the graph and never stored. Review
routes:

- **(a)** `{by: lead}`: the helper's review edge goes to the lead.
- **(b)** `{by: agent, then: lead}`: the review edge goes to a change reviewer, which has a
  findings edge to the lead.
- **(c)** `{by: agent, then: direct}`: as (b), and the reviewer also has a rework edge to that
  helper.
  - The reviewer sends the change back itself (`decidedBy: reviewer`) up to that edge's rounds,
    and the lead is told each round.
  - An approved change, or one out of rounds, goes to the lead, who merges or decides.

The lead may send a change back only through a lead rework edge, up to its rounds.

### 5. Approval modes per node; tickets and runs tighten

An editing node's mode is its own, or the project's mode when it has none. The ticket's and the
run's modes are ceilings: the node runs with the strictest of them (`tightenMode`). A node
configured as Full auto keeps the operating-system sandbox when tightened, because tightening
never removes a protection.

The lead, planner and reviewers stay read-only and `default`, as in ADR-0021 and ADR-0022.

**Changed behaviour:** in 0.1.0 a ticket could choose a looser mode than the project's, for
example Full auto in an Auto edits project. With graphs it cannot. The owner sets the loosest mode
on the node, and tickets and runs only tighten it.

### 6. Plan auto-approval is the plan gate's switch

The plan is approved without asking only when the plan gate's `auto` is on and no ticket or run
mode is stricter than Full auto. Otherwise plan-first is unchanged.

### 7. Named helpers

A plan step and `start_agent` may name a helper node (additive `helper?`). Without one, the step
goes to a named helper whose label equals the step's role, else to the pool. When neither exists,
the engine refuses and lists the helper nodes. Each named helper has its own `maxInstances`, and
the project's helper limit still applies on top.

### 8. Ticket and run overrides

- **Reviewer `lead`:** sends every change to the lead (route a).
- **Reviewer `agent`:** changes nothing, because routes come from the graph.
- **Rework rounds:** replaces every rework edge's rounds for that run. These rounds stay bounded
  at 5, and the owner can grant more, as before.

### 9. Storage and compatibility

- **No SQL migration.** `project_workflow.workflow` holds either `{version: 2, graph}` or the
  version 1 JSON.
- **Reading version 1:** the server migrates it on read with `migrateWorkflowV1`, which is
  lossless and pinned by golden tests.
- **Node ids:** the migrated graph uses the old stage ids, so `agent_runs.stage` (1–40
  characters, migration 0004) and old run snapshots keep parsing.
- **Writes:** PUT always writes version 2.
- **Runs:** a run snapshots the graph when it starts.
- **Deciders:** `change_reviews.decided_by` gains `reviewer`, enforced in Zod only, like the other
  enum-like columns.

## Consequences

- Owners can express scenarios a, b and c, named helpers and per-agent modes, without any graph
  being able to weaken a safety rule.
- The engine's stage logic becomes program-driven, which touches `stages`, `loop`, `plan`,
  `draft`, `commands`, `policy` and `run-workflow`.
- Correctness needs more than unit tests. The plan's "Graph correctness" section adds:
  - a run simulator with invariants checked on every step;
  - bounded exploration of each graph;
  - generated and mutated graphs;
  - exhaustive small graphs, checked for soundness, completeness and dead rules;
  - golden version 1 traces;
  - consented real runs.
- **Transition:** `/api/projects/:id/workflow-graph` and `/api/runs/:id/workflow-graph` arrive
  beside the version 1 endpoints. The version 1 endpoints are removed once the web uses the new
  ones (WG-V).

## Alternatives considered

- **Free-form nodes with chosen tools or prompts.** Rejected (ADR-0019): a graph could create an
  agent that edits without review or merges into `main`.
- **Keep the fixed sequence with more switches.** Rejected: it cannot express named helpers or
  route (c), and every new scenario would need another switch.
- **Ticket modes that may loosen.** Rejected by the owner: tighten only.
