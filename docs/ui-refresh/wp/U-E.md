# U-E — Workflow, Skills & Agents

> Progress file for U-E. Only the agent working on U-E edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope, owned paths and rules: `docs/ui-refresh/README.md`.

| Field   | Value                    |
| ------- | ------------------------ |
| Status  | review                   |
| Owner   | U-E agent                |
| Branch  | `wp/u-e-workflow-skills` |
| Started | 2026-10-17               |
| Updated | 2026-10-17               |

## Scope

- Workflow page: graph canvas, node cards, legend, zoom controls, stage panel, agent-files card.
  The ticket page's live graph reuses the node views, so their props stay the same.
- Skills & Agents page: shared Tabs, lists, editors, Save/Commit/Delete, the shared Dialog for
  confirmations, git state badges, "Used by" chips.
- The skills feature's own `fieldClass` and tab bar replaced by the shared ones.

## Work log (append-only; newest last)

| Date       | What was done                                                       | Commit    | Checks                                |
| ---------- | ------------------------------------------------------------------- | --------- | ------------------------------------- |
| 2026-10-17 | Claimed U-E                                                         | `115a30f` | —                                     |
| 2026-10-17 | Workflow page: nodes, canvas, controls, legend, panel, agent files  | `48d7707` | web 497, e2e workflow 4/4             |
| 2026-10-17 | Skills & Agents: shared Tabs/Dialog/fields, FileCard, editors, side | `b194b36` | web 497, e2e workflow+skills 8/8      |
| 2026-10-17 | Stage panel animation from Motion to CSS (bundle)                   | `bb01fc8` | web 497, build                        |
| 2026-10-17 | Stage panel fade without movement (an e2e click raced the rise)     | `3bd5ace` | 2119/2119 (sequential), build, e2e 49 |

## Handoff notes

- **New file** `src/features/workflow/icons.tsx`: lucide icons for both pages (agent file `Bot`,
  read-only `Lock`, own copy `GitBranch`, one icon per role, merge, done, commit, delete, file,
  back, remove). Same wrapper as `components/icons.tsx` (decorative, 1.75 stroke). The skills
  feature imports it from `../workflow/icons`.
- **Node views** (`WorkflowNodes.tsx`) keep their exports, props, test ids and `data-*`
  attributes; the ticket page's `LiveWorkflow` wraps them unchanged and picks up the new look.
  Frames stay `rounded-card`, so U-D's state rings still match.
- **Glyphs:** the decorative `⚠` and `×` glyphs became the lucide alert and close/remove icons
  (they were `aria-hidden` or inside labelled controls, except the panel's warning callouts,
  whose sentence already says what is wrong). The back links lost their `←` glyph for an arrow
  icon, so their accessible name is now just "All skills"/"All agents" (tests use a regex).
  Copy text (`✦`, `↳`, every sentence) is unchanged.
- **Motion:** I used the `index.css` keyframes (`animate-fade-in`, `animate-dialog-in`) rather
  than `motion.*`. Importing `motion/react`'s `motion` component added about 133 kB raw (about
  44 kB gzip) to `index.js` for these few effects. If U-B brings `motion.*` in for page
  transitions, the cost is paid once and these could switch. The reduced-motion rule in
  `index.css` stops the CSS animations.
- The stage panel fades without moving: a rise-and-scale entrance made the e2e "everything on"
  test click a radio while it moved (failed 3 of 3 at 1280×720).
