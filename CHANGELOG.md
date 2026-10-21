# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Your own workflow for each project. Draw which agents work on a ticket and how they review each
other's changes, give each helper its own approval mode, and follow the run on a live graph. Your
current workflow is converted for you when the app starts, and nothing in your data changes
shape. Until you save a workflow or start a ticket on 0.2.0 you can still go back to 0.1.0; after
that, going back is not supported, because 0.1.0 cannot read the new workflows and runs.

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

[Unreleased]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/keerthivibisan/agent-control-plane/releases/tag/v0.0.1
