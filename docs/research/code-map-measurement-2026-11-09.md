# Code map measurement (CM-5), 2026-11-09

Owner-consented real runs with the CM-5 driver
(`packages/server/tests/verification/code-map/real-run/drive.ts`): a clone of this repository at
`520882e` under the home directory (deleted afterwards), Claude `haiku` at effort `low` for every
agent, Auto edits, change and final review off, the only check `git diff --check`. Two fixed tickets
(A: add `isManagedProvider` with a unit test in core; B: comment the Tokens page's "Not reported"
text), each run once with the code map on and once off (`ACP_CODE_MAP=off`), fresh server and data
folder per run, alternating order. Aggregates only.

## Index cost (map on)

| Files | Symbols | Build                            | DB growth |
| ----- | ------- | -------------------------------- | --------- |
| 1419  | 9000    | 1.15 s (median of 2 cold builds) | 2.4 MB    |

## Outcomes

All 4 runs completed, passed the check and were merged (success rate 1.0 in both arms).

| Ticket | Arm | Lead read / search / code_map | Helpers read / search | Budget tokens | Wall |
| ------ | --- | ----------------------------- | --------------------- | ------------- | ---- |
| A      | on  | 2 / 1 / 1                     | 2 / 1 (2 helpers)     | 50 087        | 83 s |
| A      | off | 2 / 1 / 2 (refused)           | 3 / 1 (2 helpers)     | 55 297        | 91 s |
| B      | on  | 2 / 3 / 0                     | 3 / 0                 | 30 477        | 67 s |
| B      | off | 2 / 2 / 0                     | 1 / 1                 | 21 138        | 45 s |

## Reading

- With one run per ticket and arm, the differences are within run-to-run variance; nothing here is
  significant, in either direction.
- The tickets were too easy to show the effect: `haiku` at low effort located the code with about
  two reads and one search per agent in both arms, so there was little discovery to save.
- The cost side is small and measured: about a second and 2.4 MB to index 1419 files, and a repo map
  of at most 4 KiB per agent.
- Next measurement, if wanted: cross-package tickets that need real discovery (for example a change
  that touches core, server and web), 3 repeats per arm, still with lightweight models.
