# The run map (RM series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0040](../decisions/0040-run-map-playbook-and-stage-columns.md) (accepted).

## Context

The owner could not see on the Workflow canvas where an arrow starts and where it comes back, nor
which agent the lead uses when (2026-11-15).

**Owner decisions, 2026-11-15:**

1. Colour links by family.
2. A numbered lead's playbook, with the canvas in matching stage columns.
3. "When to use" on every Agent block.

**Branch:** `feature/workflow/run-map` from `feature/workflow/ticket-types` (PR #24), stacked.

## How to read the Workflow page (for the owner)

1. **Read left to right.** Press **Tidy layout**. The canvas puts each block in its stage's column,
   numbered as the run goes: 1 Ticket and research, 2 Plan, 3 Build, 4 Review each change, 5 Merge,
   6 Final checks, 7 Finish.
2. **Each block says when it is used.** The line under its name is your "When to use" (set it in the
   block's settings), or what starts it, such as "Runs before the plan" or "Tests the ticket branch
   after the merge".
3. **The links' colour says what they are:**
   - grey: work (next step, implement, merge);
   - teal: review;
   - orange: rework;
   - red: a When failure route;
   - purple: research and tests.

   Point at a block or a link to light its links and see which way they run.

4. **The lead's playbook below the canvas is what the lead reads,** step by step. Select a step to
   light its links on the canvas. A failure nobody routes says "Lead decides (default)".

## Work packages

| WP   | Scope                                                                          |
| ---- | ------------------------------------------------------------------------------ |
| RM-0 | ADR-0040, plan and STATUS                                                      |
| RM-1 | Core: `workflowPlaybook`, `renderPlaybook`, `whenToUse`; the lead's brief      |
| RM-2 | Web: link families and colours, arrowheads, hover direction, legend, DESIGN    |
| RM-3 | Web: stage-column layout, turned-canvas routing, spread ends, detours, headers |
| RM-4 | Web: the playbook panel, "When to use" on every block and in its settings      |
| RM-5 | Docs and full check                                                            |
