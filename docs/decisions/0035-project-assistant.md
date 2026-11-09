# ADR-0035: A project assistant chat on every project page

- **Status:** accepted (project owner, in chat, 2026-11-09)
- **Date:** 2026-11-09
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0018 §2 ("only on an owner action"), see decision 5
- **Relates to:** ADR-0009 (no conversation content stored), ADR-0012/0031 (managed adapters),
  ADR-0013 (guardrails), ADR-0015 (the lead's chat), ADR-0034 (code map),
  [docs/assistant/](../assistant/README.md)

## Context

The owner wants a helper next to their work: a floating chat on project pages that tells them the
state of their tickets, answers questions about the project, and writes skills and agent
definitions for them from a description of what the project needs, asking follow-up questions when
the description is thin (owner, 2026-11-09). ACP already has everything such an agent needs: managed
adapters for Claude and Codex, read-only roles, the code map, a tool channel to the server, and the
Skills & Agents writer with its path rules (ADR-0018).

## Decision

1. **Where.** A floating button at the bottom right of every project page opens a chat panel
   scoped to that project. Not on global pages.
2. **What runs.** A managed agent session of a new read-only role, `assistant`, started through the
   provider's `ManagedExecutionAdapter` in the project's checkout. It is not part of any ticket run
   and never starts, stops or messages ticket agents. The panel picks the provider (Claude by
   default, or Codex), the model (default `sonnet` for Claude) and the effort (low, medium, high).
   Changing any of them starts a new chat.
3. **Tools.** Read-only repository tools (as for the lead), the code map (`code_map`), and four ACP
   tools answered by the server:
   - `ticket_status`: tickets, their runs, agents, approvals waiting for the owner and latest
     activity, from the database;
   - `project_info`: settings, workflow, harness, and the existing skills and agents;
   - `propose_skill` and `propose_agent`: a complete `SKILL.md` or agent definition for a slug,
     validated by the same rules, sizes and front matter checks as the Skills & Agents page.
4. **Chat history is session only.** The conversation lives in the server's memory and the panel;
   it is gone after a reload or a restart, and nothing about it is stored (ADR-0009 unchanged; unlike
   the lead's chat, ADR-0015 does not apply). Usage is still recorded as for any managed session.
5. **Writes, two modes chosen in the panel.**
   - **Approve** (the default): a proposal appears in the chat as a file preview with Apply and
     Discard; the app writes it only when the owner clicks Apply.
   - **Auto**: the app writes the proposal as soon as the assistant makes it, and the chat shows
     what was written. This is the owner's explicit choice, made per panel, and it amends ADR-0018
     §2 for this path only: the switch itself is the owner action.

   Either way the only files are `.claude/skills/<slug>/SKILL.md` and `.claude/agents/<slug>.md`
   through the ADR-0018 writer (path rules, symlink checks, size caps), never anything else, and an
   existing file is replaced only when the assistant says so explicitly and the panel shows it as a
   replacement. Committing stays a separate owner action.

6. **Safety.** The assistant cannot edit the repository, run commands, or reach ticket agents.
   Repository content and tool results are data; an instruction inside them is never followed. The
   Codex assistant runs under a read-only permission profile with the deny list (CX-3b).

## Alternatives considered

- **Reuse a ticket's lead.** A lead belongs to one ticket and ends with it.
- **Store the chat like the lead's (ADR-0015).** Declined by the owner: session only.
- **Approve only.** The owner wants an Auto mode as well.

## Consequences

- A new role and four new control tools in both adapters; a server-side assistant service; a chat
  stream to the browser; the floating panel.
- The Auto mode makes the assistant's proposals land in the project's files without a click per
  file; the panel must make the mode visible at all times.
