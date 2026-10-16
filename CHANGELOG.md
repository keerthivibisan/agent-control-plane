# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/keerthivibisan/agent-control-plane/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/keerthivibisan/agent-control-plane/releases/tag/v0.0.1
