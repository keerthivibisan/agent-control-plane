# UI refresh — status

Coordinator-owned. Plan: [README.md](README.md). Integration branch `feature/ui-refresh` (from
`release/0.1.0`, from `main` at `ba280d9`). Work-package branches `wp/u-<id>-<slug>` come off
`feature/ui-refresh` and are merged back with `--ff-only` after review.

| WP  | Title                                                                     | After   | Status   | Branch                 | Merged    |
| --- | ------------------------------------------------------------------------- | ------- | -------- | ---------------------- | --------- |
| U-0 | Docs, dependencies, DESIGN.md v2 direction                                | —       | **done** | feature/ui-refresh     | —         |
| U-A | Foundation: tokens, fonts, icons, primitives, motion                      | U-0     | **done** | wp/u-a-foundation      | `a4a554f` |
| U-B | Shell: top bar, sidebar, switcher, palette                                | U-A     | **done** | wp/u-b-shell           | `7a253f1` |
| U-C | Board                                                                     | U-A     | **done** | wp/u-c-board           | `4dd57b9` |
| U-D | Ticket page                                                               | U-A     | **done** | wp/u-d-ticket          | `c1a0a98` |
| U-E | Workflow, Skills & Agents                                                 | U-A     | **done** | wp/u-e-workflow-skills | `405ea57` |
| U-F | Tokens, Harness, Sessions, projects, settings, health                     | U-A     | **done** | wp/u-f-pages           | `c7e80a7` |
| U-G | Brand: Control Core logo, ivory/graphite/lime palette, square agent nodes | U-B…U-F | **done** | wp/u-g-brand           | `b4a38a9` |
| U-V | Verification, contrast, bundle size, DESIGN.md, CHANGELOG                 | U-B…U-F | todo     | —                      | —         |

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
- 2026-10-17 U-D (ticket page) merged (`c1a0a98`). Scope OK (ticket, `control/Chat.tsx` styling).
  - Coordinator check: 2 server tests and the control e2e timed out under load (load average ~23,
    with four agents building); all passed when re-run alone. Web 499/499.
  - Handed to U-F: `Approvals`, `BudgetBar` and `ConfirmAction` (control) still need the v2 pass.
- 2026-10-17 U-F, U-B, U-C and U-E merged.
  - U-B, U-C and U-E were cherry-picked onto the latest `feature/ui-refresh`. The only conflict
    was the add-only `copy.ts` sections, and both were kept.
  - Final combined check: 2,130 tests and e2e 51/51.
  - Load-related timeouts during the parallel builds all passed when re-run alone.
- 2026-10-17 **accent changed to a Jira/YouTrack-like blue** (owner: "I don't like this violet")
  in `1067b89`; AA contrast checked.
- Follow-ups for U-V:
  - harden the `shell.spec` sidebar test's mocked-route race ("Response has been disposed");
  - delete the now-unused `features/board/Dialog.tsx`;
  - add a `loop` prop to the shared Menu;
  - add a link variant to the shared Tabs (Data health);
  - make the shared Dialog give focus back only when focus is still inside it;
  - move `agent_in_use` into `copy.ts`;
  - fix the `components/icons.tsx` comment;
  - update the DESIGN.md Layout section;
  - review the Motion bundle size (U-E used CSS keyframes instead).
- 2026-10-17 live check started (`pnpm dev` on `feature/ui-refresh`, live mode, the owner's data).
  Found at a 334 px viewport: the page header keeps the title and its actions in one row, so
  "All projects" wraps letter by letter. **U-V:** stack PageHeader actions under the title below
  `sm`, and add a narrow-width (e.g. 390 px) screenshot and e2e pass.
- 2026-10-17 the owner checked the live app and said "everything is okay".
- 2026-10-17 the owner asked for a real logo, and gave a brand brief (`brand-brief.md`).
  - Decisions: full ivory/graphite/lime palette (replaces the blue), the name stays "Agent Control
    Plane", Inter + JetBrains Mono (swapped in `1f2065f`), square agent nodes.
  - New WP **U-G (brand)** runs before U-V.
- 2026-10-17 **U-G (brand) merged** (`b4a38a9`).
  - The Control Core mark and logo variants live in `packages/web/public/brand/` and `docs/brand/`
    (clean SVGs, no scripts or external references), with an adaptive favicon.
  - Ivory/graphite/lime palette, contrast test with 92 pairs, square agent nodes, README brand
    section.
  - Coordinator: pnpm check 2,227/2,227; e2e 50/52.
- **Two e2e tests are flaky since the U-B shell** (1 in 3 runs at low load, so not only load):
  - the `shell.spec` sidebar test ("Response has been disposed", a mocked-route race on reload);
  - `workspace.spec`'s owner flow (waiting for the side panel's Merge button).

  U-V fixes both first.

- Also for U-V (from U-G): `sessions/FamilyTree.tsx` still has rounded cards and accent connectors;
  chat and comment bubbles use the olive `accent-soft`.
