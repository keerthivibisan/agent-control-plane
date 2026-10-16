# R-J — The lead's chat after the lead ends (backend: engine, server, adapter)

> Progress file for the backend part of R-J. Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope:
> `docs/redesign/README.md` §6b; spec: ADR-0020; research:
> `docs/research/sdk-session-resume-2026-10-16.md`. The web part (chat box on ended runs) is a
> separate agent on its own branch.

| Field   | Value              |
| ------- | ------------------ |
| Status  | in-progress        |
| Owner   | backend agent      |
| Branch  | `wp/r-j-follow-up` |
| Started | 2026-10-16         |
| Updated | 2026-10-16         |

Owned paths: `packages/orchestrator/**`, `packages/server/**`, `packages/adapters/claude-code/**`,
their tests, this file, `docs/provider-adapters.md` (managed execution).

## Tasks

- [x] 1. Engine: follow-up command accepted on ended runs; never changes run status; one turn at a
      time; follow-up state (`available | running | unavailable`)
- [x] 2. Server: chat route starts a follow-up turn when the lead has ended; linked session id;
      turn budget from project limits; "can't be continued" reasons; no relaunch on restart
- [x] 3. Adapter: SDK `resume` (no fork), read-only toolset, no `acp` MCP server, one turn
- [ ] 4. Docs: `docs/provider-adapters.md` managed execution; proposed README text here

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                                    | Commit    | Checks                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------- |
| 2026-10-16 | Claimed R-J (backend) on the branch                                                                                                                                              | `7a0e9d0` | docs only                                         |
| 2026-10-16 | Engine: `followUpChat`/`followUpEvent`/`stopFollowUp`/`followUpView`, in-memory `RunState.followUp`, Stop all and restart handling                                               | `2504b8b` | pnpm check ✓: test 2,035/2,035 (orchestrator 451) |
| 2026-10-16 | Adapter: `resume` (no fork), answers-only toolset and gate, no MCP server, one turn; provider-adapters §11.1                                                                     | `4d625e0` | pnpm check ✓: test 2,044/2,044 (claude-code 309)  |
| 2026-10-16 | Server: chat route → follow-up turn on an ended lead; linked session id; `followUp` on the run detail; flagged messages; Stop; restart; 4 restart/stop tests updated to ADR-0020 | (this)    | pnpm check ✓: test 2,054/2,054 (server 409)       |
