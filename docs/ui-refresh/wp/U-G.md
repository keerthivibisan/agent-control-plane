# U-G — Brand: the Control Core identity

> Progress file for U-G. Only the agent working on U-G edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope: `docs/ui-refresh/brand-brief.md` (the owner's brief and
> decisions); rules: `docs/ui-refresh/README.md`.

| Field   | Value          |
| ------- | -------------- |
| Status  | review         |
| Owner   | U-G agent      |
| Branch  | `wp/u-g-brand` |
| Started | 2026-10-17     |
| Updated | 2026-10-17     |

## Work log (append-only; newest last)

| Date       | What was done                                                              | Commit    | Checks                                 |
| ---------- | -------------------------------------------------------------------------- | --------- | -------------------------------------- |
| 2026-10-17 | Claimed U-G from `feature/ui-refresh` `3577934`                            | `421a392` | —                                      |
| 2026-10-17 | Logo SVGs, favicon, BrandMark/BrandLogo, palette, contrast test, brand e2e | `95cede4` | pnpm check 2227/2227, e2e 18/18 subset |
| 2026-10-17 | Agent views: square nodes, lead framed, step edges, lime only for state    | `6ea2e0b` | same tree, e2e 23/23 subset            |
| 2026-10-17 | README logo and Brand section; DESIGN.md visual system and Agent views     | `d397b2a` | format ✓ build ✓                       |
| 2026-10-17 | Full pnpm check and e2e; status `review`                                   | this      | see the report below                   |

## Handoff notes

- **Logo construction.** Master mark on a 48 grid: nodes 8×8 at 3/37, centre 16×16 at 16,
  connectors 2.5 wide from node centres to the middle (drawn under the squares); the accent centre
  is lime framed by a 2.5 stroke in the mark's color. Small mark (favicon, and `BrandMark` below
  20px) on a 16 grid with integer coordinates: nodes 3×3 at 1/12, centre 6×6 at 5, 1px
  connectors. The generator is not in the repo; the SVGs are hand-readable and small.
- **Wordmark in the static logos** is live text (Inter, then Helvetica Neue, Helvetica, Arial;
  weight 600, 22px) with `textLength="323" lengthAdjust="spacing"`, so the lockup keeps its width
  with any fallback font. No font tooling was available offline to outline
  Inter (no fontTools/opentype in the workspace, and no downloads), so it is not converted to
  paths. If the owner wants paths, outlining it once in a font editor is the follow-up.
- **New token:** `--color-accent-fill-edge` (olive `#6f8a12` on ivory, lime on graphite): the
  outline that keeps a lime fill or selection ring a shape on ivory. Brand tokens
  `--color-brand-graphite/-ivory/-lime`. No token was renamed or removed.
- **`accent` changed meaning only in value:** it stays the text-safe accent (links, focus,
  selected text), now dark olive on ivory and lime on graphite. `accent-fill` is lime in both
  themes with graphite ink (it was blue with white ink).
- **Outside my paths, left for U-V:** `features/sessions/FamilyTree.tsx` (the sessions "Tree"
  view and the family tree inside agent cards) still has rounded cards and accent-coloured
  connectors; the ticket chat and comments use `accent-soft` bubbles (now a quiet olive-ivory, not
  lime). Both could follow the Agent views rules in DESIGN.md.
- `tests/design/contrast.test.ts` reads `index.css` from disk (`node:fs` with a `types="node"`
  reference), because Vitest replaces CSS imports, `?raw` included, with empty modules.

## Blockers / proposed contract changes

_None._ No dependency, `@acp/core`, shared-file or copy change.

## Completion report (AGENTS.md §9) — U-G

1. **Summary:** the Control Core identity: a custom SVG mark, logo and favicon (accent, on-dark
   and monochrome variants), a `BrandMark`/`BrandLogo` component in the top bar, the full
   ivory/graphite/lime palette on the existing token names (blue removed), AA contrast checked by
   a test, and the agent views (ticket canvas, live workflow, Workflow page, sessions graph,
   control tree) in the logo's vocabulary. Behaviour, data and text unchanged.
2. **Files changed:**
   - created: `packages/web/public/brand/{control-plane-mark,control-plane-mark-on-dark,control-plane-mark-mono-dark,control-plane-mark-mono-light,control-plane-logo,control-plane-logo-on-dark,control-plane-logo-mono-dark,control-plane-logo-mono-light,favicon}.svg`,
     the same nine in `docs/brand/`, `packages/web/tests/design/contrast.test.ts`;
   - modified: `packages/web/index.html`, `src/index.css`,
     `src/components/{BrandMark,Button,DemoBanner}.tsx`, `src/app/{TopBar,Sidebar}.tsx`,
     `src/features/ticket/{AgentCanvas,LiveWorkflow}.tsx`,
     `src/features/workflow/{WorkflowNodes,WorkflowGraph}.tsx`, `src/features/workflow/graph.ts`,
     `src/features/sessions/{SessionNodeView.tsx,graph.ts}`, `src/features/control/AgentTree.tsx`,
     `tests/components/primitives.test.tsx` (the BrandMark test reads markup instead of an inline
     style; same meaning), `e2e/shell.spec.ts` (add-only), `README.md`, `packages/web/DESIGN.md`,
     this file.
