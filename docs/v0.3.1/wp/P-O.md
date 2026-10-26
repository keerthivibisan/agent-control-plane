# P-O

> Progress file for P-O. Only its agent edits it. Plan: [../README.md](../README.md). Owner request
> (2026-10-26): get the repository ready to be open-sourced and announced: update the Markdown files,
> the context for agents and the architecture; remove unwanted files; check that the branch is ready.
> Docs and repository hygiene only: no code under `packages/*/src`, no package versions, no
> `CHANGELOG.md` or `docs/v0.3.1/STATUS.md` (the coordinator's), no P-D files.

| Field  | Value                                                    |
| ------ | -------------------------------------------------------- |
| Status | review                                                   |
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

## Done

- **Removed** the 86 files above (`f3e23d2`) and **moved** the 10 plans to `docs/history/` with a
  history banner each and [docs/history/README.md](../../history/README.md) (`90cab65`). Links fixed
  in the moved plans, ADR-0016 and ADR-0018..0027 (paths only), the roadmap, the orchestration
  lifecycle, the adversarial guide and the package READMEs' plan links.
- **README.md** for a public audience (`87f2438`): what and why, a feature tour with the
  screenshots, quick start with prerequisites, safety and privacy, an honest Status, roadmap,
  architecture overview with mermaid, contributing, brand, license.
- **docs/architecture.md** for v0.3.x with diagrams for the packages, a managed run, workflow
  compilation, the review loop and the branch guard, each section marked implemented or planned;
  **docs/README.md** index; **docs/development.md** without the setup duplicated from BUILD.md and
  START.md; **docs/roadmap.md** releases and current statuses; START.md's branch and workflow steps
  (`e17110d`).
- **AGENTS.md and CLAUDE.md** for outside contributors (`a49b822`): current state, every rule kept
  with its number, a generic fork-branch-PR workflow, no owner-machine specifics.
- **CONTRIBUTING.md**, the bug and feature issue templates, the pull request template and
  SECURITY.md (`f58a18f`).
- **.gitignore**: `*.log`, `.eslintcache`, `*.tgz`, `blob-report/` (`f2af82e`).

## Readiness audit (2026-10-26)

| Check                                | Result                        | Evidence and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `package.json` fields           | **fail** (proposed, not made) | `name`, `private: true`, `license: MIT` and `description` are set. No `repository`, `homepage` or `bugs`, so npm and GitHub tooling can't link back. Shared file: diff proposed below.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Package `package.json` fields        | **fail** (proposed, not made) | All seven: `private: true` (none is published to npm, good) and `license: MIT`. Five descriptions end with internal ownership ("Owned by P1-B", "Owned by P3-A", …) and `@acp/web`'s describes the Phase 1 UI ("Command Center, Session Explorer"). No `repository`. Diff proposed below.                                                                                                                                                                                                                                                                                                                                  |
| LICENSE                              | pass                          | MIT, "Copyright (c) 2026 Agent Control Plane contributors" (ADR-0010). Valid as is; the owner may prefer to name themselves as the holder (an owner decision, not changed).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Third-party assets                   | pass, one note                | Brand SVGs are the project's own (owner's brief, `docs/history/ui-refresh/brand-brief.md`); they reference no external resource and embed no font (the wordmark names a system-safe stack). The app bundles no fonts (system stack, `packages/web/src/index.css`) and no sounds. Screenshots are of the app itself. Icons come from `lucide-react` (ISC) as an npm dependency. **Note:** `@anthropic-ai/claude-agent-sdk` is proprietary ("© Anthropic PBC. All rights reserved", its `LICENSE.md`); it is an npm dependency, not vendored, which is fine for an MIT repository. The README's License section now says so. |
| Screenshots show demo data only      | pass, one note                | All 14 images in `docs/images/` come from `packages/web/e2e/readme-screenshots.spec.ts` (demo server, temp data dir, synthetic routes). The 8 light-theme images checked by eye each show the "You're looking at sample data" banner and "demo mode"; the dark variants come from the same spec. **Note:** they show v0.3.0; `workflow.png` still draws the three end blocks and the mandatory Checks block that v0.3.1 replaced with the Finish block (ADR-0028). Regenerate after P-C merges (BUILD.md, "README screenshots").                                                                                           |
| Test fixtures synthetic or sanitized | pass                          | `test-fixtures/claude-code/README.md` and every scenario README say synthetic; paths are `/home/user/project`, ids `c0ffee00-…`; the denied-file fixtures (`*.key`, `settings.json`, `sessions/`) hold placeholders only. Demo fixtures are synthetic (`claude-demo-*` models, `/home/user/demo-*`).                                                                                                                                                                                                                                                                                                                       |
| No telemetry                         | pass                          | No analytics or beacon code, no `fetch`/`http(s).request` in server or adapter source; the only URLs in source are `127.0.0.1` (hooks), `github.com` remote parsing and the `gh` site link in copy.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| No hardcoded local paths or ports    | pass                          | No `/Users/…` or user names outside fake test values (`/Users/alice/secret-repo`, `/Users/someone/…` in redaction tests). Ports in source are the documented defaults only: `ACP_PORT` 7420 (`server/src/config.ts`), the dev UI 5173 (`server/src/app.ts`, `web/vite.config.ts`). Owner-machine wording ("this 8 GB machine") removed from `docs/testing/adversarial.md`; it remains only in the coordinator's `docs/v0.3.1/README.md`.                                                                                                                                                                                   |
| No TODOs claiming unfinished work    | pass                          | No `TODO`, `FIXME` or `XXX` in `packages/**` outside tests; none in the docs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Secrets                              | pass                          | Per the coordinator's scan; this WP added none. `.gitignore` covers `.env*`, databases, `.acp-data/`, `.claude/worktrees/`, `.claude/settings.local.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Docs claim only what is implemented  | pass                          | README Status, architecture and roadmap mark planned items as planned (pricing, OTel, Harness Lab, Codex, recommendations, other code hosts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CI for outside pull requests         | **fail** (proposed, not made) | `.github/workflows/ci.yml` runs on pushes to `main` and by hand (`workflow_dispatch`). A fork's pull request cannot be started from the Actions tab (dispatch runs branches of this repository only), so "CI must pass" has no automatic check for contributors. Proposed below; left unchanged as instructed.                                                                                                                                                                                                                                                                                                             |
| Git history                          | owner decision                | The coordinator found the local user name in worktree paths in 12 commits on `main`. Rewrite or not before the repository goes public. Nothing on this branch adds one.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Proposed shared-file changes (not made)

