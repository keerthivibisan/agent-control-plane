# Flexible workflows (AR series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0037](../decisions/0037-agent-blocks-and-typed-arrows.md) (accepted).

## Context

Today a workflow graph (ADR-0023, `packages/core/src/workspace/workflow-graph.ts`) has fixed block types: planner (0–1), lead (1), helper-pool, helper, reviewer (0–8) and tester (0–2). Each block type fixes the agent's role (`NODE_CAPABILITIES` → `kind`), and from the role come its tools, worktree, approvals and read-only rules.

Edges have six types (`flow`, `assigns`, `review`, `findings`, `rework`, `merge`). They carry `{id, from, to}` only, with no label or data. At run time only the review, rework and final-chain edges matter; every hand-off is hard-coded per role (`compile.ts`, `stages.ts`, `briefs.ts`).

You want flexibility:

- two research agents (one Claude, one Codex) feeding planning, and the same for review and test;
- your own arrows that say _what_ flows and _why_.

**Owner decisions, 2026-11-09:**

1. **One Agent block.** Its role comes from its arrows. Permissions still follow the derived role, so a reviewer can never edit. A block can't mix roles; the editor flags that.
2. **Two or more `plan` arrows into Plan approval:** the plans show side by side and you approve one. The lead runs the plan you chose.
3. **Custom arrow = order + hand-off.** The target starts after the source finishes. It receives the source's output note in its prompt, together with the arrow's label and your "why" text.

Branch: `feature/workflow/arrows` from the latest `origin/dev`, in worktree `.claude/worktrees/arrows`.

## Design

**Graph v3** (`version: 3`). Saved v2 graphs and v1 workflows migrate automatically when read, with nothing lost: a planner becomes an agent with a `plan` arrow, a helper or pool becomes an agent with an `implement` arrow, a reviewer becomes an agent with a `review` arrow, and a tester becomes an agent with a `test` arrow. Run snapshots keep their own version: `programOf` already compiles per snapshot, so running and old runs are unaffected.

**Nodes:**

- `agent` (generic) has: label, description, model, provider, effort, skills, agent file, and `maxInstances`. It has `approvalMode` and `canStartHelpers` only when its derived role edits.
- `lead` stays as it is, and the gates stay as they are: ticket, plan-approval, checks, ticket-merge, owner-merge, done.

