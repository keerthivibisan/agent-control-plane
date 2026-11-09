# ADR-0036: Removing a project from ACP

- **Status:** accepted (project owner, in chat, 2026-11-09)
- **Date:** 2026-11-09
- **Deciders:** project owner; implementing agent (draft)
- **Amends:** ADR-0016 ("Tickets are cancelled, never deleted. A project with tickets cannot be
  removed from the app (409)")
- **Relates to:** ADR-0013 (guardrails), ADR-0018 (Skills & Agents writes), ADR-0034 (code map),
  ADR-0035 (project assistant)

## Context

A project can be added to ACP but not removed once it has a ticket or a run:
`DELETE /api/projects/:id` answers 409 `project_has_history` (ADR-0016). The owner wants to remove
projects they no longer use, keeping the folder and its git repository exactly as they are; the
owner deletes those by hand if they want (owner, 2026-11-09).

## Decision

1. **Removal deletes ACP's own records for the project**: its tickets, runs and everything under
   them (plans, comments, attachments, agents, approvals, reviews, ticket branch and pull request
   records), its workflow, setup, harness check history and code map. Adding the same folder again
   starts with no tickets.
2. **The project folder and its git repository are never touched.** ACP runs no git command on the
   repository during removal and deletes no branch, `acp/*` and ticket branches included. ACP's own
   checkout folders under its data directory (agent worktrees, ticket, review and harness
   checkouts, run folders) are deleted with the file system only, so the repository's
   `.git/worktrees` may keep entries that git reports as prunable (`git worktree prune` clears
   them). Only paths that resolve inside the data directory are ever deleted.
3. **Observed sessions, events and usage are kept.** They lose their project (`project_id` set to
   null, as the schema already does) and stay on the Sessions page; registering the same folder
   again attaches them again. Usage stays where it is; a run's attribution of a session (kind,
   ticket) goes with the run.
4. **Refused while work is active.** A run that has not ended, a running harness check or a running
   setup makes removal answer 409 `project_busy` with the active runs listed; the owner stops them
   first. An open assistant chat is ended and a code map build is dropped automatically.
5. **On the owner's action only**, from Project settings, after typing the project's name. The
   startup cleanup removes a leftover folder of a deleted run with the file system only, never by
   deleting its branch.

## Alternatives considered

- **Keep the records and hide the project** (archive). Declined by the owner: removal starts fresh.
- **Clean up `.git/worktrees` with `git worktree remove`.** Declined: no git command on the
  owner's repository.
- **Cancel active runs automatically.** Declined: the owner stops them first.

## Consequences

- The 409 `project_has_history` rule goes; `project_busy` replaces it.
- Ticket and run history of a removed project cannot be recovered.
- The comment on `tickets.project_id` in migration 0003 ("tickets are never deleted") is superseded
  by this ADR; the RESTRICT keys stay, and removal deletes runs, then tickets, then the project.
