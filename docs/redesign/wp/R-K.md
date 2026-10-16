# R-K — Role tool base sets (adapter)

> Progress file for R-K. Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Spec:
> ADR-0019 §7 (amendment "a fixed tool base set per role"), with §6 (agent files), ADR-0020
> (follow-up turn) and ADR-0013 §2. Evidence: `docs/research/r-v-real-run-2026-10-16.md`.

| Field   | Value               |
| ------- | ------------------- |
| Status  | in-progress         |
| Owner   | adapter agent       |
| Branch  | `wp/r-k-role-tools` |
| Started | 2026-10-16          |
| Updated | 2026-10-16          |

Owned paths: `packages/adapters/claude-code/**` and its tests,
`packages/server/tests/verification/redesign/**` (only where a test asserts the old SDK options),
`docs/provider-adapters.md` §11, this file.

## Tasks

- [ ] 1. Role base sets: an explicit SDK `tools` for every role; agent file and follow-up only
      narrow; `Skill` only with a plugin
- [ ] 2. Gate as a second layer: deny built-ins outside the effective base set; Skill gate for the
      run's `acp-skills:*` names only
- [ ] 3. The lead is read-only: no edit/shell tools, never asks the owner about them
- [ ] 4. Tests (fakes only) and `docs/provider-adapters.md` §11

## Work log (append-only; newest last)

| Date       | What was done             | Commit | Checks    |
| ---------- | ------------------------- | ------ | --------- |
| 2026-10-16 | Claimed R-K on the branch | (this) | docs only |
