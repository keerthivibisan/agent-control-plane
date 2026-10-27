# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Update from target / Resolve conflicts** on a ticket branch whose target moved, also while a
  pull request is open. The app merges in its own copy; a resolver helper repairs conflicts; the
  result is checked and applied only if nothing moved meanwhile (ADR-0030, proposed).
- **Conflicts, verification and delivery policy** in project Settings: automatic resolution,
  adaptive verification with approved documentation scopes, explicit unverified delivery, and
  delegated push/PR or merge to allowed targets. Everything stays manual until you change it.
- The ticket shows resolution, verification, review and delivery separately, with the reason for
  any skipped, unavailable, failed or stale verification.
- Helpers report an outcome (completed, no change, blocked) that reaches the lead; repeated
  no-change attempts are bounded.
- **`./start.sh --restart`** stops a copy of this app already running on ports 7420 and 5173
  (SIGTERM, waits up to about 10 seconds; only processes that belong to this repository) before
  starting. Without it, the script stops with a message naming the port and PID. `-h` and `--help`
  print the usage.

### Database

- Migration 0012 adds `conflict_resolutions`. Back up the database before upgrading.

## [0.3.1] - 2026-10-26

A patch release for the Workflow page and long runs. Each agent block can set its effort, every
Checks block is optional, the end of the flow is one Finish block, and linking blocks is much
easier. A run no longer ends when you take your time to decide on a change. There is no database
change: 0.3.1 opens the 0.3.0 database as it is.

### Added

- **Effort per agent block:** Default, Low, Medium or High, set in the block's panel and shown as
  a chip on the block and on the live run graph. More effort means the agent thinks longer before
  acting: slower, and more tokens. Default leaves it to the model.
- **Easier linking on the Workflow page**
  - Start a link from any side of a block; connectors appear on hover and keyboard focus.
  - Drop anywhere on a block, or near one: the link snaps to the nearest block that accepts it.
    While you drag, blocks that accept the link glow and the others fade.
  - When only one kind of link fits, it is made at once; the chooser appears only when several do.
  - Link without dragging: click a connector, then a block (Escape cancels), or use **Link to…** in
    the block's panel or its menu (right-click or Shift+F10), which lists only the blocks the link
    may end on.
  - Drag either end of a link to another block. A move that isn't allowed is refused and the link
    stays where it was.
  - **Undo** and **Redo** (⌘Z and ⇧⌘Z, or Ctrl on Windows and Linux), up to 50 steps.
  - **Tidy layout** puts every block back in the automatic layout, with a short animation (none
    when your system reduces motion).

### Changed

- **Checks blocks are optional, all of them,** including the one before the lead's merge. Each
  says in plain words what it does and what happens without it. Without a Checks block before the
  merge, a helper's change merges after review only, and the editor says so.
- **What gates your final merge:** a workflow without a Checks block before the merge needs only
  the checks of its Checks block on the ticket branch, if it has one. Workflows that keep the block
  before the merge (every workflow from 0.3.0) work exactly as before.
- **One Finish block** ends the flow: "Merge into `<target>` or open a pull request", with the
  ticket's target. It replaces the separate final-merge and Done blocks in the editor and on the
  live run graph.

### Fixed

- A run could end while it waited for you. The 2-hour run limit counted the time a change waited
  for your decision, so after a long run your Rework or Merge cancelled the run within seconds and
  the ticket had to be run again. Time spent waiting only for you no longer counts, and a run that
  does reach the limit now ends cleanly.
- A helper sent back for rework could fail when its earlier session could not be continued. It
  now starts a new session in the same folder, with its earlier work, and the ticket says so.
- Agents no longer inherit `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY` from your shell, which could end
  them while they waited for you.

### Known issues

- After the server stops while agents are working (a restart, or quitting the app), their run
  waits for you as "Needs review". You can merge or discard a finished change, but not send it
  back for rework; start the ticket again instead. Planned for 0.3.2
  ([ADR-0029](docs/decisions/0029-owner-rework-after-restart.md)).

### Development

