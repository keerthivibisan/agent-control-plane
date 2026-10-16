# ADR-0017: Project creation, the harness manifest, and running checks

- **Status:** accepted (project owner, 2026-10-13)
- **Date:** 2026-10-13
- **Amends:** ADR-0013 §1 ("only `git` and the SDK-spawned `claude` run")

## Context

The owner wants to create projects from the UI and give each project a **harness**: the code and
configuration that let AI agents check their own work (tests, lint, build), so changes are validated
before merge. Running a project's checks means running project code.

## Decision

1. **Project creation.** "Create a new repository" runs `git init -b main` and an initial commit
   inside an **existing absolute parent folder**, into a **new** folder name (letters, digits, `.`,
   `-`, `_`). Existing folders are never touched by creation. "Add an existing folder" works as
   before (realpath, must be a directory).
2. **Harness manifest.** A project's harness is declared in `.acp/harness.json` in the repository
   (`HarnessManifestSchema`, version 1): checks as **argv arrays** with timeouts and a `required` flag,
   optional context files and notes. It is versioned and reviewed like any code. Harness status
   (`none | invalid | partial | ready`) is read from the repository on demand. A "Build the harness"
   ticket template lets agents create it through the normal plan → approve → review flow.
3. **Check execution policy** (a third allowed process kind, after `git` and the SDK's `claude`):
   - `spawn(argv[0], argv.slice(1), { shell: false, detached: true })`, **no shell**; the process runs
     in its own process group so a timeout kills its child processes too (amended 2026-10-16; the
     first text said `execFile`, which cannot kill a check's children); `argv[0]` must be a bare command name
     (`^[a-z0-9][a-z0-9._-]*$`) resolved through `PATH` — never a path, never `sh -c`;
   - `cwd` is inside the agent's own worktree, or a temporary detached worktree of the main branch for
     "Run checks now" — never the owner's working tree;
   - per-check timeout (1–1800 s), kill on timeout; checks run one at a time;
   - environment filtered (no `ACP_*`, no `GIT_*`);
   - output: only the last 16 KiB, redacted, stored with the check run (`MAX_CHECK_OUTPUT_BYTES`).
     This is the project's tool output, not conversation content.
4. **Merge rule.** A failed required check blocks a plain merge; "Merge anyway" needs a typed reason
   and the owner's click. Nothing merges automatically.

## Consequences

Checks run project code with the owner's privileges, inside worktrees. Mitigations: the manifest is in
the reviewed repository; argv only; timeouts; filtered environment; visible output; owner merge only.
