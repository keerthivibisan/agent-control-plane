# ADR-0040: The run map: a lead's playbook, stage columns and link colours

- **Status:** accepted (project owner, in chat, 2026-11-15)
- **Date:** 2026-11-15
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0038 §5 (the workflow in words), ADR-0037 (Agent blocks), `packages/web/DESIGN.md`
  "Agent views" (link colours)
- **Relates to:** ADR-0039 (blocks by ticket type), [docs/run-map/](../run-map/README.md)

## Context

On the Workflow canvas the owner could not see where an arrow starts and where it comes back:

- links between the lead and its helpers shared one corridor;
- labels floated between lines;
- every link was grey with a small arrowhead.

Which agent the lead uses, and when, was only a helper's description in a flat list of sentences
(Flow in words), not the order a run follows (owner, 2026-11-15).

## Decision

1. **The lead's playbook.**
   - `workflowPlaybook` (core, pure) gives the workflow as numbered stages in run order: Ticket and
     research, Plan, Build, Review each change, Merge, Final checks, Finish.
   - Each step says who does what and when, and points at its blocks and links. Each failure sits
     under the stage where it happens. Ticket-type limits are noted.
   - The lead's "Your workflow" section and `view_workflow` are this text (`renderPlaybook`, then the
     agents). The editor shows the same text beside the canvas, where selecting a step lights its
     links. Flow in words is replaced.
2. **"When to use" on every Agent block.**
   - An Agent block's `description` is its "When to use", for every role. The lead and planner read
     a helper's when they pick a helper for a plan step ("use for: …").
   - A block that starts on its own shows what starts it (`whenToUse`).
   - Every Agent block shows the line on the canvas.
3. **Stage columns.**
   - Tidy layout places blocks in columns by stage, left to right: Ticket and research, planners,
     the lead with plan approval, helpers, change checks and reviewers, merge checks, final checks
     with Author, Finish. A saved position still wins.
   - The router plans on the canvas turned on its side, so columns route as rows did:
     - forward links run right through lanes between columns, links back run left;
     - the links meeting one side of a block are spread out as bundles;
     - a link that skips columns goes round below them when every lane would cross a block.
   - The canvas numbers the stages over the columns while no block has been moved by hand.
4. **Link colours by family.**
   - Families: work neutral; review and findings teal; rework orange and When red; research and test
     purple.
   - Dashes still tell the kinds within a family apart, so colour is never the only signal, and the
     accent stays for the selected link.
   - A link under the pointer, or a link of the block under it, is drawn thicker with a moving dash
     showing its direction.
   - The live run graph uses the same look.

## Alternatives considered

- **Keep grey links and add only direction cues.** Declined by the owner.
- **A playbook panel without stage columns, or columns without a playbook.** Declined: the owner
  wanted the canvas and the text to read the same way.
- **A general layout library (ELK, dagre).** Not taken: a new dependency, and the stage order is
  known, so a column layout with the existing lane router is simpler and deterministic.

## Consequences

- Workflows drawn by hand keep their positions. Tidy layout moves them to the columns.
- The engine is unchanged. Only the lead's brief text changes (golden traces updated).
- The editor routes every template without a crossing.