- Ready to open source: a new README, architecture and contributor docs, AGENTS.md and CLAUDE.md
  for contributors' coding agents, and issue and pull request templates. The internal coordination
  logs were removed (still readable at tag `v0.3.0`); the plans of finished series are in
  `docs/history/`.
- CI runs for `main`, `dev/*` and `release/*`: on pull requests into them (forks included) and on
  pushes to them. Pull requests into `main` and pushes to `main` also run the browser tests.

### Upgrading from 0.3.0

Stop the app, update (`git pull`), and start it with `./start.sh` or `pnpm install && pnpm dev`.
There is no database change. To go back to 0.3.0: a workflow you saved in 0.3.1 without a Checks
block before the merge is refused by 0.3.0 until you add that block again; effort settings are
ignored.

## [0.3.0] - 2026-10-25

GitHub and a ticket page that reads like a pull request. Connect a project to GitHub from
Settings, choose how ticket branches are named and where they start, then push the finished
ticket branch, open a pull request and merge it, all from the ticket. The ticket page now has
Comments, Agents, Files changed, Checks and Conversation tabs, with a review view like GitHub's.
Your harness can prepare each helper's copy of the project and run checks at the points you
choose in the workflow. Helpers and testers can no longer manage branches in any mode: the app
owns branches and commits. The app has a new GitHub-like look with Light, Dark and System themes.
The database is upgraded when the app first starts; back it up first (see Upgrading), because
0.2.0 cannot open it afterwards.

### Added

- GitHub, through your own `gh` login
  - Settings has a GitHub card. It shows whether the GitHub CLI (`gh`) is installed and signed
    in, and tells you what to run in your terminal if not. The app never reads or stores a token.
  - From the same card, create a new repository on GitHub or connect an existing one as the
    project's `origin`, and optionally push the current branch. A remote you already have is never
    changed.
  - On a finished ticket, **Push & open PR** pushes the ticket branch and opens a pull request
    against its target. The ticket shows the pull request, its state and a link. **Push new
    commits** appears when the branch has commits the pull request does not have yet.
  - **Merge pull request** merges it from the ticket, as a merge, a squash or a rebase, with
    **Delete branch** ticked by default. When GitHub reports the pull request merged, the ticket
    moves to Done.
  - **Delete branch** removes a merged or discarded ticket branch, on GitHub first and then the
    local copy. It never deletes the target or a branch that is checked out.
  - Nothing is pushed or opened without your click, and nothing is sent on a timer: an open pull
    request is read when you open the ticket or click Refresh.
- Branching strategies
  - Choose GitHub flow, Git flow or Custom in Settings → Branches: the base branch, the default
    target, and a name template such as `{type}/{key}-{slug}`, with a live preview.
    Projects without a strategy keep `acp/<KEY>`.
  - Each ticket can set its own branch name, target and "Start from" branch in New ticket or on
    the ticket page. "Start ticket branches from" sets the project's default.
  - Settings lists the project's local branches and can create a new one from any branch, without
    switching your checkout, and optionally push it. A ticket whose target or start branch is
    missing offers to create it in one click.
  - At the end of a ticket, choose to merge into its target locally or to push and open a pull
    request.
- The ticket page, like a pull request
  - A header with the title, state and branch → target, the merge box at the top of Comments,
    and a sidebar with the branch, pull request, run options and labels.
  - **Comments**, the first tab: the description, your comments and the lead's summary of the
    whole ticket, which later runs update. Comments show paragraphs, lists, code and links; HTML is
    shown as text.
  - **Agents:** the run's live workflow and every agent of the run.
  - **Files changed:** a review view like GitHub's, with a file tree, unified or side-by-side
    diffs with syntax colours, "Viewed" checkboxes and comments on lines. **Review changes** sends
    your line comments back as rework notes. "Changes from" shows all changes or one helper's.
    After a merge it stays readable, from the recorded commits.
  - **Checks:** setup runs and check results, grouped by where they ran.
  - **Conversation:** a timeline of what happened, filterable by who: runs and plans, each
    helper's and tester's note, reviews and decisions, the run's facts, merges and pull requests.
    Your reviews from Files changed appear here as "You reviewed".
  - A badge at the right of the header shows how long the ticket took and how many tokens it used,
    for example "Took 1h 12m · 1.2M tokens", or "Running 14m" while it runs.
