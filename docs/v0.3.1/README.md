# v0.3.1 plan: effort per agent, optional checks, a clear finish (P series)

Coordinator-owned plan. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0028](../decisions/0028-agent-effort-optional-checks-finish-block.md). Progress files:
`wp/P-*.md`, one per WP, each edited only by its agent. Branch: `release/0.3.1` (from `main` at
v0.3.0, `60ac0df`); the owner raises the PR to `main` in GitHub.

## What we are building

1. **Effort per agent:** Default, Low, Medium or High on every agent block in the Workflow editor;
   passed to Claude Code; shown on the block, the live run graph and the agent's details.
2. **Optional, clearer Checks blocks:** every Checks block can be removed; plain descriptions of
   what each runs and when; a warning (not an error) when a workflow has none; checks gate only
   where they are placed.
3. **One Finish block:** "Merge into <target> or open a pull request, then Done", replacing the
   three end blocks in the editor and the live graph.

## Work packages

| WP  | What                                                                                                                                        | After |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| P-0 | Coordinator: ADR-0028, contract (`AgentEffortSchema`, `effort` on agent blocks, `ProgramAgentNode.effort`, `ManagedAgentSpec.effort`), plan | —     |
| P-A | Core, engine, server, adapter: effort through compile → launch → SDK; Checks blocks optional (validation, compile, engine, server gates)    | P-0   |
| P-B | Web: effort select, removable Checks blocks with clear text and the warning, the Finish block in the editor and live graph                  | P-0   |
| P-V | Full check and e2e once per merge; release prep (version 0.3.1, CHANGELOG, PR text, notes)                                                  | all   |

**Process:** as for 0.3.0 (isolated worktrees, branches `wp/p-<id>-<slug>` from `release/0.3.1`,
lean checks by agents, the coordinator's full check and e2e once per merge; vitest with 2 workers on
this 8 GB machine).
