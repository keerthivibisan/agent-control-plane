# R-B — Workflow page

> Progress file for R-B. Only the agent working on R-B edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value             |
| ------- | ----------------- |
| Status  | in-progress       |
| Owner   | frontend agent    |
| Branch  | `wp/r-b-workflow` |
| Started | 2026-10-16        |
| Updated | 2026-10-16        |

## Tasks

- [ ] 1. `buildWorkflowGraph(workflow, setup)`: a pure, data-driven graph model, with unit tests for
      every planner mode and stage toggle
- [ ] 2. The Workflow page: React Flow graph, agent nodes, legend, ⓘ "fixed for now"
- [ ] 3. Stage panel: model, skill, enabled, planner mode, helper limits and allowlist (setup PUT),
      review explanation, Save / Discard, refusals in plain words
- [ ] 4. Agent definitions side list (hidden when `GET …/agents` answers 404)
- [ ] 5. Wire into the shell (`project-pages.ts`, `ProjectScreen`)
- [ ] 6. Component tests with fixture DTOs; Playwright spec with screenshots (light/dark, 1440/1024)
- [ ] 7. Completion report

## Work log (append-only; newest last)

| Date       | What was done                       | Commit | Checks                    |
| ---------- | ----------------------------------- | ------ | ------------------------- |
| 2026-10-16 | Claimed R-B; read the spec and code | this   | docs-only; checks not run |

## Handoff notes

_None yet._

## Blockers / proposed contract changes

_None._

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
