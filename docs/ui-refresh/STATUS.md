# UI refresh — status

Coordinator-owned. Plan: [README.md](README.md). Integration branch `feature/ui-refresh` (from
`release/0.1.0`, from `main` at `ba280d9`). Work-package branches `wp/u-<id>-<slug>` come off
`feature/ui-refresh` and are merged back with `--ff-only` after review.

| WP  | Title                                                     | After   | Status                         | Branch             | Merged |
| --- | --------------------------------------------------------- | ------- | ------------------------------ | ------------------ | ------ |
| U-0 | Docs, dependencies, DESIGN.md v2 direction                | —       | **done**                       | feature/ui-refresh | —      |
| U-A | Foundation: tokens, fonts, icons, primitives, motion      | U-0     | todo                           | —                  | —      |
| U-B | Shell: top bar, sidebar, switcher, palette                | U-A     | todo (after design checkpoint) | —                  | —      |
| U-C | Board                                                     | U-A     | todo (after design checkpoint) | —                  | —      |
| U-D | Ticket page                                               | U-A     | todo (after design checkpoint) | —                  | —      |
| U-E | Workflow, Skills & Agents                                 | U-A     | todo (after design checkpoint) | —                  | —      |
| U-F | Tokens, Harness, Sessions, projects, settings, health     | U-A     | todo (after design checkpoint) | —                  | —      |
| U-V | Verification, contrast, bundle size, DESIGN.md, CHANGELOG | U-B…U-F | todo                           | —                  | —      |

## Decisions (owner, 2026-10-17)

- **Look:** Linear/Vercel style. One accent, near-black dark mode, hairline borders.
- **Dependencies approved:** lucide-react, Geist fonts (fontsource), Radix UI primitives, Motion.
  Added in `f516686` with exact versions.
- **Branches:** `release/0.1.0` → `feature/ui-refresh` → `wp/u-*`.
- **CI:** runs by itself only on `main`. On these branches, start it from the Actions tab.

## Log

- 2026-10-17 U-0:
  - dependencies added (`f516686`);
  - a flaky harness-runner test made deterministic (`b1ee82d`);
  - docs (this commit).
