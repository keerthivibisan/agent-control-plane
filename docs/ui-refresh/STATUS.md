# UI refresh — status

Coordinator-owned. Plan: [README.md](README.md). Integration branch `feature/ui-refresh` (from
`release/0.1.0`, from `main` at `ba280d9`). Work-package branches `wp/u-<id>-<slug>` come off
`feature/ui-refresh` and are merged back with `--ff-only` after review.

| WP  | Title                                                     | After   | Status      | Branch                 | Merged |
| --- | --------------------------------------------------------- | ------- | ----------- | ---------------------- | ------ |
| U-0 | Docs, dependencies, DESIGN.md v2 direction                | —       | **done**    | feature/ui-refresh     | —      |
| U-A | Foundation: tokens, fonts, icons, primitives, motion      | U-0     | todo        | —                      | —      |
| U-B | Shell: top bar, sidebar, switcher, palette                | U-A     | in-progress | wp/u-b-shell           | —      |
| U-C | Board                                                     | U-A     | in-progress | wp/u-c-board           | —      |
| U-D | Ticket page                                               | U-A     | in-progress | wp/u-d-ticket          | —      |
| U-E | Workflow, Skills & Agents                                 | U-A     | in-progress | wp/u-e-workflow-skills | —      |
| U-F | Tokens, Harness, Sessions, projects, settings, health     | U-A     | in-progress | wp/u-f-pages           | —      |
| U-V | Verification, contrast, bundle size, DESIGN.md, CHANGELOG | U-B…U-F | todo        | —                      | —      |

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
- 2026-10-17 U-A merged (`a4a554f`):
  - v2 tokens (light and dark), Geist fonts (latin woff2 only), lucide icons;
  - shared Tabs, Dialog, Menu, Popover, Segmented and Skeleton;
  - MotionConfig, test stubs, and 7 unused components removed.
  - Coordinator re-ran pnpm check (2,119 tests) and the e2e (49/49).
  - Bundle: JS +10 kB, CSS +6.5 kB, fonts +52 kB.
  - Tooltip/InfoTip stay hand-built (Radix Tooltip would change tap behaviour).
  - Waiting for the owner's design checkpoint before U-B…U-F.
- 2026-10-17 design checkpoint: the owner accepted the direction and asked for a **toggleable
  sidebar** ("it occupies more space"). It is in U-B: an icon rail toggled by a button or ⌘B/Ctrl+B,
  remembered per browser, auto-collapsed on narrow screens. U-B…U-F started in parallel.
