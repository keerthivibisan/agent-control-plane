# G-C

> Progress file for G-C. Only its agent edits it. Plan: [../README.md](../README.md) (part 2,
> ADR-0025 §6).

| Field    | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Status   | in-progress                                                                            |
| Branch   | `wp/g-c-diff`, from `release/0.3.0` `de0a9fa`                                          |
| Worktree | `/Users/grootan/Desktop/agent-control-plane/.claude/worktrees/agent-a1bf99d61762f6ba9` |

## Tasks

- [ ] Parser: unified diff text into files and hunks (added, deleted, renamed, binary, "\ No
      newline at end of file", a diff cut by the server).
- [ ] Word-level changes inside changed line pairs.
- [ ] Layout: file list, per-file collapse, Collapse all / Expand all, hidden context with
      expanders, unified / side-by-side (remembered), line numbers.
- [ ] Shiki: lazy, bounded languages, themes from the design tokens, no network, plain fallback.
- [ ] Large-diff guard and the server's truncation notice.
- [ ] Accessibility: keyboard file list and toggles, focus, screen-reader line labels.
- [ ] Used in the change card and the ticket branch card.
- [ ] Tests (vitest, e2e with screenshots), bundle sizes, `pnpm check`, full web e2e.

## Work log

| Date       | What  | Commit | Checks |
| ---------- | ----- | ------ | ------ |
| 2026-10-22 | Claim | —      | —      |
