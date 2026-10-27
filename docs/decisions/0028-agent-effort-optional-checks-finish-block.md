# ADR-0028: Effort per agent, optional Checks blocks, and one Finish block

- **Status:** accepted (owner, 2026-10-26: "include the effort type in the workflow page: High,
  Medium, Low"; "check and release checks that cannot be removed and not much understandable ...
  its optional without that even we can complete the flow"; "the merge to main is optional, we can
  just raise PR ... Its bit confusing there"; answers: checks gate only where the workflow places
  them; Default, Low, Medium, High; one Finish block)
- **Date:** 2026-10-26
- **Amends:** ADR-0023 (graph nodes and their capabilities), ADR-0027 §5–§6 (the mandatory merge
  block), ADR-0021 §4 (what gates the owner's final merge)
- **Plan:** [docs/v0.3.1/README.md](../v0.3.1/README.md)

## Context

0.3.0 gave every workflow a Checks block before the lead's merge that cannot be removed, and ends
every flow with three fixed blocks: "Ticket branch", "You: Merge into main" and "Done". The owner
found both hard to understand: the checks are mandatory even for a project without a harness, and
the last label says "main" even when the ticket targets `dev` and the owner opens a pull request.
The Agent SDK (0.3.296) also accepts a reasoning `effort` per session, which the app does not use.

## Decision

1. **Effort per agent block.** Every agent block (planner, lead, helpers, reviewers, tester) may
   set `effort`: `low`, `medium` or `high`; absent means the model's default. The engine carries
   it in the launch fields; the adapter passes it to the SDK's `effort` option; follow-up and
   rework turns keep the block's effort. Models without effort support ignore it.
2. **Checks blocks are optional.** No Checks block is required, including the one before the
   lead's merge. Checks run and gate only where the workflow places them:
   - without a block before the lead's merge, the lead merges a change after its review, with no
     checks;
   - without a block on the ticket branch, the owner's final merge is not gated by checks (no
     "Merge anyway" needed);
   - the editor warns (not an error) when a workflow has no Checks block at all.
     Old graphs keep their merge block and behave exactly as before.
3. **One Finish block.** The editor and the live run graph show the end of the flow as one fixed
   block, "Finish: merge into <target> or open a pull request, then Done", with the ticket's or
   project's real target. The stored graph keeps its `ticket-merge`, `owner-merge` and `done`
   nodes (no migration); only the presentation changes. The owner's final step is unchanged: a
   local merge or Push & open PR, by click only.

## Consequences

- A workflow without checks relies on reviews alone; the warning says so.
- Every safety rule from F-1 and F-2 is unchanged (helpers never manage branches, only the lead
  merges changes, nothing merges without the owner's click at the end).
- No migration.

## Amendment 2026-10-26: what gates the owner's final merge (P-A)

A workflow with a Checks block before
the lead's merge (every graph saved before 0.3.1 and every version 1 run) keeps 0.3.0's rule:
the required checks gate the owner's merge on the ticket branch tip (with "Merge anyway"), and
a branch block's other picks run and are shown, not enforced. A workflow without a block before
the merge is gated on the tip only by a block on the ticket branch, by that block's own
selection; without one, nothing runs on the tip and the owner merges without "Merge anyway".
The lead's `merge` link goes to the ticket merge when there is no block before the merge, and is
refused there when there is one, so the lead can never merge past a block.

## Amendment 2026-10-27: conflict resolution and delegated delivery (ADR-0030, proposed)

§2: the owner's merge on a tip promoted by a conflict resolution whose checks were skipped by
policy is gated by that decision's always-run checks only (see ADR-0030 §7).