3. **Commands and results:** `pnpm check` exit 0: format ✓, lint ✓, typecheck ✓, tests
   2227/2227 (core 249, demo 12, orchestrator 451, claude-code 323, db 168, web 605, server 419),
   build ✓. e2e (`ACP_E2E_PORT=8851 ACP_E2E_CONTROL_PORT=8861`, screenshots on): 52/52.
4. **Acceptance:**
   - logo assets, favicon, docs copy → met (`public/brand`, `docs/brand`, `index.html`);
   - mark legible at 16/24 → met (16-grid construction for the favicon and in-app sizes below
     20px; rendered at 16/24/32/64 and checked zoomed);
   - React component with wordmark, accessible name rules, top bar and rail → met (unit tests,
     e2e `brand:` test);
   - palette with brand tokens, accessible pairs, no blue → met (contrast test, table below);
   - agent views → met (screenshots: ticket, workflow, sessions, control);
   - README and DESIGN.md → met; light/dark, 1440/1024 and 390px checked → met.
5. **Assumptions:** "remove the blue" means the accent; the chart series keep distinct hues
   (blue for input tokens among them), retuned for the warm surfaces. Start/Done terminals stay
   pills (they are not agents). Documented in DESIGN.md.
6. **Contract or shared-file changes:** none.
7. **Known gaps / follow-ups:** `features/sessions/FamilyTree.tsx` (outside U-G's paths) is still
   rounded with accent connectors; the static wordmark is live text, not outlined paths; the
   chat/comment bubbles use `accent-soft` (now a quiet olive tint).
8. **Next:** U-V (verification), including the FamilyTree follow-up.

### Contrast (WCAG 2.x; from `src/index.css`, asserted by `tests/design/contrast.test.ts`)

| Pair                                     | Min | Light       | Dark          |
| ---------------------------------------- | --- | ----------- | ------------- |
| `ink` on `canvas`                        | 4.5 | 15.77       | 15.77         |
| `ink` on `panel`                         | 4.5 | 17.05       | 14.83         |
| `ink` on `panel-raised`                  | 4.5 | 17.64       | 13.49         |
| `ink` on `sunken`                        | 4.5 | 14.41       | 16.48         |
| `ink` on `hover`                         | 4.5 | 15.08       | 12.97         |
| `ink` on `sidebar`                       | 4.5 | 14.96       | 16.35         |
| `ink` on `accent-soft`                   | 4.5 | 14.85       | 12.16         |
| `dim` on `canvas`                        | 4.5 | 6.23        | 7.05          |
| `dim` on `panel`                         | 4.5 | 6.73        | 6.63          |
| `dim` on `panel-raised`                  | 4.5 | 6.96        | 6.03          |
| `dim` on `sunken`                        | 4.5 | 5.69        | 7.37          |
| `dim` on `hover`                         | 4.5 | 5.95        | 5.80          |
| `dim` on `sidebar`                       | 4.5 | 5.91        | 7.30          |
| `accent` on `canvas`                     | 4.5 | 6.37        | 15.71         |
| `accent` on `panel`                      | 4.5 | 6.89        | 14.78         |
| `accent` on `panel-raised`               | 4.5 | 7.12        | 13.44         |
| `accent` on `sunken`                     | 4.5 | 5.82        | 16.42         |
| `accent` on `sidebar`                    | 4.5 | 6.04        | 16.29         |
| `accent` on `accent-soft`                | 4.5 | 6.00        | 12.11         |
| `accent-ink` on `accent`                 | 4.5 | 6.89        | 15.71         |
| `accent-fill-ink` on `accent-fill`       | 4.5 | 15.71       | 15.71         |
| `accent-fill-ink` on `accent-fill-hover` | 4.5 | 14.32       | 16.17         |
| `canvas` on `ink` (tooltip)              | 4.5 | 15.77       | 15.77         |
| `success` on `panel` / `canvas`          | 4.5 | 5.86 / 5.42 | 9.21 / 9.79   |
| `warning` on `panel` / `canvas`          | 4.5 | 5.71 / 5.28 | 9.50 / 10.11  |
| `warning` on `warning-soft`              | 4.5 | 5.28        | 8.73          |
| `danger` on `panel` / `canvas`           | 4.5 | 6.25 / 5.78 | 6.39 / 6.79   |
| `danger` on `danger-soft`                | 4.5 | 5.60        | 6.39          |
| `observed` on `panel`                    | 4.5 | 5.78        | 10.19         |
| `derived` on `panel`                     | 4.5 | 6.46        | 9.03          |
| `estimated` on `estimated-bg`            | 4.5 | 6.49        | 10.23         |
| `unavailable` on `panel` / `canvas`      | 4.5 | 5.77 / 5.34 | 6.10 / 6.49   |
| `accent-fill-edge` on `canvas` / `panel` | 3   | 3.47 / 3.75 | 15.71 / 14.78 |
| `status-active` on `panel`               | 3   | 4.18        | 9.21          |
| `status-idle` on `panel`                 | 3   | 3.76        | 9.50          |
| `status-stale` on `panel`                | 3   | 3.74        | 4.72          |
| `status-ended` on `panel`                | 3   | 8.24        | 9.70          |
| `token-input` on `panel`                 | 3   | 4.49        | 6.92          |
| `token-output` on `panel`                | 3   | 3.76        | 9.50          |
| `token-cache-write` on `panel`           | 3   | 4.67        | 7.17          |
| `token-cache-read` on `panel`            | 3   | 4.59        | 8.29          |

Signal lime on the ivory canvas is 1.0:1, which is why it is never text or a lone shape there.
