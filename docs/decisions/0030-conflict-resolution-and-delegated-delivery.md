# ADR-0030: Policy-driven conflict resolution, adaptive verification and delegated delivery

- **Status:** proposed (implemented on `feature/conflict-resolution` for the owner's review; the
  owner accepts it by merging the pull request)
- **Date:** 2026-10-27
- **Deciders:** project owner (request 2026-10-27, "implement policy-driven conflict resolution and
  autonomous delivery"; design in [docs/conflict-resolution/PROPOSAL.md](../conflict-resolution/PROPOSAL.md));
  implementing agent (draft)
- **Amends:** ADR-0021 §3–§4 (who updates a ticket branch, what gates the owner's final merge),
  ADR-0025 §2 (only the owner pushes or opens a pull request), ADR-0027 §6 (nothing merges
  automatically), ADR-0028 §2 (the tip's gate), AGENTS.md §3 rule 8 (network exceptions)
- **Plan:** [docs/conflict-resolution/README.md](../conflict-resolution/README.md)

## Context

Parallel tickets work in isolated worktrees, but their ticket branches conflict when the target
moves. `updateTicketFromBase` aborts any conflict and the UI hid "Update from target" while a pull
request was open. Helpers cannot repair a conflict (the branch guard denies merge, rebase and
commit to every agent, rightly), and a helper that returned with no change left the lead without
the reason, so replacements repeated it. The owner wants agents to finish such work with little
interruption, choose proportionate verification, and show what was verified or deliberately
skipped.

## Decision

1. **A server-owned operation.** "Update target / Resolve conflicts" is one operation per run
   (migration 0012, `conflict_resolutions`; a partial unique index keeps one active). It pins the
   ticket tip, the target tip, their merge base and a snapshot of the project policy. The server
   merges in a temporary checkout; a clean result is the candidate. A conflict starts a
   **resolver**: a helper of the policy's helper block (else the first) that edits content in a
   worktree the server prepared with the merge left in progress. The server concludes the merge,
   checks that the target is contained and that no conflict marker remains, and pins the result
   (`refs/acp/resolutions/<op>`). Agents never gain git authority; the resolver has no child tools
   and never enters the review loop.
2. **Project policy** (`ProjectAgentSetup.automation`, JSON, no migration), three separate parts:
   - conflict resolution: `manual` (owner's click) or `auto`; attempts 1–3 (default 2);
   - verification: `required` (every required check, nothing skipped) or `agent-adaptive`;
     `skipScopes`; `alwaysRunChecks`; `allowUnverifiedDelivery`; `onMissingChecks`
     (`escalate` | `draft-pr`);
   - delivery: `manual`, `push-pr` or `merge`, and the allowed targets.

   Absent means `DEFAULT_AUTOMATION`: manual, 2 attempts, required checks, escalate, manual
   delivery. Existing projects are never widened implicitly. An operation keeps its snapshot;
   a later policy change makes its evidence stale instead of widening it.

3. **Assessment and the gate.** The entire combined change is classified: `target..candidate`,
   `mergeBase..target` and the conflicted files. Prose-only needs every path to be plain prose
   (`.md`, `.txt`, `.rst`, `.adoc`, `.markdown`; never MDX or files under dot-folders) inside a
   skip scope. The resolver's `report_work.assessment` is advice. `decideVerification` (core,
   pure) decides: it may add checks the agent proposes (adaptive mode), may skip only a prose-only
   change in adaptive mode, never removes a required or always-run check, and reports a missing
   harness as `unavailable` (or `unverified-by-policy` only when explicitly allowed), never as
   passed.
4. **Evidence binding.** Checks run on the exact candidate commit with the harness file of the
   project's own checkout (an agent cannot edit its own gate). Assessment, check results, skips and
   promotion are bound to the candidate, the target tip and the policy fingerprint; any change
   makes them stale. Promotion re-checks the target and moves the ticket branch by
   compare-and-swap from the pinned tip.
5. **Retries and failure routes.** A resolver that ends with no change, blocked, with markers left,
   failed or stopped, and a candidate whose checks fail, each count as an attempt of the operation
   (replacements do not reset it). While attempts remain, a new resolver starts with the earlier
   reports and failed checks in its brief; then the operation waits for the owner (`awaiting-owner`)
   or fails (no usable result). The owner can apply a held candidate (a reason is required when it
   was not verified), cancel, or start again.
6. **Delegated delivery** (amends ADR-0025 §2). After promotion, and only when the policy
   delegates delivery to an allowed target and the route permits it, the server delivers through
   the owner's own code paths and login: pushes and opens or updates the pull request (a draft when
   verification is unavailable under `draft-pr`), or merges locally (fast-forward, `merge` mode,
   no pull request open). The delivery state is persisted before any network call; a restart turns
   an unfinished delivery into `unknown` and nothing retries it. GitHub's branch protection still
   decides any remote merge. Automatic resolution alone never delivers.
7. **The tip's gate** (amends ADR-0021 §4, ADR-0028 §2). When the latest completed operation
   promoted exactly the tip with `skipped-by-policy` under the current policy, the owner's merge is
   gated only by its always-run checks. Every other route keeps the workflow's own gate.
8. **Structured helper outcomes.** `report_work` takes `outcome` (`completed`, `no-change`,
   `blocked`); the lead's no-change line carries the helper's report, and no-change helpers count
   as lost attempts of their plan step (ADR-0021 F-2), with the last reports in the refusal.
9. **Restart** (ADR-0013 §7): an active operation becomes `interrupted`; an interrupted resolver's
   worktree is discarded, never merged as a change; nothing relaunches.
10. **UI.** Resolution, verification, review and delivery are shown separately, each with an
    owner-readable reason; skipped, not verified, unavailable and stale verification are never
    worded or coloured as passed. "Update target / Resolve conflicts" is offered while a pull
    request is open too.

## Alternatives considered

- **Give the resolver git merge tools:** rejected; ADR-0021 F-1 keeps branch-managing git with the
  app, and the server can prepare the merge itself.
- **Route the repair through the lead's ordinary helpers:** a helper's worktree cannot hold an
  in-progress merge, and the lead may have ended; a dedicated operation is bounded and restartable.
- **Classify by extension and line count alone, or trust the agent's confidence:** rejected; the
  gate skips only prose inside owner-approved scopes, and only in adaptive mode.

## Consequences

- AGENTS.md rule 8 gains a second owner-configured network exception (delegated delivery),
  scoped to the project's own origin and allowed targets, with the owner's `git`/`gh` login.
- Migration 0012 must be applied to the live database (back it up first).
- Not in this change (follow-ups): a test-preparation route for missing checks; conditional checks
  in the workflow graph; refreshing the target from `origin` (targets are local refs only);
  automatic merge of a pull request on GitHub (delivery stops at opening/updating it).