- Attachments
  - Attach files to a ticket or a comment: images, text, Markdown, CSV, JSON, PDF, zip and gzip,
    up to 10 MB each and 50 per ticket. Images are previewed.
  - Agents get read-only copies and their brief lists them by name. The copies are never
    committed.
- Notes from every agent
  - Each helper and tester writes a short note of what it did and how it checked it. The lead
    writes a summary of the whole ticket in Comments, in plain past tense, like a teammate.
- The harness in your workflow
  - Setup steps in `.acp/harness.json` (at most 5), such as installing dependencies. They run in
    each helper's and tester's own copy before it starts, and in a fresh copy before checks; never
    in your project folder, and not for agents that only read.
  - A step that downloads things says so, and runs only while "Setup may use the network" is on
    for the project (off by default).
  - Folders a step creates, such as `node_modules`, are never added to a change or a commit.
  - Labels on checks (for example `fast` and `full`) let a Checks block pick a group.
  - Checks blocks in the workflow: on each helper's change before its review, before the lead's
    merge (always there, as before), and on the ticket branch. Each chooses which checks run and
    what happens on failure: back to the helper (up to 5 rounds), the lead decides, or ask you.
  - The Harness page shows the setup steps, the labels, where each check runs, and **Run setup and
    checks now** on the main branch.
- Session names
  - Sessions the app starts are named when they start, for example "WEB-12 · Frontend helper", and
    Claude Code records the same name.
  - Sessions without a title show the helper's type and task, or their branch and start time,
    never "Untitled". The Tokens page uses the same names.
- A run summary on the ticket after each run: the lead's note, with the run's facts under Details,
  and a line when you merge.
- Themes: Light, Dark or System, in the top bar and in Settings → Appearance.

### Changed

- A GitHub-like look: a blue accent, green primary buttons, a dark top bar, and GitHub's diff
  colours. The logo keeps its own colours.
- The app uses your system's fonts. Inter and JetBrains Mono are no longer bundled.
- A roomier shell: larger text, a 56-pixel top bar with the logo and "ACP" on the left and the
  search in the centre, and a wider sidebar with its own open and close button (⌘B still works).
- The Workflow editor is easier to read: clearer routing, highlighted valid targets when you link
  blocks, a link chooser, a legend and a grouped problems list.
- The workflow's Checks block is now configurable, and can also sit on each change and on the ticket
  branch. Existing workflows keep exactly one block before the lead's merge with all required
  checks, as before.
- Ticket branches are named by the project's strategy and start from the ticket's "Start from"
  branch, else the project's, else the target.
- Links to the old separate review pages now open the ticket's Files changed tab.

### Fixed

- When a ticket branch was changed outside the app, the lead could keep trying to merge into it.
  Such a change now goes to you at once, and the ticket offers **Reset to the last reviewed
  commit**.
- The Tokens page listed untitled sessions as "Session 1a2b3c4d". It now uses the same names as
  the Sessions page.

### Security

- Helpers and testers can no longer create, switch, commit to, reset, merge, rebase, stash, fetch
  or push branches, in any approval mode, including Full auto. The app owns branches and commits.
- In Full auto, the operating-system sandbox no longer lets a helper write to the repository's
  git folders.
- A plan with steps that run branch or commit commands is refused before anyone approves it, and
  the app's harness runner never runs a check or setup step that manages branches.
- Your pushes go only to `origin`'s own address. A planted push address in the repository's
  settings is ignored or refused, and the repository's own push hooks never run from the app.
- Retries are bounded. A plan step, and a run, may lose only a few helper attempts before the lead
  must hand over, so a run cannot restart helpers without end.
- A ticket branch moved outside the app can't be merged or pushed until you reset it to the last
  reviewed commit, so nothing unreviewed ships.
- Attachments are served only by the local server, as downloads with strict content types. HTML
  and SVG are refused.

### Upgrading

