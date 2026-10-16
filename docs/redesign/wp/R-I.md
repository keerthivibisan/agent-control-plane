# R-I — Stage agent files (backend: engine, server, adapter)

> Progress file for the backend part of R-I. Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope:
> `docs/redesign/README.md` §6a; spec: ADR-0019 §6 (amendment) and the ADR-0018 amendment. The web
> part (stage picker, chips, missing-file warning) is a separate agent on its own branch.

| Field   | Value                |
| ------- | -------------------- |
| Status  | in-progress          |
| Owner   | backend agent        |
| Branch  | `wp/r-i-agent-files` |
| Started | 2026-10-16           |
| Updated | 2026-10-16           |

Owned paths: `packages/orchestrator/**`, `packages/server/**`, `packages/adapters/claude-code/**`,
their tests, this file.

## Tasks

- [ ] 1. Engine: the stage's agent-file name on the `start-agent` effect; model precedence
      (stage > file > project > provider default) as a pure, tested helper
- [ ] 2. Server: read and parse `<project root>/.claude/agents/<name>.md` from the owner's checkout
      with R-D's module; build `spec.profile`; missing/unsafe/oversize/unparsable → no profile,
      counted diagnostic, run not blocked; workflow PUT/GET round-trip `agent`
- [ ] 3. Adapter: profile instructions appended to the system prompt; tools narrowed with the SDK
      `tools` base set and the gate; never widened; `allowedTools` never set
- [ ] 4. Docs: `docs/provider-adapters.md` managed execution; proposed README text here

## Work log (append-only; newest last)

| Date       | What was done                       | Commit | Checks    |
| ---------- | ----------------------------------- | ------ | --------- |
| 2026-10-16 | Claimed R-I (backend) on the branch | (this) | docs only |

## Handoff notes

_In progress._

## Blockers / proposed contract changes

_None yet._
