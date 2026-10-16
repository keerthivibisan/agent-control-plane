# R-I (web) — Agent files on workflow stages

> Progress file for the web part of R-I. Only the agent working on R-I web edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Spec:
> `docs/redesign/README.md` §6a ("Web" row), ADR-0019 amendment §6, ADR-0018 amendment. The backend
> (engine, server, adapter) is a separate branch.

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
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
| 2026-10-16 | Claimed R-I web on `wp/r-i-web`                                                                                                       | `f9acf32` | docs only                                             |
| 2026-10-16 | Agent file picker, agent chip, missing-file warning, model from the file, Used by on both pages; 16 unit/component tests, 2 e2e tests | `a62f68d` | pnpm check ✓: test 1,972/1,972 (web 455); e2e 40/40 ✓ |
| 2026-10-16 | Completion report; status `review`                                                                                                    | `d1d6539` | docs only; full e2e re-run: 40/40 ✓                   |
| 2026-10-16 | Rebased on main `d35a3d6` (R-I backend merged). Lead-mode note in the Plan/Orchestrate panels (the engine's `stageAgentFor`); 1 test  | (this)    | pnpm check ✓: test 2,012/2,012 (web 456); e2e 40/40 ✓ |

## Handoff notes

### Decisions made (within the spec)

- **Field order in the panel:** Agent file, then Model, then Skill. The file sets the stage's
  default model, so it comes before the model field.
- **"None" leaves `agent` out** of the PUT body (the contract allows absent or null), so a stage
  without a file saves exactly as before R-I.
- **Agent chip:** the Skills & Agents page's agent icon (`SessionsIcon`) and the name, on the same
  line as the skill chip, agent first (README §6a "🤖 test-writer + ✦ unit-tests"). It is not shown
  when the stage has no file, so nodes without one look as before. Next to the agent chip, the
  "(missing)"/"(not found)" words are screen-reader text only (⚠, the warning tone and the tooltip
  remain), because two chips share 208px.
- **Model line on nodes:** stage > agent file > project, as ADR-0019 §6 says. When the file's model
  applies the node reads "claude-haiku-4 (agent file)".
- **Missing is only flagged when the list is known.** While `GET …/agents` is loading or answers
  404, a named file is kept and shown, never flagged.
- **"Used by" follows the draft on the Workflow page** (like the graph); on Skills & Agents it
  follows the saved workflow (`GET …/workflow`), and is left out when that route fails.
- **Delete of an agent file is not blocked** when stages use it (unlike skills): ADR-0019 §6 says a
  missing file is a problem and the agent starts without it. The cards show "Used by" first.

### For the coordinator / backend

- **Lead mode:** with `plannerMode: 'lead'`, Plan and Orchestrate are one lead agent, but each stage
  has its own `agent` field. The merged engine (`stageAgentFor`, `packages/orchestrator/src/stages.ts`)
  uses Orchestrate's file, else Plan's. The Plan and Orchestrate panels now say so in lead mode;
  both pickers stay editable. If the owner would rather have one picker for the lead, that is a
  small later change.
- **Live graph:** `features/ticket/LiveWorkflow.tsx` was not changed. It shows the agent chip
  (it passes the project's stages through), but doesn't load the agent files, so it never flags a
  missing file and its model line says "Agent file or default" for a stage with a file and no model.
  Loading `GET …/agents` there would be a small follow-up in R-H's file.
- **Docs to update on merge (not my paths):** `docs/redesign/README.md` §4.3 still says the Workflow
  page lists agent files as "available, not mapped".
- The missing-file warning uses only the existing `GET …/agents` list (and each entry's
  `problems`) with core's `stagesUsingAgent`, as the coordinator confirmed; no new DTO field.

## Completion report — R-I (web)

1. **Summary:** Workflow stages can name a project agent file: a picker in the stage panel, an agent
   chip on graph nodes (also on the ticket page's live graph), a missing-file warning, the file's
   model in the node and the model placeholder, and "Used by" on the Workflow page's agent files
   card and on Skills & Agents.
2. **Files changed:**
   - created: `packages/web/tests/features/stage-agent-files.test.tsx`, this file;
   - modified: `packages/web/src/features/workflow/{graph.ts,draft.ts,StagePanel.tsx,`
     `WorkflowNodes.tsx,WorkflowGraph.tsx,WorkflowPage.tsx,AgentFiles.tsx}`,
     `packages/web/src/features/skills/{AgentList.tsx,SkillsPage.tsx,bits.tsx}`,
     `packages/web/src/lib/copy.ts` (new R-I section at the end; four existing strings that said
     stages don't use agent files were corrected, and the unused `notMapped` was removed),
     `packages/web/e2e/{workflow-fixtures.ts,workflow.spec.ts,skills.spec.ts}`,
     `packages/web/tests/features/{workflow.test.tsx,agents.test.tsx}` (copy assertions).
3. **Commands run and actual results** (Node 22.21.1, pnpm 10.26.1):
   - `pnpm check` after the rebase on main `d35a3d6`: format ✓, lint ✓, typecheck ✓, test
     2,012/2,012 ✓ (core 247, demo 12, orchestrator 430, claude-code 300, db 168, web 456,
     server 399), build ✓;
   - `ACP_E2E_PORT=7651 ACP_E2E_CONTROL_PORT=7661 pnpm --filter @acp/web test:e2e`: 40/40 ✓;
   - screenshots (light/dark, 1440/1024) in the scratchpad, looked at; the first round showed
     truncated chips and model text, fixed (chip names in the body font, the "(not found)" word
     as screen-reader text, the "(agent file)" suffix kept outside the truncation).
4. **Acceptance criteria:**
   - picker on the five agent stages, "None" + agent files, not on Review → met (test "the picker
     offers None…", e2e);
   - helper text in plain words incl. read-only roles and lead mode → met (tests "read-only roles
     say…", "in lead mode…");
   - save uses the existing flow; `agent` set, and absent for None → met (component test and e2e
     check the PUT bodies);
   - agent chip next to the skill chip; live graph shows it → met (tests, incl. the ticket page);
   - missing-file warning on the node and in the panel → met (test and e2e);
   - "Used by" via `stagesUsingAgent`, linking to Workflow → met (Skills & Agents test and e2e;
     Workflow card chips open the stage);
   - model placeholder from the agent file's model (from the list DTO) → met (tests, e2e).
5. **Assumptions:** listed under "Decisions made" above.
6. **Contract or shared-file changes needed:** none. No `@acp/core` change; `lib/api.ts` unchanged
   (the existing `workflowPaths.agents` and `agentsPaths` are used).
7. **Known gaps / follow-ups:** lead mode has two pickers for one lead (explained in the panel);
   the live graph doesn't load agent files; `docs/redesign/README.md` §4.3 wording (see "For the coordinator").
8. **Next recommended task:** merge (the backend part is on main already), then R-V's consented real run
   (agent files applied per stage, read-only tool limits).
