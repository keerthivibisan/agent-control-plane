# v0.3.2 (Q series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0029](../decisions/0029-owner-rework-after-restart.md) (proposed).

## Goal

After the server stops and starts again, the owner can send a finished but unreviewed change back
for rework, and the run carries on, instead of cancelling the ticket and running it again (owner,
2026-10-26: "yes plan it for 0.3.2"; found by v0.3.1 P-D).

## Work packages

| WP  | What                                                                                                                                                                     | Owned paths                                                           | After |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----- |
| Q-0 | ADR-0029 accepted; the API action for an owner's rework after a restart (contract)                                                                                       | `docs/decisions/**`, `packages/core/src/api/**`, `docs/v0.3.2/**`     | —     |
| Q-A | Engine: `NEEDS_REVIEW → STARTING` for a sealed helper, `checkChange` for the owner, the lead resumed as a follow-up; tests incl. adversarial (late answer, lost session) | `packages/orchestrator/**`                                            | Q-0   |
| Q-B | Server and adapter: the rework action after a restart, resuming the helper and the lead, plain ticket lines                                                              | `packages/server/**`, `packages/adapters/claude-code/src/managed/**`  | Q-A   |
| Q-C | Web: Rework on such a change in Files changed and the merge box, with what will happen                                                                                   | `packages/web/src/features/ticket/**`, `packages/web/src/lib/copy.ts` | Q-B   |
| Q-V | Verification: e2e of restart → rework → review → merge; one consented real run                                                                                           | `packages/web/e2e/**`                                                 | all   |

## Verification

- A restart in the middle of a run (fake SDK): every live agent `NEEDS_REVIEW`, the owner's rework
  resumes the helper and the lead, the change comes back to review, the run completes.
- The same with the helper's and the lead's sessions gone: new helper session; the lead's loss
  leaves the run waiting with merge and discard working.
- Nothing starts without the owner's click; the branch guard holds for the resumed agents.
