# R-R part 1 — Functional fixes before v0.0.1

> Progress file for R-R part 1 (`wp/r-r-fixes`). Only the agent working on it edits it
> (coordinator: `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign
> paths. Sources: the R-V findings (`wp/R-V.md`), the R-I and R-K review notes in `STATUS.md`,
> ADR-0018 (agent-files amendment), ADR-0019 §6/§7, `docs/provider-adapters.md` §11. The visual
> fixes are a separate branch (`wp/r-r-visual`) with its own file.

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
| Owner   | fixes agent    |
| Branch  | `wp/r-r-fixes` |
| Started | 2026-10-16     |
| Updated | 2026-10-16     |

Owned paths: `packages/server/src/skills/**`, `packages/server/tests/**`,
`packages/web/src/features/skills/**`, `packages/web/tests/features/{skills,agents}*`,
`packages/web/e2e/skills.spec.ts` (only if needed), `docs/provider-adapters.md`, this file.

## Tasks

- [x] 1. Refuse deleting an agent file a workflow stage uses (409, like skills); web shows the
      server's message
- [x] 2. Agent templates match the role base sets ("Code reviewer" read-only, no shell commands)
- [x] 3. `docs/provider-adapters.md` §11 header cites the real runs (P3-F, R-V)
- [x] 4. P3-F e2e driver: `fake.byId` takes the latest start of an agent run

## Work log (append-only; newest last)

| Date       | What was done                                                                                                           | Commit    | Checks                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------- |
| 2026-10-16 | Claimed R-R part 1 on main                                                                                              | `b269737` | docs only                                   |
| 2026-10-16 | Task 1: agent-file delete refused while a stage uses it (409 `agent_in_use`); web disables Delete and shows the refusal | `d6717b3` | pnpm check ✓: test 2,093/2,093              |
| 2026-10-16 | Task 2: agent templates fit their stages (reviewer Read/Grep/Glob, no shell commands); stage notes; tests               | `29b9bbc` | pnpm check ✓: test 2,097/2,097; e2e 49/49 ✓ |
| 2026-10-16 | Task 4: fake adapter `byId` returns the latest start (follow-up turns reuse the lead id); redesign e2e driver uses it   | `32f9438` | pnpm check ✓: test 2,097/2,097; e2e 49/49 ✓ |
| 2026-10-16 | Task 3: provider-adapters §11 header cites the P3-F and R-V/R-K real runs; verified bullets updated                     | `e621311` | pnpm check ✓: test 2,097/2,097              |
| 2026-10-16 | Rebased on `main` (`609367c`; hashes above are the rebased ones); completion report; status `review`                    | (this)    | pnpm check ✓: test 2,097/2,097; e2e 49/49 ✓ |

## Decisions and choices

- **Error code `agent_in_use`** (409), not `skill_in_use`: the web shows a friendly line per code,
  and "this skill" would be wrong for an agent file. The message has the same shape as the
  skill one: "The agent file is used by these workflow stages: Orchestrate. Remove it from them
  first." Both come from `skills/in-use.ts` (one stage-label table).
- **A switched-off stage still counts**, as for skills: `stagesUsingAgent` reads the stage's
  `agent` whatever `enabled` says, so turning a stage back on never finds its file gone.
- **`workflowOf` is required** for the agents service (optional for skills): the default workflow
  names no agent file, so a default would silently disable the guard.
- **Web:** the agent editor now gets "Used by" from the saved workflow, so Delete is disabled with
  the same note as skills; while the workflow is unknown, Delete is offered and the server's 409
  shows as a friendly line plus the server's sentence.
- **Templates:** each has a `stages` list (checked by a test against the ADR-0019 §7 base sets)
  and a "Suits the … stage" note in its description. The test writer suits Unit tests and
  Helpers; it no longer says it may change production code (the tester brief forbids it).
  `COMMON_TOOLS` (chips) still offers `WebFetch`, `WebSearch` and `TodoWrite`, which no stage
  gets; left as is (agent files are also Claude Code subagents outside the app).

## Outside the owned paths (made, minimal; please review)

- `packages/server/src/bootstrap.ts`: one wiring change, passing `workflowOf` to
  `createAgentsService`. Without it the guard cannot see the saved workflow in production.
- `packages/web/e2e/workspace.spec.ts`: one assertion. The owner-flow e2e expected the reviewer
  template's `Remove Bash` chip; it now expects `Remove Read` and no Bash chip.

## Proposed text for coordinator-owned files (not made)

- `packages/web/src/lib/copy.ts`, `AGENTS_COPY.refusals`: add
  `agent_in_use: 'A workflow stage still uses this agent file.'` and drop the local `REFUSALS`
  in `features/skills/AgentEditor.tsx` (kept local because the visual WP edits `copy.ts`).
- `docs/redesign/README.md` §4.3, Agents: "… and Delete with confirmation, refused while a
  workflow stage uses the file (like skills)."
- `docs/redesign/STATUS.md`: R-V findings 1, 4 and 5 and the §11 header note are fixed on
  `wp/r-r-fixes`.

## Completion report — R-R part 1

1. **Summary:** deleting an agent file a stage uses is refused (409 `agent_in_use`, stage names
   in plain words) and the page disables Delete or shows the refusal; the agent templates only
   list tools their stages get (the Code reviewer reads only, with no shell commands); §11 cites
   the real runs; the fake adapter's `byId` returns the latest start.
2. **Files changed:**
   - created `packages/server/src/skills/in-use.ts`, `docs/redesign/wp/R-R.md`;
   - modified `packages/server/src/skills/{agents,errors,service}.ts`,
     `packages/server/src/bootstrap.ts`,
     `packages/server/tests/skills/{agents.test,helpers}.ts`,
     `packages/server/tests/verification/redesign/{agent-files.test,e2e-server}.ts`,
     `packages/server/tests/control/{fake-adapter,follow-up.test}.ts`,
     `packages/web/src/features/skills/{AgentEditor,SkillsPage,editor-parts}.tsx`,
     `packages/web/src/features/skills/agent-templates.ts`,
     `packages/web/tests/features/agents.test.tsx`, `packages/web/e2e/workspace.spec.ts`,
     `docs/provider-adapters.md` (§11 header and verified bullets).
3. **Commands run and actual results** (on the rebased branch): `pnpm check`: format ✓, lint ✓,
   typecheck ✓, test 2,097/2,097 ✓ (core 249, demo 12, orchestrator 451, claude-code 323,
   db 168, web 476, server 418), build ✓.
   `ACP_E2E_PORT=8051 ACP_E2E_CONTROL_PORT=8061 pnpm --filter @acp/web test:e2e`: 49 passed.
4. **Acceptance criteria:**
   - in-use agent file delete refused like skills, message names the stages → met (agents
     service and route tests; R-V `agent-files.test.ts` now expects the 409 over HTTP, the stage
     still gets the file, and the delete works once no stage names it);
   - web shows the server's message → met ("shows the server's refusal …" test; Delete disabled
     while a stage uses the file, test);
   - Code reviewer template Read, Grep, Glob, no shell commands → met (template tests);
   - other templates checked against the base sets, with a stage note → met (`it.each` test);
   - §11 header cites R-V and P3-F, only verified statements → met (review of the two research
     notes; unverified items listed as such);
   - `fake.byId` returns the latest start, tests green → met (follow-up test asserts it; e2e
     49/49).
5. **Assumptions:** none beyond the decisions above.
6. **Contract or shared-file changes needed:** none to contracts. The copy, README and STATUS
   text above is proposed, not made.
7. **Known gaps / follow-ups:** the `copy.ts` move of the `agent_in_use` line; `COMMON_TOOLS`
   chips offer tools no stage gets (owner call).
8. **Next recommended task:** merge `wp/r-r-fixes` with `wp/r-r-visual`, then the v0.0.1 steps
   (versions, CHANGELOG, tag, first CI run).
