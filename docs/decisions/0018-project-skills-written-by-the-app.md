# ADR-0018: Project skills written by the app

- **Status:** accepted — owner decision 2026-10-16 (docs/redesign/README.md §2)
- **Date:** 2026-10-16

## Context

The owner wants to add and edit Claude Code **skills** from the UI, and map them to workflow stages
(ADR-0019). Claude Code loads project skills from `<project>/.claude/skills/<name>/SKILL.md`, a Markdown
file with YAML front matter (`name`, `description`). Storing them in the repo means agents load them
natively and they are versioned and reviewed with the code.

AGENTS.md rule 6 says the app never modifies Claude Code configuration. Skills are not settings, but
they change what agents do, so writing them needs an explicit, narrow exception.

## Decision

1. **Scope of writes.** The app may create, replace and delete exactly
   `<registered project root>/.claude/skills/<slug>/SKILL.md`, where `<slug>` matches `SkillNameSchema`.
   It may also remove an empty `<slug>/` folder after a delete. Nothing else under `.claude/` is ever
   written: `settings*.json`, `agents/`, `commands/` and hooks are all excluded. `~/.claude` (personal
   skills) is never read or written.
2. **Only on an owner action.** Every write is a request with the CSRF header, from the Skills page.
   Agents never write skills through this API. Any skill change an agent makes in its worktree goes
   through normal review and merge.
3. **Path safety.**
   - `realpath` the project root.
   - Refuse when `.claude`, `.claude/skills` or `<slug>` exists as a symlink, or resolves outside the
     root.
   - Create missing folders with `mkdir`, never following links.
   - Write with an exclusive temp file plus rename.
   - Cap the size at `MAX_SKILL_BYTES` (64 KiB) and require UTF-8 text.
4. **The owner's working tree.** This is the first app write into the owner's checkout outside agent
   worktrees (ADR-0013 §2 kept agents out of it). The write is visible: the skill shows
   **uncommitted** until committed.
   - **Commit** is a separate owner action. It runs `git add -- <that folder>` and
     `git commit -m "chore(skills): <create|update|remove> <slug>"` with argv only (ADR-0013 §1), on
     the current branch, and never pushes.
   - It refuses when other files are staged, so a skill commit never sweeps in the owner's own work.
5. **Content.** SKILL.md is the owner's own file, shown and edited in the UI. It is not conversation
   content (ADR-0009). It is never logged, and it is redacted only when displayed in error messages.
6. **Use by agents.** A stage mapped to a skill tells its agent to use it (ADR-0019). Managed agents
   don't load `.claude/skills` directly, because they run with `settingSources: []`. The server copies
   the mapped skill, with its front matter reduced to name and description, into a run-scoped
   skills-only plugin (ADR-0019 §4, amended 2026-10-16). The app never injects the file's text into
   prompts.

## Alternatives considered

- **Store skills in the app's database and inject them into prompts.** No repo writes are needed, but
  skills don't travel with the code, and Claude Code's native skill loading is bypassed. The owner
  rejected this.
- **Write skills only through a ticket and agents.** Safe, but too slow for a two-line tweak. A ticket
  stays available for larger skill work.

## Consequences

- AGENTS.md rule 6 gains this exception. Tests must cover the path rules: symlinked `.claude`, a
  `..` slug, an oversize file, and staged unrelated files refused at commit.
- The Skills page shows git state, so the owner always knows what changed in their tree.

## Amendment (2026-10-16): agent definition files

The owner asked to add and edit **agent definitions** (Claude Code subagents) from the UI as well. The
same decision applies, with these specifics:

- **Scope of writes:** exactly `<registered project root>/.claude/agents/<slug>.md` (`AGENTS_DIR`),
  where `<slug>` matches `SkillNameSchema`. All the §3 path rules apply: realpath the root, refuse
  symlinked `.claude`, `.claude/agents` or files, write atomically, and cap the size at
  `MAX_AGENT_BYTES` (64 KiB). Writes happen only on an owner action, with CSRF.
- **File format:** front matter `name`, `description`, optional `tools` (a list of tool names,
  `AgentToolNameSchema`) and optional `model`, followed by the instructions. The app writes no other
  front-matter keys (`permissionMode`, `hooks`, `mcpServers`, …) even if a hand-edited file has them.
  The page shows such keys as a problem: "kept as is, not used by the app".
- **Commit:** a separate owner action, `git commit -m "chore(agents): <create|update|remove> <slug>"`,
  with the same refusal when other files are staged.
- **Use by managed agents:** not yet. Mapping a workflow stage to an agent definition, or giving the
  stage agents these definitions as subagents through the run's skills plugin (whose `agents/` is
  copied with front matter reduced to `name`, `description`, `tools` and `model`), is a later decision.
  It needs a real-run check that copied definitions cannot widen permissions. Until then, agent files
  serve the owner's own Claude Code sessions and are shown on the Workflow page as "available, not
  mapped".
- AGENTS.md rule 6 is amended to name `.claude/agents/<slug>.md` next to skills.
