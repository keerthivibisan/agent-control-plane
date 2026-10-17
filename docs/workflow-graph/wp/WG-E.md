# WG-E: Web live run graph

> Progress file for WG-E. Only the agent working on WG-E edits it (coordinator:
> `docs/workflow-graph/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with workflow-graph
> paths. Scope: [README.md](../README.md), WG-E row and the "WG-0 refinements".

| Field   | Value                                          |
| ------- | ---------------------------------------------- |
| Status  | in-progress                                    |
| Owner   | WG-E agent (Claude Code)                       |
| Branch  | `wp/wg-e-live` (from `feature/workflow-graph`) |
| Started | 2026-10-18                                     |
| Updated | 2026-10-18                                     |

## Tasks

- [x] 1. Client for `GET /api/runs/:id/workflow-graph` (lib/api.ts, additive) and the project
      graph read for the run-option ceilings
- [x] 2. Live run graph on the ticket page: the run's snapshot graph, read-only, square blocks
      (positions or a layered layout), node states, agents per node (click selects), editing
      blocks' mode for this run and the sandbox marker, review counts, rework counts per rework
      link (the review agent's direct rework shown as such), held final stage
- [x] 3. Fallback: the version 1 view when the endpoint answers 404 or 409
- [x] 4. Run options read as a ceiling ("at most"): Start dialog, the ticket's run options, the
      New ticket dialog; the no-effect note; reviewer and rework-round hints
- [x] 5. Change cards: the review agent as the decider of a direct rework, route (c)'s rounds
- [x] 6. Skills & Agents "Used by": `usedByNodes` labels, else the version 1 stages
- [x] 7. Copy in plain words (own section in `lib/copy.ts`)
- [ ] 8. vitest and e2e (mocked routes; scenario (c) fixture; screenshots)
- [ ] 9. Status `review`, `pnpm check`, full e2e, completion report

## Work log (append-only; newest last)

| Date       | What was done                                                                                                             | Commit  | Checks                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 2026-10-18 | Claimed WG-E                                                                                                              | 8bacf4e | format ✓ lint ✓ typecheck ✓ test 3909/3909 ✓ build ✓ |
| 2026-10-18 | Live run graph with the version 1 fallback, run options as a limit, direct rework on change cards, Used by blocks; vitest | (this)  | see commit                                           |

## Decisions and findings
