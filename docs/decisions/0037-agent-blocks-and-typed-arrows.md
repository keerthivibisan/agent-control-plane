# ADR-0037: One Agent block, roles from typed arrows (workflow graph v3)

- **Status:** accepted (project owner, in chat, 2026-11-09)
- **Date:** 2026-11-09
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0023 (editable workflow graphs: fixed block types, six untyped-data edges)
- **Relates to:** ADR-0019 (read-only roles), ADR-0021 (review loop), ADR-0031 (provider per block),
  ADR-0034 (code map), [docs/arrows/](../arrows/README.md)

## Context

A workflow graph has fixed block types (planner 0–1, lead, helper pool, helpers, reviewers 0–8,
testers 0–2). The block type fixes the agent's role, and the role fixes its tools, worktree,
approvals and read-only rules. Edges carry no label and no data; hand-offs between agents are
hard-coded per role. The owner wants flexibility: two research agents (one Claude, one Codex)
feeding planning, several planners or reviewers on different providers, and arrows that say what
flows and why (owner, 2026-11-09).

## Decision

1. **One Agent block.** Every agent except the lead is the same block. Its role is derived from
   its arrows by a pure function (`deriveRoles`): a `research` arrow out makes it a researcher, a
   `plan` arrow into Plan approval a planner, an `implement` arrow in an editor (helper), a
   `review` arrow in a reviewer, a `test` arrow in a tester. A block with no role or with two
   roles is a validation error. The derived role is the agent's `kind`, so tools, permissions,
   worktree and approvals keep following the role exactly as today: arrows can never give a
   read-only role edit rights.
2. **Typed, labelled arrows.** Every arrow may carry a `label` (40 characters) and a `purpose`
   (300 characters, owner text, given to the target agent as data). New arrow types:
   - `research`: the source runs before its target and its findings note goes into the target's
     prompt; researchers run in parallel and may chain (no cycles);
   - `custom`: order and hand-off only: the target starts after the source finishes and receives
     the source's output note with the arrow's label and purpose; it gives no role;
   - `plan`, `implement` (formerly `assigns`), `test`; `review`, `findings`, `rework`, `flow` and
     `merge` keep their meaning.
3. **A read-only `researcher` role.** It works in the project folder (like the planner), has the
   read-only file tools, `code_map`, `ask_lead` and `report_findings` (one note, at most 16 KiB,
   stored as a ticket comment of kind `research`). On Codex it runs the read-only profile.
4. **Several planners.** With two or more `plan` arrows, every planner submits a plan; Plan
   approval shows them side by side and the owner approves one, which the lead runs. The others
   are kept as not chosen.
5. **Review fan-out.** A change can go to several reviewers (for example Claude and Codex); any
   `rework` verdict means rework, and the lead sees every verdict.
6. **Graph version 3.** Saved version 2 graphs (and version 1 workflows) migrate on read without
   loss; runs keep the graph snapshot they started with.

## Alternatives considered

- **Keep typed blocks and add research and custom arrows.** Smaller, but each new combination
  would need a new block type; declined by the owner.
- **Two planners merged by the lead.** Declined: the owner picks.
- **Custom arrows as documentation only.** Declined: they order and hand off.

## Consequences

- Core graph contracts, validator, connection matrix, compiler and templates are rewritten around
  derived roles; the orchestrator gains a research stage, custom hand-offs, plan options and review
  fan-out; `ticket_plans` holds several drafts per run (migration 0016).
- The editor gets one Agent block with presets, an arrow menu with Custom, label and purpose
  editing, role badges, and a side-by-side plan approval.
- Purpose text is owner text but reaches agents as data; instructions inside it are never
  followed against the rules (AGENTS.md §3.7).
