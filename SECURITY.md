# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub's
**Security → Report a vulnerability** (private advisory) on this repository. Include the affected
version or commit, reproduction steps, and the impact. We aim to acknowledge reports within 5 working
days.

Especially welcome: ways for an agent to move a branch, reach the network, escape its worktree or
the sandbox, read files outside the allowlist, or get text into a shell. The
[adversarial suite](docs/testing/adversarial.md) shows what is already covered.

## Supported versions

Pre-1.0: only the latest release and `main` receive fixes.

## How this project handles your data

Agent Control Plane reads AI coding-agent data **on your machine** and keeps it there.

- **Local only.**
  - The server listens on `127.0.0.1`.
  - There are no uploads, telemetry, or update checks.
  - Data is stored in `~/.agent-control-plane/` (directory mode 0700).
- **What is read.** Only allowlisted Claude Code files are read:
  - transcripts in `~/.claude/projects/<dir>/<uuid>.jsonl`;
  - subagent transcripts and metadata under `<uuid>/subagents/`.

  Only sessions inside project roots you register are read.

- **What is never read:**
  - `~/.claude/sessions/` (peer tokens and keys);
  - `*.key` files;
  - settings files;
  - `history.jsonl`;
  - memory files;
  - anything outside the allowlist.
- **What is stored.** Ids, tool names, agent types, models, timestamps, and token counts. **No
  prompt, response, thinking, or tool input/output text from your Claude Code sessions is stored.**
  Session titles and subagent descriptions are redacted for secrets and length-capped. The
  exceptions are texts you exchange in the app itself: your chat with a run's lead, plans, review
  findings, agent notes, run summaries and the files you attach to tickets.
- **Agent runs.** Agents work in their own git worktrees under the app's data folder, never in your
  working folder. Helpers and testers cannot manage branches; nothing reaches your target branch or
  a remote without your click. The app runs `git`, `gh`, Claude Code and your harness checks as
  argument lists, never through a shell. Network use beyond Claude Code's own is limited to your
  `origin` and GitHub through your `gh` login, on your click.
- **Your configuration.** The app never modifies Claude Code settings. Optional hook integration is a
  snippet you install yourself. The app writes `.claude/skills/` and `.claude/agents/` files in a
  project only when you save them on the Skills & Agents page.
- **Logs.** Logs are structured and contain no payloads or file contents. Free text is redacted
  (API keys, tokens, private keys, auth headers).

## Secret management for contributors

- Never commit `.env` files, tokens, real transcripts, or unsanitized fixtures. `.gitignore` blocks
  common cases. Reviewers check fixtures against `test-fixtures/claude-code/README.md`.
- The hook token is generated locally (`~/.agent-control-plane/hook-token`, mode 0600) and never
  logged.

The detailed threat model and rules are in [docs/security.md](docs/security.md).
