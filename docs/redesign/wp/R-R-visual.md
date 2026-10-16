# R-R part 2 — Visual fixes before v0.0.1 (web)

> Progress file for R-R part 2 (visual). Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope: the
> ten "Visual problems" in `docs/redesign/wp/R-V.md`. Another agent does R-R's functional fixes in
> `packages/server/**` and `packages/web/src/features/skills/**` at the same time.

| Field   | Value                                   |
| ------- | --------------------------------------- |
| Status  | in-progress                             |
| Owner   | web visual agent                        |
| Branch  | `wp/r-r-visual` (from `main` `01b2079`) |
| Started | 2026-10-16                              |
| Updated | 2026-10-16                              |

Owned paths: `packages/web/**` except `src/features/skills/**`, `tests/features/{skills,agents}*`
and `e2e/skills.spec.ts`; `src/lib/copy.ts` strings for these items only; this file.

## Tasks (R-V.md "Visual problems")

- [ ] 1. Board: columns off-screen with no hint; a board with only a Done ticket looks empty
- [ ] 2. Board: "No tickets yet" and nine empty columns together
- [ ] 3. Planner side panel says "Chat with the lead agent"
- [ ] 4. Helper cards: branch as a UUID over three lines
- [ ] 5. A lead closed by the engine after a successful run reads "Stopped"
- [ ] 6. Live workflow: the final "Done" node is never highlighted
- [ ] 7. Tokens: runs but no observed sessions hides the run and ticket counts
- [ ] 8. Sessions inside a project: Project filter and "in your projects"
- [ ] 9. Data health: tabs above the title; switcher on global pages
- [ ] 10. Workflow at 1440: bottom row below the fold, "+" control over the Done edge, Save

## Work log (append-only; newest last)

| Date       | What was done                                                                    | Commit        | Checks    |
| ---------- | -------------------------------------------------------------------------------- | ------------- | --------- |
| 2026-10-16 | Claimed; before screenshots (light/dark, 1440/1024) in the scratchpad, e2e 49/49 | (this commit) | docs only |
