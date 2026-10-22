# G-C

> Progress file for G-C. Only its agent edits it. Plan: [../README.md](../README.md) (part 2,
> ADR-0025 §6).

| Field    | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Status   | review                                                                                 |
| Branch   | `wp/g-c-diff`, from `release/0.3.0` `de0a9fa`                                          |
| Worktree | `/Users/grootan/Desktop/agent-control-plane/.claude/worktrees/agent-a1bf99d61762f6ba9` |

## Tasks

- [x] Parser (`components/diff/parse.ts`): unified diff text into files and hunks, read by the
      hunk header counts; added, deleted, renamed, copied, binary and mode-only files, quoted
      and spaced paths, "\ No newline at end of file", CRLF, and a diff cut by the server.
- [x] Word-level changes inside changed line pairs (`word-diff.ts`).
- [x] Layout: file list (status icon, +/−, jumps to the file), per-file collapse, Collapse all /
      Expand all, unchanged runs folded beyond 3 lines with "Show N hidden lines", Unified /
      Side by side remembered in `acp.diff.view` (guarded), line numbers.
- [x] Shiki: dynamic imports only, 21 bundled grammars, the CSS-variables theme with colors from
      the design tokens per theme (`diff.css`), no network, plain fallback.
- [x] Large-diff guard and the server's truncation notice, the cut file and the files after it.
- [x] Accessibility: one-tab-stop file list (↑/↓/Home/End, Enter), `aria-expanded` file toggles,
      `aria-pressed` view toggle, focus moves to the file after a jump, "Added line" / "Removed
      line" for screen readers, table headers for the line-number columns.
- [x] Used in the change card and the ticket branch card (`DiffSection`).
- [x] Tests (vitest, e2e with screenshots), bundle sizes, `pnpm check`, full web e2e.

## Decisions

- **Where the copy lives:** `components/diff/copy.ts` (`DIFF_COPY`), with the shared component,
  not a feature section of `lib/copy.ts`, which G-B also edits in parallel.
- **Theme:** Shiki's CSS-variables theme. Token colors are `var(--shiki-…)`; `diff.css` defines
  them for light and `.dark`, so switching the app theme needs no new highlighting. Colors are
  chosen from the palette and checked at 4.5:1 on every line background, word tint and gutter
  in both themes (`tests/components/diff/contrast.test.ts`), which also checks that every
  variable the Shiki theme uses is defined.
- **Engine:** Shiki's JavaScript regex engine (`forgiving: true`): no WASM, nothing fetched.
- **Lazy loading:** `DiffSection` draws the viewer only once its disclosure is opened, and a file
  is highlighted only when it is drawn (open and not held back). Shiki's core, engine and each
  grammar are separate chunks under `/assets`, each behind a literal `import()`.
- **Highlighting a diff:** the old side (context + removed) and the new side (context + added)
  are highlighted separately, each as one string, so most constructs color correctly; a
  construct cut by a gap between hunks can be colored as if it continued (cosmetic).
- **Folding:** git sends 3 lines of context, so with the server's current diffs a fold appears
  only when a hunk holds a longer unchanged run (as `-U<n>` would print). The lines between
  hunks are not in the diff, so the viewer cannot show them; it shows each hunk's header.
  A fold hides at least 2 lines.
- **Large-diff guard:** a file over 400 diff lines waits for "Show this file"; files are drawn
  in order until 1,500 lines, then the rest wait. Files without lines (binary, rename only) are
  always drawn. Files over 3,000 lines are not highlighted.
- **Word marks:** a removed block is paired with the added block after it, line by line; marks
  only when at least 30% of the longer line is unchanged, and at most 40,000 token pairs.
- **Side by side:** a 36rem minimum width, so in the narrow side panel it scrolls sideways
  rather than wrapping every word; unified wraps long lines.
- **Test ids:** `branch-diff` kept on the ticket branch's disclosure; `change-diff` added on the
  change card's; the viewer is `diff-viewer` and `diff-truncated` is kept for the cut notice.

## Bundle (vite build of `@acp/web`)

| Chunk                         | Before (`de0a9fa`)   | After                                         |
| ----------------------------- | -------------------- | --------------------------------------------- |
| main `index-*.js`             | 1,765.84 kB (521.61) | 1,798.88 kB (531.81 gzip)                     |
| `index-*.css`                 | 103.88 kB (17.68)    | 106.86 kB (18.39 gzip)                        |
| Shiki `core-*.js`             | —                    | 112.45 kB (35.96 gzip), on demand             |
| `engine-javascript-*.js`      | —                    | 57.98 kB (20.32 gzip), on demand              |
| grammars (21 + `xml`, shared) | —                    | 2.8 kB (json) to 797 kB (cpp), each on demand |

The main chunk holds only the viewer and the loader (no Shiki code: no `vscode-textmate`, no
grammar text). No built chunk contains `fetch(`, `WebAssembly` or a CDN URL; the e2e checks
that every request stays on the app's origin and that the engine and the TypeScript grammar
come from `/assets/` only after a diff is opened.

## Work log

| Date       | What                                                         | Commit    | Checks                                                                                 |
| ---------- | ------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------- |
| 2026-10-22 | Claim                                                        | `f6a27f4` | docs only                                                                              |
| 2026-10-22 | The shared viewer, its tests                                 | `6f4ec65` | format ✓ lint ✓ typecheck ✓ web 885/885 ✓ build ✓                                      |
| 2026-10-22 | Used in the change and ticket branch cards; e2e; screenshots | `5a02bc8` | as above; e2e diff-viewer 2/2 ✓                                                        |
| 2026-10-22 | DESIGN.md and this file                                      | (this)    | full check: format ✓ lint ✓ typecheck ✓ test 4793/4793 ✓ build ✓; full web e2e 78/78 ✓ |

## Screenshots

Under the worktree's `.acp-data/screenshots/g-c/` (git-ignored): `diff-change-unified-*`,
`diff-change-split-*` (the change card in the side panel) and `diff-branch-*` (the ticket
branch card), each at 1440 and 390 pixels, light and dark.

## Follow-ups (outside G-C's paths)

- The control panel's `ReviewPanel` and the ticket's `ChangesTab` still use the old `DiffView`
  (`features/control/ReviewPanel.tsx`); switching them to `DiffSection` is a two-line change
  each, plus `control.test.tsx`/`control.spec.ts`, which read the old `diff` test id.
- If the server sent more context (`git diff -U<n>`), the folds would let the owner open the
  unchanged lines between changes; today git's 3 lines leave nothing to fold.
