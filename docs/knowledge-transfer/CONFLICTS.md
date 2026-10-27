# 03 · Conflict recovery and verification

Status: implementation present on the inspected `dev` baseline. ADR-0030 still says proposed and
its CR status table still says review; neither label is silently upgraded by this document.

## Why conflicts happen

Worktrees separate uncommitted edits. They do not keep every ticket current with a target that
other tickets are changing, and a syntactically clean merge can still break behavior. Increasing
helper concurrency or selecting GitHub's rebase merge method does not repair conflicting content.

## Implemented recovery path

1. Owner-triggered Update target / Resolve conflicts, or an eligible automatic trigger, starts one
   operation per run. It pins ticket tip, target, merge base and project policy.
2. The server tries the merge in isolation. A clean result needs no resolver model call. A conflict
   starts a content-only resolver in a worktree with the merge left in progress.
3. The server concludes the merge, checks conflict markers/target containment and pins a candidate.
4. The full combined paths and resolver assessment go to the pure verification policy gate. Agent
   assessment is advice; confidence or a small line count is not permission to skip testing.
5. Trusted configured checks run on the candidate, or the operation records the allowed skipped,
   unavailable or unverified route. Failed/blocked/no-change attempts consume a bounded operation
   budget (1–3, default 2); replacements do not reset it.
6. Promotion rechecks freshness and compare-and-swaps from the pinned ticket tip. Delivery is a
   separate configured decision; failure/unknown remote outcomes must not be blindly retried.

## Verification and delivery are independent

| Situation                                     | Current policy route                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| Required verification                         | Run required/always-run checks under the configured rules                       |
| Adaptive prose in approved scopes             | May skip normal checks; always-run checks remain applicable                     |
| Runtime/configuration/MDX or uncertain change | Cannot turn into a prose skip merely on agent confidence                        |
| Missing harness, no unverified delegation     | Unavailable; configured escalation or draft-PR route                            |
| Explicit allow-unverified policy              | May use the unverified route; never word it as passed                           |
| Candidate, target or policy changed           | Stale evidence; block promotion until reassessed                                |
| Delivery manual or target not allowed         | Keep owner delivery                                                             |
| Delegated push/PR                             | Push and open/update the PR; draft if the selected route requires it            |
| Delegated merge                               | Local fast-forward when applicable; an existing PR follows the PR delivery path |

Adaptive prose rules are a deterministic path classification, not a universal proof that Markdown
is harmless. Executable documentation pipelines can need checks; use always-run checks and
conservative scopes. “No checks configured,” “skipped by policy” and “passed” are different claims.

## Current limits

- Target comparison uses local refs; no automatic origin fetch before resolution.
- Automatic starts occur on supported view/read/refetch paths or a local merge event; there is no
  always-on background scheduler promising unattended discovery of every conflict.
- The graph does not yet contain conditional verification decision nodes. Adaptive routing is
  project automation policy, not an arbitrary new graph branch.
- Missing-check routes are escalation or draft PR; no automatic test-preparation route.
- Delegated conflict delivery does not automatically merge a PR on GitHub.
- The resolver uses the chosen helper block or the first eligible block; there is no independent
  assessor agent. Required review/test freshness remains a broader design concern.

## Source map

`packages/server/src/control/conflict-resolution.ts`; `packages/orchestrator/src/resolution.ts`;
`packages/core/src/workspace/conflict-resolution.ts`; `packages/server/src/workspace/manager.ts`;
`packages/db/src/migrations/0012_conflict_resolution.sql`;
`docs/conflict-resolution/STATUS.md`; ADR-0030.
