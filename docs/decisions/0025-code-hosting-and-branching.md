# ADR-0025: Code hosting (GitHub) and branching strategies

- **Status:** accepted: owner decisions in chat 2026-10-22 ("integrate GitHub (later GitLab) and
  branching strategies"; answers: the `gh` CLI login, the owner's button only, local merge or PR
  per ticket, syntax highlighting allowed; "yes go ahead")
- **Date:** 2026-10-22
- **Deciders:** project owner (decisions); coordinator (draft and review)
- **Amends:**
  - AGENTS.md §3 rule 8 ("Local only": one more owner-triggered exception);
  - ADR-0013 (the commands the app may run: `gh` beside `git` and the SDK's `claude`);
  - ADR-0021 §4 (the owner's final step: merge locally or open a pull request).
- **Plan:** [docs/v0.3.0/README.md](../v0.3.0/README.md), G series

## Context

Until now a ticket ends with the owner merging its branch `acp/<KEY>` into the project's current
branch locally. Teams use branching strategies (GitHub flow, Git flow) and review work as pull
requests on GitHub, and they want branch names that follow their conventions. The app was
strictly local: no network calls except the `claude` process the Agent SDK starts.

## Decision

### 1. GitHub through the owner's own `gh` login

- **Connection:** the server works out a project's host and `owner/name` from its `origin` remote.
  It checks the GitHub CLI with `gh --version` and `gh auth status`, by **exit code only**: their
  output is never read, kept or logged.
- **Credentials:** the app never reads, stores or sends a token.
- **Commands:** pushing uses `git push` (the owner's git credentials) and pull requests use
  `gh pr create`, `gh pr view` and `gh pr list`. Every command is an argument array (ADR-0013),
  never a shell, with `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT_DISABLED=1` and a time limit.
- **Inputs:** branch names are validated (`GitBranchNameSchema`), and titles and bodies go through
  a temporary file or argument, never a shell string.
- **GitLab later:** the same shape, with `glab`, behind one small `CodeHost` interface in the
  server.

### 2. Only the owner pushes or opens a pull request

- **Who:** only by a click on the ticket (CSRF-protected). Agents have no tool for it, and no
  agent's tool set changes.
- **When:** nothing is sent on a timer. The pull request's state is read when the owner opens the
  ticket or clicks Refresh.
- **Where:** network use is limited to the project's own `origin` and the GitHub API that `gh`
  calls.
- **What is published:** the pull request's body is the run summary (ADR-0024: the lead's note and
  the facts), which the owner sees on the ticket before clicking.

### 3. A branching strategy per project

The strategy is stored in the project setup (JSON, no migration) and has:

- a preset: GitHub flow, Git flow or Custom;
- a base branch;
- a default target branch;
- a ticket branch template using `{key}`, `{slug}` and `{type}`;
- a word for each ticket type.

The template must contain `{key}` and must render to a safe name. Projects without a strategy keep
the old behaviour.

### 4. Per ticket

- **Settings:** a ticket may set its own branch name and target branch (`Ticket.branch`). Absent
  fields follow the project.
- **Branching:** at plan approval the ticket branch is created from its target branch. When the
  name is already taken, `-r<n>` is added.
- **The owner's final step,** either:
  - merge into the target locally (today's merge, now into the ticket's target); or
  - **Push & open PR:** push the ticket branch and open a pull request against the target. The
    ticket shows the pull request and its state, and becomes Done when GitHub reports it merged.

### 5. Storage

- **The strategy:** in the project setup JSON.
- **Migration 0008 (additive, backed up before it is applied to the live database):**
  - `tickets.branch_prefs` (JSON);
  - `ticket_branches` rebuilt without the `acp/*` name check (names are validated in Zod);
  - columns for the pull request on the ticket branch (provider, number, URL, state, checked-at).

  Rows from before 0.3.0 read unchanged.

### 6. The diff view

The web shows diffs with one shared viewer:

- a file list;
- unified or side-by-side;
- syntax highlighting with Shiki, bundled locally and loaded on demand, with no network at run time;
- word-level changes;
- collapsed unchanged lines and a large-diff guard.

Diffs are still read from git when shown and never stored (ADR-0009).

## Consequences

- **Network:** the app makes network calls for the first time beyond `claude`, only on the owner's
  click and only to the project's own remote and GitHub. Tests use a local bare git remote and a
  fake `gh` and need no network.
- **Prerequisite:** the owner installs `gh` and runs `gh auth login` themselves. The app shows a
  plain message when that is missing.
- **Rollback:** 0.2.0 cannot read a database after migration 0008. The 0.3.0 notes say so, and the
  owner keeps the pre-0.3.0 backup.

## Alternatives considered

- **A personal access token stored by the app** (Keychain plus the REST API): rejected by the
  owner; the app would hold a credential.
- **Automatic push or pull requests at the end of a run:** rejected by the owner; only a click
  publishes.
- **Pull requests only, for GitHub projects:** rejected by the owner; the local merge stays as a
  choice.
