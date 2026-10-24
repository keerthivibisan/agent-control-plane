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
- **Hooks (2026-10-22, G-A):** pushes use `git push --no-verify`, so the repository's own pre-push
  hooks never run from the app: as with managed runs, a repository cannot make the app run its code.
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

### 7. Connecting a project from Settings (amended 2026-10-23, owner: "Cant we bring this in our ACP plane project settings UI to configure github there"; "yes, build it now in 0.3.0")

- **The login stays the owner's.** `gh auth login` is interactive and handles credentials, so the
  app never runs it. The Settings card shows the command and a Check again button.
- **Create a repository:** on the owner's click, the app runs `gh repo create <owner>/<name>
--private|--public` (no `--source`, no `--push`), then `git remote add origin <address>` in the
  project's checkout. With "push my branch now", it then runs `git push --no-verify -u origin
<current branch>`.
- **Connect an existing repository:** on the owner's click, `git remote add origin <address>`, and
  nothing is pushed.
- **What may be written:** one `origin` remote in the project's own `.git/config`, only when there
  is none yet (409 `origin_exists` otherwise; the app never changes or removes a remote). A push
  (a ticket branch for a pull request, or a new branch, §8) uses `--set-upstream`, so it also
  records that branch's tracking branch there. Nothing else in the owner's checkout changes
  outside the merges the owner clicks.
- **Inputs:** names and addresses are checked with `GitHubOwnerSchema`, `GitHubRepoNameSchema` and
  `parseGitHubRepository` (github.com only; no user, port, query or extra path). The address the
  app writes is rebuilt from the parsed owner and name (`gitHubRemoteUrl`), never the typed text.
- **Commands:** argument arrays only, with `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT_DISABLED=1`, a time
  limit and hooks disabled, as in §1. `gh`'s output is not shown or kept beyond a plain error
  sentence.

### 8. Creating branches from the app (amended 2026-10-23, owner: "can we also give option to create these branches ... We need to create any branch")

- **Listing:** the app reads the project's local branches with `git for-each-ref refs/heads`, and
  which exist on `origin` from `refs/remotes/origin` (no fetch).
- **Creating, on the owner's click only:** `git branch --no-track <name> refs/heads/<from>` in the
  project's checkout. The checkout is never switched and no file changes; it adds one branch
  reference, as the ticket branches already do. Names are checked with `GitBranchNameSchema` and
  `git check-ref-format --branch`; an existing branch is never moved (409 `branch_exists`).
- **Pushing it, on the owner's click only:** the same push as for ticket branches (§1):
  `git push --set-upstream --no-verify origin refs/heads/<name>:refs/heads/<name>`.
- **Where:** in the project's Settings (a Branches list with New branch), in a ticket's branch
  settings (pick a target or create one), and on the "target branch does not exist" refusal
  ("Create <name> from <base>", then Start again).

### 9. Merging a pull request and deleting the ticket branch (amended 2026-10-23, owner: "we need branch delete option like merge and delete"; chose "Merge PR + delete, and Delete")

- **Merge, on the owner's click only:** `gh pr merge <number> --repo <owner>/<name>
--merge|--squash|--rebase [--delete-branch]`, run outside the project's checkout so `gh` never
  switches or deletes anything there. The method is the owner's choice per click; GitHub may refuse
  one the repository does not allow, and the app shows that plainly. Then the app reads the pull
  request again, and the ticket becomes Done when GitHub reports it merged (§4).
- **Delete branch, on the owner's click only, once the branch is merged or discarded:** `git push
--no-verify origin --delete refs/heads/<branch>` when `origin` still has it, and `git branch -D
<branch>` in the project when the ticket branch is not the checkout's current branch (refused
  otherwise). Only the ticket's own branch, never the base or target branch.
- **With "Delete branch" on a merge:** GitHub deletes the head branch, and the app deletes its local
  ticket branch as above.

### 10. Where a ticket branch starts (amended 2026-10-24, owner: "we need to bring in a explicit option we configure from which branch we should checkout at project level and ticket level. By default it will point to the main / default target branch")

- **Settings:** the project's strategy gains `defaultSourceBranch` ("Start ticket branches from";
  absent: the ticket's target) and a ticket gains `branch.from` (absent: the project's).
- **Creating:** at plan approval the ticket branch is created from the tip of its source branch
  (`from`, else the project's, else the target), never switching the checkout. A missing source is
  refused plainly, with the Create branch action (§8).
- **Merging back:** unchanged. The owner merges into the target; when the target is not an
  ancestor of the ticket branch (it started from another branch), the local merge asks to update
  the branch from the target first. A pull request is raised against the target as before.
- **Shown:** the ticket branch records its source when it differs from the target, and the ticket
  shows it ("from release/1.0").
- The strategy's `baseBranch` stays a protected long-lived branch, as before.

### 11. Where the owner's pushes go (amended 2026-10-24, F-2)

Every push the app makes
for the owner goes to `origin`'s configured address (`remote.origin.url`), passed as the
address, never the remote name, so a `remote.origin.pushurl` is never used. That covers Push &
open PR, a new branch's push, the push after creating a repository, and the delete on origin.
The address must be a recognised repository address or a local folder, and `ext::` and `fd::`
are off. A `url.<x>.pushInsteadOf` rewrite of it is refused, and `url.<x>.insteadOf` applies as
for fetches. After a push, the app sets the remote-tracking ref and the branch's upstream
(`origin`), as `--set-upstream origin` did.

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
