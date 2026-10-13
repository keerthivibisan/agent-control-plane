# P4-C — Harness: manifest, context files, check runner

> Progress file for P4-C. Only the agent working on P4-C edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                                                    |
| ------- | -------------------------------------------------------- |
| Status  | in-progress                                              |
| Owner   | harness agent                                            |
| Branch  | `wp/p4-c-harness`                                        |
| Started | 2026-10-13                                               |
| Updated | 2026-10-13                                               |

## Tasks

- [ ] Manifest reader/validator → HarnessStatus with plain-sentence problems
- [ ] Context-file reader (realpath inside repo, ≤10 files, ≤32 KiB total)
- [ ] Check runner: execFile no shell, bare argv[0], timeouts with kill, output tail ≤16 KiB redacted, filtered env, sequential
- [ ] Run on main via temporary detached worktree (uses src/workspace)
- [ ] Tests with temp git repos and tiny scripts; pnpm check green

## Work log (append-only; newest last)

| Date | What was done | Commit | Checks |
| ---- | ------------- | ------ | ------ |
| 2026-10-13 | Claimed P4-C; branch `wp/p4-c-harness` created from `main` | (this commit) | — |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
