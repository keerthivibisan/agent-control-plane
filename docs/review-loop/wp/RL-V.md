# RL-V — Verification and integration polish for the review loop

> Progress file for RL-V. Only the agent working on RL-V edits it (coordinator:
> `docs/review-loop/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with review-loop paths.
> Scope: `docs/review-loop/README.md` §9 (RL-V) and the coordinator's brief (2026-10-17).

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Status  | in-progress                                            |
| Owner   | agent (RL-V)                                           |
| Branch  | `wp/rl-v-verify` (from `feature/ui-refresh` `cd75936`) |
| Started | 2026-10-17                                             |
| Updated | 2026-10-17                                             |

## Tasks

- [ ] 1. Browser e2e of the loop against the real server (scripted fake agents)
- [ ] 2. Integration polish: live graph reads the run's limit; Checks tab "Run again" for loop
      runs; additive contract (`RunDetailDto.reviewer`/`maxReworkRounds`, optional `allowlist`,
      ticket-branch POST response); refusal reasons promoted to codes
- [ ] 3. Docs: orchestration lifecycle, architecture, README, CHANGELOG
- [ ] 4. Real-run driver and plan (not executed; needs the owner's consent)

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks |
| ---------- | ------------- | ------ | ------ |
| 2026-10-17 | Claimed RL-V  | (this) | docs   |