- Back up your database before the first start: stop the app, then copy
  `~/.agent-control-plane/acp.sqlite` (or the one in your `ACP_DATA_DIR`), with its `-wal` and
  `-shm` files if they exist, somewhere safe.
- On first start, 0.3.0 upgrades the database in four additive steps (migrations 0008 to 0011):
  ticket branch settings and pull requests; comment kinds, agent notes and attachments; setup runs
  and where checks ran; and the ticket's start branch. Your projects, tickets and runs keep
  working.
- After that, 0.2.0 cannot open the database. To go back, restore the backup.
- The GitHub features need the GitHub CLI, `gh`, installed and signed in (`gh auth login`).
  Everything else works without it.
- Run `pnpm install` after updating: the bundled fonts were removed.

## [0.2.0] - 2026-10-21

Your own workflow for each project. Draw which agents work on a ticket and how they review each
other's changes, give each helper its own approval mode, and follow the run on a live graph. Your
current workflow is converted for you when the app starts, and nothing in your data changes
shape. Until you save a workflow, start a ticket or stop the app while checks run on 0.2.0, you can
still go back to 0.1.0; after that, going back is not supported, because 0.1.0 cannot read what
0.2.0 saved.

### Added

- Workflow editor
  - Draw how a ticket flows on the Workflow page: add blocks from a palette (a planner, named
    helpers, a helper pool, change and final reviewers, a tester) and link them.
  - Links that make no sense are refused with the reason. A problems list explains what to fix in
    plain words, and Save stays off until the workflow can run.
  - Three ways to review a change:
    - the lead reviews and merges;
    - a review agent checks it and the lead decides;
    - the review agent sends it back to the helper until it is right, then the lead merges.
  - Start from a template ("Lead only", "Today's setup", "Reviewer ↔ helper loop") or build your
    own. "Restore my earlier setup" brings back the workflow you had before.
  - New projects pick a template when you create them.
- Named helpers
  - Give a helper a name and a purpose, for example "Frontend helper". Each has its own model,
    skills, agent file and approval mode, and a limit on how many may work at once.
  - Plan steps go to the helper they name. A step that no helper can take is refused, and the
    refusal lists the helpers you have.
- An approval mode for each helper
  - Each block that edits files has its own approval mode, or follows the project's.
  - The plan approval block has its own switch for approving plans automatically.
- A live workflow on the ticket page
  - The ticket page draws the run's own workflow. Each block shows its state, its agents, the mode
    it runs with in this run and, when it applies, that its commands are sandboxed.
  - Rework links show how often a change went back, including when the review agent sent it back
    itself.
- Starting the app
  - `./start.sh` checks Node and pnpm, installs what is missing, and starts the app.
    `./start.sh --demo` starts it with sample data.
  - `BUILD.md` and `START.md` explain how to build, check and run the app.

### Changed

- A ticket's or a run's approval mode is now a limit ("at most …")
  - It can make a helper more careful, never less. The new "No limit" choice keeps each helper's
    own mode.
  - Before, a ticket could choose a looser mode than the project's, for example Full auto in an
    Auto edits project. Now set the loosest mode you want on the helper's block in the workflow.
  - A note says when a limit changes nothing.
- "Lead reviews" on a ticket or run sends every change to the lead, whatever the workflow's links
  say. Rework rounds on a ticket or run replace the workflow's limits for that run.
- "Used by" on the Skills & Agents page names the workflow blocks that use a skill or agent file.
- The README is now a proper front page, with screenshots of sample data.

### Fixed

- Stopping the app while checks ran, for example to upgrade, left the merge refused as "checks
  failed". Those checks now show as Stopped and run again when you merge, including checks that
  0.1.0 stopped this way.
- A tall dialog, such as "Start with options…" in a shorter window, could open scrolled down to
  its Start button, hiding its title and first choices. It now opens at the top.

### Security

- A helper set to Full auto keeps the operating-system sandbox when a ticket or run makes it
  stricter; its requests then ask as the stricter mode says.
- No workflow can switch off a safety rule. Only helpers and testers edit, each in their own copy
  of the project; only the lead merges into the ticket branch, after the required checks; and only
  you merge into main.

