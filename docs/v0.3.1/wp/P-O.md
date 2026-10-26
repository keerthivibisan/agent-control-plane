# P-O

> Progress file for P-O. Only its agent edits it. Plan: [../README.md](../README.md). Owner request
> (2026-10-26): get the repository ready to be open-sourced and announced: update the Markdown files,
> the context for agents and the architecture; remove unwanted files; check that the branch is ready.
> Docs and repository hygiene only: no code under `packages/*/src`, no package versions, no
> `CHANGELOG.md` or `docs/v0.3.1/STATUS.md` (the coordinator's), no P-D files.

| Field  | Value                                                    |
| ------ | -------------------------------------------------------- |
| Status | in progress                                              |
| Branch | `wp/p-o-open-source` (from `release/0.3.1` at `d13afe6`) |

## Removal and move candidates

Tracked files only. Each one with the reason, decided before anything is deleted.

### Remove

| Path                                                                                 | Reason                                                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `HANDOFF.md`                                                                         | an internal agent hand-off (Phases 1–3, "how to continue" for the coordinator); its lasting content is in the specs, ADRs and research notes |
| `docs/workflow-graph/RESUME.md`                                                      | a resume note for a paused coordinator session (v0.2.0), with the owner's local release steps                                                |
| `docs/{phase-4,redesign,review-loop,ui-refresh,workflow-graph,v0.3.0}/STATUS.md` (6) | coordinator status logs of finished series: branch heads, merge hashes, pauses; only meaningful to the private coordination setup            |
| `docs/phase-4/wp/*.md` (10)                                                          | per-WP progress logs of a finished series                                                                                                    |
| `docs/redesign/wp/*.md` (18)                                                         | per-WP progress logs of a finished series                                                                                                    |
| `docs/review-loop/wp/*.md` (8)                                                       | per-WP progress logs of a finished series                                                                                                    |
| `docs/ui-refresh/wp/*.md` (8)                                                        | per-WP progress logs of a finished series                                                                                                    |
| `docs/workflow-graph/wp/*.md` (9)                                                    | per-WP progress logs of a finished series                                                                                                    |
| `docs/v0.3.0/wp/*.md` except T-1 and F-2 (25)                                        | per-WP progress logs of a finished series                                                                                                    |
| `.github/ISSUE_TEMPLATE/work_package.md`                                             | tracks a work package from the internal plan; outside contributors use the bug and feature templates                                         |

All of them stay readable in git history at tag `v0.3.0`, for example
`git show v0.3.0:docs/review-loop/STATUS.md`. [docs/history/README.md](../../history/README.md)
says so.

### Move to `docs/history/` (kept for provenance)

| From                              | To                                              | Why kept                                                                                   |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `docs/implementation-plan.md`     | `docs/history/phase-1-3/implementation-plan.md` | the Phase 0–3 plan; package READMEs and code comments cite its tasks                       |
| `docs/phase-4/README.md`          | `docs/history/phase-4/README.md`                | the Phase 4 plan; code comments and ADR-0016 cite its sections                             |
| `docs/redesign/README.md`         | `docs/history/redesign/README.md`               | the R-series plan; many code comments and ADR-0018..0020 cite its sections                 |
| `docs/review-loop/README.md`      | `docs/history/review-loop/README.md`            | the RL-series plan; ADR-0021, ADR-0022 and code comments cite it                           |
| `docs/ui-refresh/README.md`       | `docs/history/ui-refresh/README.md`             | the UI refresh plan; `packages/web/DESIGN.md` cites it                                     |
| `docs/ui-refresh/brand-brief.md`  | `docs/history/ui-refresh/brand-brief.md`        | the owner's brand brief behind `docs/brand/`                                               |
| `docs/workflow-graph/README.md`   | `docs/history/workflow-graph/README.md`         | the WG-series plan with its binding "WG-0 refinements"; ADR-0023 and code comments cite it |
| `docs/v0.3.0/README.md`           | `docs/history/v0.3.0/README.md`                 | the v0.3.0 plan; ADR-0024..0027 and migrations 0008..0011 cite it                          |
| `docs/v0.3.0/wp/T-1.md`, `F-2.md` | `docs/history/v0.3.0/wp/`                       | cited by `docs/testing/adversarial.md` as the record of the adversarial suite and its gaps |

Code comments under `packages/*/src` and the SQL migrations keep the old paths (this WP may not edit
code, and applied migrations are never edited); `docs/history/README.md` maps every old path to the
new one.

### Checked and kept

- `BUILD.md` and `START.md`: different readers (building and checking vs running and using); they
  share only the prerequisites. Not merged. The duplication was in `docs/development.md`, which now
  points to them instead of repeating the requirements, commands, configuration and CI.
- `docs/brand/*.svg`: byte-identical to `packages/web/public/brand/*.svg` on purpose (GitHub renders
  the README from `docs/brand/`, the app serves `public/brand/`).
- `scripts/reference-usage.ts`, `scripts/tsconfig.json`: used by the server's verification tests.
- `packages/orchestrator/tests/graph-correctness/__snapshots__/*.snap` (the only file over 300 KB):
  a test snapshot.
- `docs/v0.3.1/**`: the current release.
- `docs/roadmap.md`, `docs/orchestration-lifecycle.md`, specs, ADRs, research notes,
  `docs/testing/adversarial.md`, `test-fixtures/`, `docs/images/`, `docs/brand/`.
- No generated files are tracked (no `dist/`, `coverage/`, databases, logs, `.env`, `.DS_Store`).

## Log

- 2026-10-26 Claimed. Candidates listed above before any deletion.
