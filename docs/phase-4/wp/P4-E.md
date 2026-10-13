# P4-E — Board UI

> Progress file for P4-E. Only the agent working on P4-E edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Status  | in-progress                                            |
| Owner   | frontend agent                                         |
| Branch  | `wp/p4-e-board` (create from `main` when you claim it) |
| Started | 2026-10-13                                             |
| Updated | 2026-10-13                                             |

## Tasks

- [ ] Route #/board and #/board/:projectId; nav entry 'Board' first
- [ ] Project switcher and header stats (token types never summed; estimated cost never summed)
- [ ] Columns by stage(); cards (key, title, type, priority, labels, helpers, budget tokens, needs-you badge)
- [ ] Native HTML5 drag and drop + keyboard Move menu; only owner-settable moves
- [ ] New ticket dialog; empty states
- [ ] Fixture-DTO tests; screenshots light/dark at 1440 and 1024; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                           | Commit        | Checks                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------- |
| 2026-10-13 | Claimed; branch `wp/p4-e-board` created from `main`                                                                                                                                     | (this commit) | —                           |
| 2026-10-13 | WIP checkpoint after a usage-limit interruption: board routes, client functions (api.ts), board copy, move rules, dialog, new-ticket dialog, move menu, icons. Board page not wired yet | (this commit) | WIP: pnpm check not run yet |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