## [0.1.0] - 2026-10-17

A new look and a review loop. The app has a new identity and works on small screens. Ticket runs now
review each helper's change before it is merged into a ticket branch that you merge into main once,
and a new Full auto mode lets a run go from plan to that final merge without asking you anything.
Approval settings can be set per project, per ticket or for a single run. Before 1.0.0, features
and data formats may still change between releases.

### Added

- New logo
  - The Control Core: a central square linked to four agent squares. It is in the top bar, the
    browser tab and the README.
- Collapsible sidebar
  - Switch between the full list and a slim row of icons with the button at the bottom of the
    sidebar, or with ⌘B (Ctrl+B on Windows and Linux).
  - The app remembers your choice in this browser. Until you choose, narrow windows show the icons.
  - In the slim view, each icon shows its name when you point at it.
- Approval modes
  - Choose how much helpers may do without asking you: Manual (everything asks), Auto edits,
    Auto or Full auto (below). Set it for the project on the Workflow page and in the new-project setup, and change it
    for one run when you start a ticket ("Start with options…").
  - Auto edits lets a helper edit files in its own copy of the project and run the project's
    exact harness checks. It is the default for new projects; existing projects keep how they
    worked.
  - Auto also runs the commands you list, matched word for word or with any arguments. Commands
    that could chain, redirect or leave the project are refused when you add them.
  - Requests approved this way show which rule allowed them.
- Full auto
  - A fourth approval mode for when you only want to see the final merge. The plan is approved
    automatically, and nothing asks you while the ticket runs.
  - Helpers work in Claude Code's own auto mode, where a second model reviews risky actions, and
    their commands run in your operating system's sandbox: they can write only in their own copy
    of the project and a temporary folder, and cannot read your SSH, cloud or GitHub credentials,
    the app's data or Claude Code's settings.
  - If auto mode or the sandbox is not available, the helper stops and says why; it never runs
    unprotected. Anything that would still need a decision is refused instead of waiting for you.
  - It can still make mistakes: you review everything once, when you merge the ticket branch.
- Run options for each ticket
  - Give one ticket its own approval mode, reviewer and rework rounds, for example Manual for a
    risky ticket in a Full auto project. Choose them in the New ticket dialog or later on the
    ticket page; each starts at "Project default".
  - An option left on "Project default" follows the project, also when you change the project
    later. A choice in "Start with options…" still applies to that one run only.
  - The board card shows a small badge when a ticket's options differ from the project's.
- Review before merge, with rework
  - Each helper's finished change is reviewed before it goes anywhere: by a read-only review
    agent (the default) or by the lead.
  - The lead then merges it, sends it back to the helper with what to change, discards it, or
    asks you. A change can go back twice by default; you can choose up to five rounds, and allow
    more yourself.
  - Each change has a card on the ticket page with its state, its checks, the reviewer's findings
    and every decision. When the lead asks you, the card offers your choices.
- One final merge of a ticket branch
  - Approving a plan creates a branch for the ticket. Every change the lead merges lands there,
    never on main, and only after its required checks pass.
  - At the end you see the combined change and its checks, and merge it into main once. You can
    also merge anyway with a reason, request changes from the lead, or discard the branch.

### Changed

- A new look
  - Warm ivory light theme, graphite dark theme and one lime accent.
  - Inter for text and JetBrains Mono for ids and numbers, bundled with the app, so nothing is
    loaded from the internet.
  - Clearer icons, thinner borders, and loading placeholders shaped like the page.
  - Short, subtle animations. They are turned off when your system asks for reduced motion.
- A slimmer top bar
  - It shows where you are: the project (with the project switcher), then the page.
  - Search (⌘K) and the theme switch stay on the right.
- Agent views
  - Agents are drawn as squares, the way the logo draws them, in the ticket page, the Workflow
    page and the session trees. The lead agent has a darker frame.
  - Lime marks only an agent that is working or selected. Warning and error colours appear only
    when something needs you or went wrong.
  - Passed checks show a green dot.
- Works on small screens
  - Every page fits a phone-sized window: page titles keep their width, and buttons move under
    the title instead of squeezing it.
  - Wide content, such as the board's columns and the agent tree, scrolls inside its own area.
