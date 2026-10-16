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

- [ ] 1. Stage panel: "Agent file" picker (None + project agent files) on the five agent stages,
      with plain helper text; the draft saves `agent` (absent for None)
- [ ] 2. Graph nodes: agent chip next to the skill chip; the ticket page's live graph shows it too
- [ ] 3. Missing-file warning on the node and in the panel
- [ ] 4. Skills & Agents: "Used by" stage chips per agent file (`stagesUsingAgent`), linking to
      Workflow; Workflow's agent files card shows the same instead of "Not mapped"
- [ ] 5. Model placeholder "From agent file: <model>" when the stage has no model
- [ ] 6. Tests (unit, component, e2e) and screenshots light/dark at 1440 and 1024

## Work log (append-only; newest last)

| Date       | What was done                   | Commit | Checks    |
| ---------- | ------------------------------- | ------ | --------- |
| 2026-10-16 | Claimed R-I web on `wp/r-i-web` | (this) | docs only |

## Handoff notes

(none yet)
