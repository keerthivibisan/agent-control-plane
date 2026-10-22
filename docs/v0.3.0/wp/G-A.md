# G-A

> Progress file for G-A. Only its agent edits it. Plan: [../README.md](../README.md) (Part 2),
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md).

| Field  | Value                                               |
| ------ | --------------------------------------------------- |
| Status | in-progress                                         |
| Branch | `wp/g-a-server` (from `release/0.3.0` at `de0a9fa`) |

## Tasks

- [x] Migration 0008: `tickets.branch_prefs`; `ticket_branches` rebuilt without the `acp/*`
      check; the pull request columns. Migration and repository tests.
- [x] Repositories: `ticketBranchPrefs` (create, read, patch, clear); the ticket branch's pull
      request; the strategy round-trips in the setup JSON.
- [x] Branch naming and creation from the target at plan approval; refusal before the run starts.
- [x] The guard replacing `LEGACY_TICKET_BRANCH`.
- [x] The final merge into the target.
- [ ] The `CodeHost` service (`gh`): status, push, create or link, view; error codes.
- [ ] Endpoints: code host status, open pull request, refresh.
- [ ] Docs: `security.md`, `architecture.md`.
- [ ] Full web e2e.

## Work log

| Date | What | Commit | Checks |
| ---- | ---- | ------ | ------ |