- Keyboard use
  - Menus, tabs and dialogs work with the keyboard, and the item in focus always shows a clear
    outline in both themes.
  - Showing or hiding a board column keeps the keyboard focus on that column's button.
- Ticket runs
  - Helpers' changes go to the ticket's branch instead of being merged into main one by one, and
    you no longer review each change yourself unless the lead asks you (see Added).
  - Every step of a plan goes to a helper. The lead only reads and coordinates, so a plan step
    for the lead is refused, and the planner gives it to a helper instead.
  - An agent's "Latest" line says what it did in plain words, such as "Checked a helper's status",
    instead of internal tool names.

### Fixed

- The ticket page could miss a helper's changes when several updates arrived at once, so the
  Merge button did not appear until you reloaded the page.

## [0.0.1] - 2026-10-17

The first preview of Agent Control Plane. It is a local app that lets you see your Claude Code
sessions and run Claude agents on your project's tickets, with you approving each step. This is
an early version: features and data formats may change in any release before 1.0.0.

### Added

- Session monitoring for Claude Code
  - Sessions appear automatically, read-only from `~/.claude/projects`, and update live while you
    work.
  - Each session shows its subagents as a tree. Parent and child links come only from what Claude
    Code records.
  - Each session shows its status: active, idle, ended or stale.
  - Token usage counts each message once. Missing data shows as unavailable, never as zero.
  - Optional Claude Code hooks give faster live updates.
- Projects and a ticket board
  - Register a project folder and track work as tickets on a board.
  - Each ticket run starts with a plan. You approve it or ask for changes before any work begins.
  - A lead agent hands parts of the plan to up to 3 helper agents. Each helper works in its own
    copy of the project (a git worktree), so no agent ever edits your working folder.
  - You approve each edit and command an agent wants to make.
  - You review each helper's changes and merge or discard them. Nothing merges on its own.
  - Required checks, such as your tests or lint, must pass before a change can be merged.
  - Each agent has a token budget. Stop and Stop all are always available.
  - After the app restarts, interrupted work waits for you. It is never relaunched on its own.
- Workflow page
  - A graph shows how a ticket moves from plan to merge.
  - Optional stages:
    - a planner agent separate from the lead;
    - a read-only final code review after the merge, posted as ticket comments;
    - a unit-test writer.
  - Each stage can have its own model, project skill and agent file.
  - The ticket page shows a live view of where each run is in the workflow.
  - After a run has finished, you can ask its lead agent questions. It reads the project and
    answers, but cannot change anything.
- Skills and agent files
  - Create, edit and delete project skills (`.claude/skills/<name>/SKILL.md`) and agent files
    (`.claude/agents/<name>.md`) in the app, then commit them with one click.
  - A stage's agent file adds its instructions to that stage's agent. Its tool list can only narrow
    what the agent may use, never widen it.
  - A skill or agent file that a stage uses cannot be deleted until it is removed from that stage.
- Harness checks
  - Define the checks your project runs.
  - Run them on the main branch on demand, and see the history of past check runs.
- Token reports
  - Token usage per project, split into new work and cache reuse.
  - Breakdowns per day, session, ticket, agent role and model.
- Demo mode
  - `ACP_MODE=demo` runs the app on sample data in its own database, apart from your real data.

### Security

- Everything runs on your machine
  - The server listens on `127.0.0.1` only.
  - Requests that change data need a per-page token.
  - There is no telemetry.
- Managed agents run with strict limits
  - They ignore the repository's and your own Claude Code settings, so a repository cannot grant
    itself permissions or run hooks.
  - Each agent role gets only the tools it needs. The planner, lead and reviewer cannot edit files
    or run commands.
  - No role gets web access, messaging, scheduling or subagents.
- Your data stays private
  - Prompts, replies and tool output are not stored. The only exception is your chat with the
    lead agent.
  - Logs are redacted.
  - The app never reads Claude Code's session credential files, settings files or prompt history.

[Unreleased]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/keerthivibisan/agent-control-plane/releases/tag/v0.0.1