**Arrows.** Every arrow has an optional `label` (up to 40 characters) and `purpose` (up to 300 characters, your text, shown in the target's brief as data).

| Arrow                            | From → to                      | The source's derived role        | At run time                                                                                                                                              |
| -------------------------------- | ------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `research`                       | agent → agent / lead / planner | researcher (read-only)           | Runs before its target. Its findings note goes into the target's prompt. Researchers can run in parallel, and research arrows can chain (no cycles).     |
| `plan`                           | agent → plan-approval          | planner (read-only)              | Each planner submits a plan. With 2 or more planners, you pick one.                                                                                      |
| `implement` (was `assigns`)      | lead → agent                   | target is an editor              | The lead or the plan steps start it, as today.                                                                                                           |
| `review` / `findings` / `rework` | editor → agent → lead / editor | target is a reviewer (read-only) | As today, plus **fan-out**: several reviewers per change (for example Claude and Codex). Any `rework` verdict means rework; the lead sees every verdict. |
| `test`                           | final chain → agent            | tester (edits)                   | As today.                                                                                                                                                |
| `custom`                         | agent → agent                  | none (no role)                   | Order plus hand-off, with the label and purpose included.                                                                                                |
| `flow` / `merge`                 | gates                          | —                                | Unchanged.                                                                                                                                               |

**Role derivation.** `deriveRoles(graph)` is a pure function in core that returns a role for each node. It feeds every place that uses `kind` today: role tools, both adapters' permission gates, the server's working folder and approvals. Those layers keep using `kind`.

New read-only kind **`researcher`**:

- tools: `report_findings` (one note of at most 16 KiB, saved as a ticket comment with kind `research`), plus `code_map`, `ask_lead` and the read-only file tools;
- it works in the project folder, like the planner, and has no worktree;
- on Codex it gets the `:read-only` profile.

The validator gains three errors: a node that can't get a role, a node with mixed roles, and cycles in research or custom arrows.

**Engine:**

1. **Pre-plan research stage.** Researchers upstream of a planner (or of the lead, when the lead plans) run first, in arrow order and in parallel where possible. Their findings and the arrows' purpose text go into the planner's brief (`briefs.ts`).
2. **Research during the run.** A researcher wired `research → lead` can be started by the lead (`start_agent`), and its findings go to the lead.
3. **Custom arrows.** When the source agent finishes, the engine sends the target a hand-off brief, or uses it when the target starts.
4. **Several planners.** `PLAN_REVIEW` holds N drafts. `approve_plan` takes a `planId`, and the other drafts are kept as "not chosen".
5. **Review fan-out.** A change's review route lists several reviewers, and the decision waits for all of them.

**DB:**

- Migration `0016`: `ticket_plans` allows several drafts per run, adding `option_index` and a `chosen` flag.
- `ticket_comments` gets the comment kind `research` (Zod; checked in SQL if that's where the enum lives).
- The graph JSON stays in `project_workflow`.

**Web editor** (`features/workflow/editor`):

- The palette has one **Agent** block plus quick presets (Researcher, Planner, Helper, Reviewer, Tester). Each preset is an agent with its arrow already drawn.
- Each block shows a badge with its derived role.
- Drawing an arrow opens a menu of the valid types, plus **Custom**.
- `EdgePanel` edits the label and purpose. Labels show on the canvas, and the purpose shows on hover.
- Plan approval shows the plans side by side, each with an "Approve this plan" button.
- The live run graph shows arrow status, and links to the research notes.

**ADR-0037** "One Agent block, roles from typed arrows (workflow graph v3)" amends ADR-0023. Plan and status files go in `docs/arrows/`.

## Work packages (in order; `pnpm check` green and a commit at each)

1. **AR-0:** ADR-0037, the plan and the STATUS file.
2. **AR-1 core:** v3 schema, `deriveRoles`, the new connection matrix, validator, v2→v3 migration, templates, compile to an extended `WorkflowProgram` (researchers, planners[], reviewers per editor, custom hand-offs). Rework the core graph tests and generators.
3. **AR-2 role:** the `researcher` kind in core role tools, both adapters, and the server's working folder and approvals; the `report_findings` tool.
4. **AR-3 engine:** the research stage, research during the run, custom hand-offs, several planners, review fan-out. Update the orchestrator graph-correctness simulator.
5. **AR-4 server and DB:** migration 0016, storing findings, approving a chosen plan, API DTOs (core api, in a separate commit).
6. **AR-5 web:** the Agent block and presets, the arrow menu, label and purpose editing, role badges, the side-by-side plan approval, the live graph.
7. **AR-6:** safety and adversarial tests, docs, and one real run you agree to.

**Size:** this touches about 21k lines of graph tests across core, orchestrator, server, web and e2e. It is the largest series so far. I'd run it with one implementing agent per WP, in order, with me reviewing after each.

## Verification

- **Migration:** every saved v2 and v1 template and fixture graph migrates to v3 and compiles to a program with the same behaviour as before. The golden v1 and upgrade-from-0.1.0 drivers stay green.
- **Unit and property tests:**
  - role derivation: each arrow type gives the right role; mixed roles give an error;
  - validator and connection matrix;
  - research ordering and parallelism; custom hand-offs; picking among N plans; review fan-out with mixed verdicts.
- **Adversarial:**
  - a researcher or reviewer can't edit, even with arrows drawn to try;
  - purpose text with "ignore your rules" is passed as data and has no effect;
  - a custom arrow can't give an agent edit rights;
  - cycles are refused.
- **Web:** drawing each arrow type, editing labels, role badges, the plan picker, and e2e workflow specs.
- `pnpm check` at every checkpoint.
- **One consented real run** on a throwaway project: two researchers (Claude `haiku` and Codex `gpt-6.1-sol`, both on low effort), feeding one planner, one helper, and two reviewers (Claude and Codex).
- No push until you ask. The PR goes to `dev` with the `keerthivibisan` account.
