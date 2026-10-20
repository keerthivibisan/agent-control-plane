# WG-V: Verification

> Progress file for WG-V. Only the agent working on WG-V edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-V row and the "WG-0 refinements";
> [RESUME.md](../RESUME.md) Step 4 and Step 4b (the no-regression gate).

| Field   | Value                                            |
| ------- | ------------------------------------------------ |
| Status  | in-progress                                      |
| Owner   | WG-V agent, part 1 (Claude Code)                 |
| Branch  | `wp/wg-v-verify` (from `feature/workflow-graph`) |
| Started | 2026-10-20                                       |
| Updated | 2026-10-20                                       |

Part 1 covers the server-side gate items: the upgrade test, the data-copy check script and the
real-run driver (prepared, not run). The e2e per template and the removal of the version 1
endpoints wait for WG-D (it is editing `packages/web/**`).

## Tasks

- [ ] 1. Upgrade test `packages/server/tests/verification/workflow-graph/upgrade-from-0.1.0.test.ts`
      (Step 4b item 3, plus rollback item 5 as far as a test can prove it)
- [ ] 2. Data-copy check script `.../workflow-graph/data-copy-check.ts` (Step 4b item 4; the owner
      consented on 2026-10-20), tested on the synthetic upgrade data dir
- [ ] 3. Real-run driver `.../workflow-graph/real-run/drive.ts` for scenarios a, b, c and mixed
      (Step 4), with `--dry-run` on the fake adapter, tested in CI; commands, duration and token
      estimates below for the coordinator
- [ ] 4. Status `review` with the AGENTS.md §9 report

## Work log (append-only; newest last)

| Date       | What was done | Commit | Checks                    |
| ---------- | ------------- | ------ | ------------------------- |
| 2026-10-20 | Claimed WG-V  | (this) | format ✓ (this file only) |

## Decisions and findings