Root `package.json` (add after `"license"`):

```json
"repository": { "type": "git", "url": "git+https://github.com/keerthivibisan/agent-control-plane.git" },
"homepage": "https://github.com/keerthivibisan/agent-control-plane#readme",
"bugs": { "url": "https://github.com/keerthivibisan/agent-control-plane/issues" },
"keywords": ["claude-code", "ai-agents", "coding-agents", "orchestration", "observability", "local-first"],
```

and `"description": "Local-first control plane to observe and orchestrate Claude Code agents."`.

Package descriptions (and the same `repository` with `"directory": "packages/<name>"`):

| Package                    | Proposed `description`                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@acp/db`                  | SQLite persistence for Agent Control Plane: migrations, repositories, transactions.                                           |
| `@acp/orchestrator`        | The pure run engine of Agent Control Plane: run and agent state machines, plans, budgets, the review loop, workflow programs. |
| `@acp/server`              | The Agent Control Plane server: REST API, SSE, ingestion pipeline, managed runs, git and GitHub.                              |
| `@acp/web`                 | The Agent Control Plane web UI (React): board, tickets, workflow editor, sessions and tokens.                                 |
| `@acp/adapter-demo`        | Deterministic demo and test adapter. Demo mode and tests only; never mixed with live data.                                    |
| `@acp/adapter-claude-code` | Claude Code adapter: session, subagent and hook observation, and managed runs over the Claude Agent SDK.                      |

`.github/workflows/ci.yml`: add a `pull_request` trigger with the same `paths-ignore`, keeping
`permissions: contents: read` (safe for forks: no secrets are used):

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ['docs/**', '**/*.md']
  pull_request:
    paths-ignore: ['docs/**', '**/*.md']
  workflow_dispatch:
```

### Before going public (owner, in GitHub; not done by this WP)

- Decide on the git history (above), then make the repository public.
- Turn on **private vulnerability reporting** (SECURITY.md points to it) and add the repository's
  description and topics.
- Optionally add a `good first issue` label and open a few issues from CONTRIBUTING.md's "Good
  first areas".

## Follow-ups

- **Code comments cite moved plans** (`docs/redesign/README.md`, `docs/phase-4/README.md`, …) in
  `packages/*/src` and tests; a comment-only rewrite to `docs/history/<series>/` can follow once P-C
  and P-D have merged (never in migrations). `docs/history/README.md` maps the old paths until then.
  `packages/web/DESIGN.md` and `docs/research/sdk-tool-narrowing-2026-10-16.md` mention the old
  paths in prose too (left alone: P-C and P-D may be editing nearby).
- **Package READMEs are stale** (for example `packages/web/README.md` describes the Phase 1 Command
  Center; `packages/server/README.md` says the allowlist is "not active yet"). Listed as a good
  first area in CONTRIBUTING.md.
- **Regenerate the screenshots** after P-C (the Finish block, effort chips); bump the README badge
  with the release.
- After v0.3.1 ships, move `docs/v0.3.1/README.md` to `docs/history/v0.3.1/` and drop its
  `STATUS.md` and `wp/` the same way.

## Log

- 2026-10-26 Claimed. Candidates listed above before any deletion.
- 2026-10-26 Removal (`f3e23d2`), moves and links (`90cab65`), README (`87f2438`), architecture and
  docs index (`e17110d`), agent context (`a49b822`), contributing (`f58a18f`), `.gitignore`
  (`f2af82e`). Format check and link check pass. Status `review`.
