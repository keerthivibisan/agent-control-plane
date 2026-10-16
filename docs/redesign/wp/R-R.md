# R-R part 1 — Functional fixes before v0.0.1

> Progress file for R-R part 1 (`wp/r-r-fixes`). Only the agent working on it edits it
> (coordinator: `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign
> paths. Sources: the R-V findings (`wp/R-V.md`), the R-I and R-K review notes in `STATUS.md`,
> ADR-0018 (agent-files amendment), ADR-0019 §6/§7, `docs/provider-adapters.md` §11. The visual
> fixes are a separate branch (`wp/r-r-visual`) with its own file.

| Field   | Value          |
| ------- | -------------- |
| Status  | in-progress    |
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
- [ ] 2. Agent templates match the role base sets ("Code reviewer" read-only, no shell commands)
- [ ] 3. `docs/provider-adapters.md` §11 header cites the real runs (P3-F, R-V)
- [ ] 4. P3-F e2e driver: `fake.byId` takes the latest start of an agent run

## Work log (append-only; newest last)

| Date       | What was done                                                                                                           | Commit    | Checks                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------ |
| 2026-10-16 | Claimed R-R part 1 on main                                                                                              | `90d9d64` | docs only                      |
| 2026-10-16 | Task 1: agent-file delete refused while a stage uses it (409 `agent_in_use`); web disables Delete and shows the refusal | (this)    | pnpm check ✓: test 2,093/2,093 |
