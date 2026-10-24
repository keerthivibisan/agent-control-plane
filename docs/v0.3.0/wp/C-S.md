# C-S

> Progress file for C-S. Only its agent edits it. Plan: [../README.md](../README.md).

| Field    | Value                                          |
| -------- | ---------------------------------------------- |
| Status   | review                                         |
| Branch   | `wp/c-s-shell`, from `release/0.3.0` `fa25a35` |
| Worktree | `.claude/worktrees/agent-ab242c76fcc0fee55`    |

Owner request (2026-10-22): the shell bigger and clearer, the sidebar toggle on the sidebar
itself, and a header with the logo and "ACP" on the left, a wide centred search, and the project
switcher and theme on the right.

## Tasks

- [x] Sizes in the tokens (`index.css`): body 15/22px, caption 13/20, micro 12/16, title 17/24,
      section 22/30, page and stat 26/36; top bar 56px (`--spacing-topbar`, the shell's 48px
      override removed); sidebar 256px (`--spacing-sidebar`), rail 60px
      (`--spacing-sidebar-collapsed`); entries 36px with 18px icons and 15px labels.
- [x] The sidebar toggle: a 32px bordered chevron at the sidebar's top right (‹), centred over the
      icons in the rail (›), above the scrolling list; tooltip "Hide sidebar ⌘B" / "Show sidebar
      ⌘B" to the right; aria-label, `aria-controls`, `aria-expanded`, `aria-keyshortcuts`; test id
      `sidebar-toggle`. Removed from the header. ⌘B/Ctrl+B and `acp.sidebar` unchanged.
- [x] The header: left the mark (28px) and "ACP"; centre the search (320/448/544/640px from
      md/lg/xl/1440px, centred because the two sides are `flex-1 basis-0`; an icon button below
      md); right the breadcrumb trail (switcher, page) and the theme menu, both 36px.
- [x] DESIGN.md (layout diagram, top bar, sidebar and toggle, type sizes, brand).
- [x] Tests: `tests/app/sidebar.test.tsx`, `tests/components/primitives.test.tsx`, e2e
      `shell.spec.ts` (new C-S test).
- [x] Screenshots (1440 and 1024, 390 for phones, light and dark) in `.acp-data/c-s-shots/`.

## Decisions

- **Header link name:** stays "Agent Control Plane home" (the full name plus where it goes); the
  tooltip is "Agent Control Plane"; the visible "ACP" is `aria-hidden`.
- **The breadcrumb trail stays** on the right with the switcher (the page crumb after it), so no
  behaviour or copy is lost; it gives way first on narrow screens.
- **Toggle place:** top right of the sidebar in its own row, outside the scrolling list, rather
  than on the border edge: always visible, keyboard-friendly, never covers the content.
- **Controls keep their heights** (buttons and fields 32px, pills 20px); only type, the sidebar
  and the header grew. Arbitrary sizes inside graph nodes (`text-[0.6875rem]` and the like, owned
  by other WPs) were left as they are.
- **Search widths** go up with the screen so the right side keeps room for the switcher and the
  page crumb: 448px at 1024, 544px at 1280, 640px from 1440.

## Work log

| Date       | What                                                          | Commit    | Checks                                                                                                                |
| ---------- | ------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-10-22 | Sizes, the sidebar chevron toggle, the three-part header; doc | `790c36f` | typecheck (web) ✓; vitest 201/201 ✓ (app, primitives, palette, design); eslint, prettier ✓; e2e shell + pages 19/19 ✓ |

## Report

1. **Summary:** the shell is bigger (15px body, 56px header, 256px sidebar with 36px rows), the
   sidebar toggle is a chevron on the sidebar, and the header reads logo + "ACP" | centred search
   | switcher and theme.
2. **Files:** modified `packages/web/src/{index.css,app/Shell.tsx,app/TopBar.tsx,app/Sidebar.tsx,
app/ProjectSwitcher.tsx,components/BrandMark.tsx,lib/copy.ts}`, `packages/web/DESIGN.md`,
   `packages/web/tests/app/sidebar.test.tsx`, `packages/web/tests/components/primitives.test.tsx`,
   `packages/web/e2e/shell.spec.ts`; created this file.
3. **Checks (lean, owner rule):** `pnpm --filter @acp/web typecheck` ✓; vitest `tests/app`,
   `tests/components/primitives.test.tsx`, `tests/features/palette.test.tsx`, `tests/design`
   201/201 ✓; eslint and prettier on the changed files ✓; web build ✓; e2e
   `--project=shell --project=pages` (ports 7631/7641) 19/19 ✓. Full `pnpm check` and full e2e
   are the coordinator's.
4. **Acceptance:** sizes met (e2e measures 56px bar, 256px sidebar, 36px rows, 15px body);
   toggle on the sidebar with tooltip, label and test id, gone from the header (unit + e2e);
   header order, centred 480–640px search at 1440, icon-only search at 600px, no sideways scroll
   at 390 and 600px (e2e); dense views checked in screenshots (board, ticket, sessions table,
   every page at 390px in `pages.spec`).
5. **Assumptions:** the decisions above.
6. **Shared-file changes:** `copy.ts` gained `SHELL_FRAME_COPY.shortName` (add-only, the shell's
   own section).
7. **Gaps:** the diff viewer and the review pages were not re-shot (their e2e projects are not in
   the lean set); their code text is `text-caption` (now 13px mono on a 20px line).
8. **Next:** the coordinator's full check and e2e, then merge into `release/0.3.0`.
