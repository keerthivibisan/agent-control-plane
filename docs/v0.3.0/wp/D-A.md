# D-A

> Progress file for D-A. Only its agent edits it. Plan: [../README.md](../README.md) (part 3, the
> GitHub-like redesign); the binding rules are in [packages/web/DESIGN.md](../../../packages/web/DESIGN.md)
> (v3). Owner decision of 2026-10-22: "The code review should be like a code review in GitHub,
> side by side": GitHub's "Files changed", with comments on lines that go back as rework notes.

| Field  | Value                                              |
| ------ | -------------------------------------------------- |
| Status | in-progress                                        |
| Branch | `wp/d-a-review`, from `release/0.3.0` at `e71a5b4` |

## Tasks

- [ ] Routes `…/tickets/:ticketId/files` and `…/tickets/:ticketId/changes/:agentRunId`, href helpers.
- [ ] The Files changed page: sticky bar, file tree, file boxes with Viewed, context.
- [ ] Line comments as a pending review; Review changes with the choices the state allows.
- [ ] Entry points on the change card and the ticket branch card.
- [ ] Keyboard (`j`/`k`/`v`/`c`), focus, screen-reader labels.
- [ ] Tests (vitest, e2e), screenshots, docs.

## Log

- 2026-10-22 Started.
