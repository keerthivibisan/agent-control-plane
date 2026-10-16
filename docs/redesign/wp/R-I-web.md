# R-I (web) — Agent files on workflow stages

> Progress file for the web part of R-I. Only the agent working on R-I web edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Spec:
> `docs/redesign/README.md` §6a ("Web" row), ADR-0019 amendment §6, ADR-0018 amendment. The backend
> (engine, server, adapter) is a separate branch.

| Field   | Value          |
| ------- | -------------- |
| Status  | in-progress    |
| Owner   | frontend agent |
| Branch  | `wp/r-i-web`   |
| Started | 2026-10-16     |
| Updated | 2026-10-16     |

## Tasks

- [x] 1. Stage panel: "Agent file" picker (None + project agent files) on the five agent stages,
      with plain helper text; the draft saves `agent` (absent for None)
- [x] 2. Graph nodes: agent chip next to the skill chip; the ticket page's live graph shows it too
- [x] 3. Missing-file warning on the node and in the panel
- [x] 4. Skills & Agents: "Used by" stage chips per agent file (`stagesUsingAgent`), linking to
      Workflow; Workflow's agent files card shows the same instead of "Not mapped"
- [x] 5. Model placeholder "From agent file: <model>" when the stage has no model
- [x] 6. Tests (unit, component, e2e) and screenshots light/dark at 1440 and 1024

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                         | Commit    | Checks                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| 2026-10-16 | Claimed R-I web on `wp/r-i-web`                                                                                                       | `b320fda` | docs only                                             |
| 2026-10-16 | Agent file picker, agent chip, missing-file warning, model from the file, Used by on both pages; 16 unit/component tests, 2 e2e tests | (this)    | pnpm check ✓: test 1,972/1,972 (web 455); e2e 40/40 ✓ |

## Handoff notes

(none yet)
