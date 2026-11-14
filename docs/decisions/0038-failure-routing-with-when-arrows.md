# ADR-0038: Failure routing with When arrows

- **Status:** accepted (project owner, in chat, 2026-11-14)
- **Date:** 2026-11-14
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0037 (arrows), ADR-0028 (a Checks block's `onFailure`), ADR-0023 (rework arrows)
- **Relates to:** ADR-0021 (review loop), ADR-0030 (conflict resolution),
  [docs/failure-routing/](../failure-routing/README.md)

## Context

When something fails in a run, routing is mostly fixed. A tester only describes a bug in free
text; a Checks block's `onFailure: helper` sends the failure back to the change's own author, which
for a tester is the tester itself; the lead picks a fixer from its helper list without seeing the
whole workflow or a structured failure. The owner wants every rework scenario to be designable, to
send a failure straight to an agent or to the lead, and the flow to stay easy to read
(owner, 2026-11-14).

## Decision

1. **Structured test results.** A tester ends with `report_test_results` (status, up to 50 failed
   tests with file and message, a summary), stored as a `test-results` ticket comment.
2. **Failure context.** Every failure event (tests failed, checks failed, review rework, harness
   failed, merge conflict) produces a `FailureContext`: what failed, where, the likely authors
   (helpers whose merged changes touched the failing files) and the rounds used and left. The lead
   always receives it, quoted as data; a fixer receives the same.
3. **A tester's failures never go back to the tester.** Without a route they go to the lead;
   `onFailure: helper` on a tester's checks means the author.
4. **When arrows.** A `when` arrow from the block where an event happens (tester, Checks block,
   change reviewer, ticket merge) to a helper block, the lead, or a new **Author** block (a routing
   block meaning "whoever wrote the failing code"), with one or more events and `maxRounds`. Each
   source and event has at most one route; without one the lead decides, as today. A When arrow
   never gives its target a role. The engine starts a fix turn for the target with the context and
   the arrow's purpose, notifies the lead, which may reroute (`reroute_fix`) or stop it, and sends
   the failure to the lead when the rounds run out. Existing `rework` arrows and `onFailure` settings
   are read as When arrows.
5. **The lead knows the workflow.** Its brief has a generated "Your workflow" section (every agent
   and every arrow as a sentence, with the owner's labels and purposes quoted), also available with
   the read-only `view_workflow` tool. The editor shows the same sentences ("Flow in words").

## Alternatives considered

- **Lead decides every failure.** Simple, but not designable and always costs a lead turn.
- **Fixed author routing only.** Declined: the owner wants any target, the lead or the author.

## Consequences

- New arrow type, routing block, tools and comment kind; the engine gains a failure event router.
- Failure text (test messages, check output) reaches agents only as quoted data.
