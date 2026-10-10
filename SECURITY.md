# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub's
**Security → Report a vulnerability** (private advisory) on this repository. Include the affected
version or commit, reproduction steps, and the impact. We aim to acknowledge reports within 5 working
days.

Until the repository is published, report to the project maintainers directly.

## Supported versions

Pre-1.0: only the latest `main` receives fixes.

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
- **What is stored.** Ids, tool names, agent types, models, timestamps, and token counts. In Phase 1
  **no prompt, response, thinking, or tool input/output text is stored.** Session titles and subagent
  descriptions are redacted for secrets and length-capped.
- **Your configuration.** The app never modifies Claude Code settings. Optional hook integration is a
  snippet you install yourself.
- **Logs.** Logs are structured and contain no payloads or file contents. Free text is redacted
  (API keys, tokens, private keys, auth headers).

## Secret management for contributors

- Never commit `.env` files, tokens, real transcripts, or unsanitized fixtures. `.gitignore` blocks
  common cases. Reviewers check fixtures against `test-fixtures/claude-code/README.md`.
- The hook token is generated locally (`~/.agent-control-plane/hook-token`, mode 0600) and never
  logged.

The detailed threat model and rules are in [docs/security.md](docs/security.md).
