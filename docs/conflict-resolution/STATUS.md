# Conflict resolution (CR series): status

Plan: [README.md](README.md). Decision:
[ADR-0030](../decisions/0030-conflict-resolution-and-delegated-delivery.md) (proposed).

| WP   | Title               | Status | Branch                        |
| ---- | ------------------- | ------ | ----------------------------- |
| CR-0 | Contracts, ADR-0030 | review | `feature/conflict-resolution` |
| CR-A | Engine              | review | `feature/conflict-resolution` |
| CR-B | Database            | review | `feature/conflict-resolution` |
| CR-C | Server              | review | `feature/conflict-resolution` |
| CR-D | Web                 | review | `feature/conflict-resolution` |

## What is implemented

- **Owner-triggered "Update from <target> / Resolve conflicts"** on the ticket's final step, also
  while a pull request is open (`POST /api/runs/:id/conflict-resolution`, CSRF; cancel and
  promote beside it).
- **Project policy** in Settings (`automation`): conflict resolution (manual or automatic,
  attempts), verification (required or adaptive, skip scopes, always-run checks, unverified
  delivery, missing-check route) and delivery (manual, push/PR, merge; allowed targets).
  Conservative defaults; nothing widens an existing project.
- **Server-owned git:** clean merges in a temporary checkout; conflicts repaired by a resolver
  helper in a worktree with the merge in progress; the server seals, checks markers and pins the
  candidate. No agent gains git authority.
- **Deterministic gate** over the entire combined change; the agent's assessment only adds checks
  or recommends a skip the policy may allow. Checks run on the exact candidate with the trusted
  harness file. Evidence is bound to candidate, target and policy; stale evidence is shown and
  blocks promotion.
- **Bounded retries** across replacements (no-change, blocked, markers, failures, failed checks),
  then the owner decides. Promotion by compare-and-swap. Delegated delivery only when allowed;
  recorded before the network call; `unknown` after a restart, never retried.
- **Structured helper outcomes** for every helper (`report_work.outcome`), forwarded to the lead;
  no-change helpers count as step attempts.
- **UI** shows resolution, verification, review and delivery apart, with reasons.

## Known limits (follow-ups)

- No test-preparation route for missing checks (only escalate or draft PR).
- No conditional checks in the workflow graph; adaptive skipping is a project policy.
- Targets are local refs; the app does not fetch `origin` before an update.
- Delegated delivery opens or updates a pull request but does not merge it on GitHub.
- Automatic start happens when the ticket branch is read (page open, SSE refetch) or another ticket
  of the project merges locally; there is no background timer.
- The resolver uses the policy's helper block (else the first); there is no separate assessor agent.

## Log

- 2026-10-27 Started from `origin/dev` (`38728c6`). `pnpm lint` passed on this base after
  `pnpm install --frozen-lockfile`: the earlier Shiki lint failure did not reproduce.
- 2026-10-27 CR-0..CR-D committed on `feature/conflict-resolution`; all WPs to review.
