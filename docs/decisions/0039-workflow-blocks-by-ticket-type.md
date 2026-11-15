# ADR-0039: Workflow blocks by ticket type

- **Status:** accepted (project owner, in chat, 2026-11-15)
- **Date:** 2026-11-15
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0037 (Agent blocks and typed arrows)
- **Relates to:** ADR-0038 (failure routing), [docs/ticket-types/](../ticket-types/README.md)

## Context

The owner wants behaviour-driven development as a workflow: analyse the behaviour, write the
scenario tests and the code in parallel, and validate the combined work. Bug and fix tickets have
no new behaviour, so they should skip the analysis and the test writing. Tickets already have a
type (`feature`, `bug`, `chore`, `harness`), but a workflow ran the same blocks for every ticket;
the type reached agents only as prompt text (owner, 2026-11-15).

## Decision

1. **"Runs for" on an Agent block.** An Agent block may list the ticket types it runs for
   (`ticketTypes`, 1 to 4 distinct types; absent means every type). The lead, the steps and the
   Checks blocks always run. One workflow serves every ticket type.
2. **A run follows the graph its ticket's type runs.** At the ticket start the server builds that
   graph (`specialiseForTicket`, core, pure) before validating and compiling it, and snapshots it
   on the run, so the engine, the lead's brief, the plan's helper choice, the final stages and the
   live graph see only the blocks that run. The engine is unchanged. The rules:
   - a skipped block goes with its arrows; a skipped step of the final chain is stepped over (a
     tester after it stays a tester);
   - an agent that loses its role with it (a researcher of a skipped block, a change reviewer with
     nothing left to review) and a Checks block on the change with no input left go too;
   - with every planner gone, the plan path runs through the lead;
   - a When arrow from or to a skipped block goes, so that failure goes to the lead.
3. **Every type must still work.** A graph with no other error is refused when a ticket type it
   skips blocks for would get a workflow that cannot run (`ticket-type-breaks-workflow`, on the
   first block that type skips).
4. **The BDD template** (`bdd`, version 3 only). A Behaviour analyst (researcher, feature only)
   writes the scenarios before the plan; the lead starts Scenario tests (feature only) and
   Developer at the same time; both merge; a Tester runs the whole suite on the ticket branch, for
   every ticket type (owner decision); failing tests go to Author (2 rounds, the tester testing
   again). The analyst feeds only the plan, so it runs once; the lead hands the scenarios on.
5. **Words.** "Flow in words" and the lead's "Your workflow" say "It runs only for feature
   tickets." on such a block; a run's own workflow leaves skipped blocks out.

## Alternatives considered

- **One workflow per ticket type.** More flexible, but each workflow must be kept in step with the
  others. Declined by the owner.
- **The lead decides.** No contract change, but a researcher always runs before its target, so the
  analysis could not be skipped. Declined.

## Consequences

- `AgentNodeSchema.ticketTypes`, the `bdd` template id (`WorkflowTemplateIdV2` keeps version 2's
  three), the `ticket-type-breaks-workflow` issue code. A graph with ticket types cannot be
  downgraded to version 2; a `bdd` graph without them goes back as custom.
- The live run graph shows only the blocks the ticket's type runs; the saved workflow keeps them all.
