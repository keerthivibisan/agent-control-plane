# ADR-0029: The owner may send a change back for rework after a restart

- **Status:** proposed (owner, 2026-10-26: "yes plan it for 0.3.2"; the design below is the
  coordinator's draft, to be accepted before work starts)
- **Date:** 2026-10-26
- **Deciders:** project owner (decision); coordinator (draft)
- **Amends:** ADR-0021 §5 (a restart ends live agents as `NEEDS_REVIEW`), ADR-0020 (owner actions
  that resume a saved session)
- **Plan:** [docs/v0.3.2/README.md](../v0.3.2/README.md)

## Context

When the server stops while a run is working (a restart, a crash, the laptop going to sleep with
the app quit), the restart recovery ends every live agent as `NEEDS_REVIEW` and the run waits for
the owner (ADR-0021 §5). A helper whose change was sealed and waiting for review keeps its worktree,
its commits and its saved session, but the owner can only merge or discard that change: "send back
for rework" is refused, because `NEEDS_REVIEW` has no transition back to work and the run has no
lead to carry the plan on. The owner then cancels the ticket and runs it again, which repeats work
that is already done (P-D finding, [docs/v0.3.1/wp/P-D.md](../v0.3.1/wp/P-D.md)).

## Decision (draft)

1. **Rework after a restart, on the owner's click only.** For a helper that was `AWAITING_REVIEW`
   (its change sealed) when the server stopped, the owner may choose **Rework** with comments. The
   helper resumes its saved session in its own worktree, as any rework does; if the session cannot
   be continued, it starts a new one there (P-D's fallback). Never automatic: nothing restarts by
   itself after a restart.
2. **Engine:** `NEEDS_REVIEW → STARTING` becomes a transition for such a helper only, and
   `checkChange` accepts the owner's rework on it. Every other agent stays `NEEDS_REVIEW`.
3. **The run goes on with its lead resumed.** The owner's rework resumes the lead's saved session as
   a follow-up turn (ADR-0020), told what happened, so the change comes back to review and the plan
   continues as before. If the lead's session cannot be continued, the run stays waiting for the
   owner with a plain message, and merge and discard still work.
4. **Invariants kept:** the branch guard and every safety rule apply to the resumed agents as at
   start; limits and budgets count the earlier work; the ticket branch moves only by the lead's
   merge or the owner's.

## Consequences

- No migration: states and transitions live in the orchestrator; the API gains the rework action on
  such a change (an `@acp/core/api` contract change, reviewed by the coordinator).
- A restart no longer costs the owner a whole ticket when changes were already done.

## Alternatives considered

- **Restart every agent automatically after a restart:** runs agents and spends tokens without the
  owner. Rejected (ADR-0021 §5).
- **Owner reworks the change without the lead:** the change would come back to a run nobody
  reviews. Rejected in favour of resuming the lead.