- **Not mine, still old-style inside the stage panel:** `TextField`, `CheckboxField` and
  `NumberChoice` come from `features/project-setup/fields.tsx` (U-F's paths). They will follow
  U-F's restyle; the number choice's active segment is still `bg-accent`.

## Blockers / proposed contract changes

_None._ No dependency, contract or shared-file change was needed.

## Completion report (AGENTS.md §9) — U-E

1. **Summary:** the Workflow page (graph nodes, dot-grid canvas, zoom toolbar, legend, stage
   panel, agent-files card) and the Skills & Agents page (shared Tabs, one card for skills and
   agents, editors on the shared field style, sticky side column, shared Dialog for the delete
   confirmation) redone in the v2 look with the U-A tokens and shared parts. No text, role,
   test id, `data-*` hook or behaviour changed; no test changed.
2. **Files changed (packages/web):**
   - created: `src/features/workflow/icons.tsx`, this file;
   - modified: `src/features/workflow/{WorkflowNodes,WorkflowGraph,WorkflowPage,StagePanel,
AgentFiles}.tsx`, `src/features/skills/{SkillsPage,SkillList,AgentList,SkillEditor,
AgentEditor,editor-parts,bits,markdown}.tsx`;
   - removed: the skills feature's own `fieldClass` (`bits.tsx`) and tab bar (`SkillsPage.tsx`);
     the skills page no longer imports `features/board/Dialog`.
3. **Commands and results:**
   - `pnpm check`: format ✓, lint ✓, typecheck ✓, build ✓; its parallel test step failed on 1–2
     server tests per run, always 5 s timeouts in git-heavy tests (`restart.test.ts`,
     `workspace/manager.test.ts`, `reference-usage.test.ts`; a different set each time), while
     five agents ran checks on this machine (load average 11–24). No server file is touched by
     this WP.
   - The same tests one package at a time (`pnpm -r --workspace-concurrency=1 run test`): 2,119/
     2,119 ✓ (core 249, adapter-claude-code 323, adapter-demo 12, db 168, orchestrator 451,
     web 497, server 419). `pnpm --filter @acp/server exec vitest run` on its own: 419/419.
   - `ACP_E2E_PORT=8651 ACP_E2E_CONTROL_PORT=8661 pnpm --filter @acp/web test:e2e`: 49/49 ✓
     (includes workspace.spec's R-R check: Done on screen, controls clear of it, Save visible).
     Workflow project repeated 3×: 12/12.
   - Bundle (`index.js`): 1,371 kB (gzip 404 kB) against 1,305 kB after U-A; the +66 kB is Radix
     Tabs and Dialog (first imported here; U-B/U-C/U-D use them too) and the lucide icons.
4. **Acceptance criteria:**
   - Workflow graph canvas, nodes, legend, zoom controls, stage panel, agent files restyled →
     met (screenshots; `.react-flow__*`, `edge-*`, node `data-*` kept; e2e 49/49);
   - R-R fit kept → met (workspace.spec checks pass; canvas sizing unchanged);
   - ticket page's live graph keeps working → met (ticket unit and e2e tests pass; node props
     unchanged);
   - Skills & Agents: shared Tabs with `role=tab`/`aria-selected`, lists, editors, actions,
     shared Dialog, git badges, "Used by", delete-in-use notice → met (unit 41/41 in the three
     suites, e2e skills 4/4);
   - skills `fieldClass` and tabs replaced by the shared ones → met;
   - native select/checkbox/radio/details kept → met;
   - subtle motion, reduced motion respected → met (CSS keyframes, stopped by the
     `prefers-reduced-motion` rule);
   - text unchanged, copy only from `lib/copy.ts` → met (no copy added; decorative glyphs noted
     above).
5. **Assumptions:** decorative `⚠`/`×`/`←` glyphs count as icons, not copy (handoff notes);
   CSS keyframes satisfy the README's motion rule (subtle, 150–200 ms, reduced motion off).
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:** the stage panel's `TextField`/`CheckboxField`/`NumberChoice`
   restyle belongs to U-F (`project-setup/fields.tsx`); `AgentEditor`'s `agent_in_use` sentence
   still lives in the component (its comment asks for `AGENTS_COPY.refusals`; left as is to avoid
   a shared copy edit); server tests time out under heavy parallel load (5 s default timeout).
8. **Next recommended task:** coordinator review and merge; U-V's full screenshot pass.
