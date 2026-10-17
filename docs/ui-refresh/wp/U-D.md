# U-D — Ticket page

> Progress file for U-D. Only the agent working on U-D edits it (coordinator:
> `docs/ui-refresh/STATUS.md`). Scope, owned paths and rules: `docs/ui-refresh/README.md`.

| Field   | Value           |
| ------- | --------------- |
| Status  | review          |
| Owner   | U-D agent       |
| Branch  | `wp/u-d-ticket` |
| Started | 2026-10-17      |
| Updated | 2026-10-17      |

## Work log (append-only; newest last)

| Date       | What was done                                                                | Commit    | Checks                                 |
| ---------- | ---------------------------------------------------------------------------- | --------- | -------------------------------------- |
| 2026-10-17 | Claimed U-D                                                                  | `96e6780` | —                                      |
| 2026-10-17 | Ticket page on v2 tokens, shared Tabs/Badge/fields/buttons, motion, skeleton | `dcf72b5` | pnpm check 2121/2121, e2e ticket 11/11 |
| 2026-10-17 | Full e2e on the branch                                                       | —         | e2e 49/49 (ports 8551/8561)            |

## Notes for other WPs

- **U-E (workflow nodes):** the live graph reuses `AgentNodeView`, `GateNodeView`,
  `HelpersNodeView`, `ReviewNodeView` and `TerminalNodeView` from `src/features/workflow/`
  unchanged. The ticket wraps them in `LiveFrame` (in `LiveWorkflow.tsx`): a 1.5px state outline
  2px outside the node plus a 6px soft halo of the same hue (`accent` working, `warning` needs
  you, `danger` failed, `success` for the lit Done), a state Pill on an opaque `bg-panel` chip at
  the top right, waiting/skipped nodes at 60% opacity, and a dotted `Background` (18px gap). If U-E
  changes the node radius (`rounded-card`) or the node frame, the outline follows the wrapper's
  `rounded-card`; keep that radius, or tell U-D's reviewer.
- **U-F (control):** the ticket page still shows these control parts as they are, and they would
  benefit from the v2 pass: `Approvals` (the approvals banner and the Approvals tab),
  `BudgetBar` in `AgentTree.tsx` (in a 12rem agent card its "N of M budget tokens" wraps to two
  lines; a stacked label/value layout would read better), and `ConfirmAction` in `bits.tsx`
  (its confirm button is a hand-rolled `bg-accent text-accent-ink` button; it should use
  `buttonClass('primary')`, and `dangerButtonClass` could become `buttonClass('danger')`).
  `Chat.tsx` (owned here for styling) keeps its props and behaviour for the control panel.

## Blockers / proposed contract changes

_None._ No dependency, contract or shared-file change was needed.

## Completion report (AGENTS.md §9) — U-D

1. **Summary:** the Ticket page redone in the v2 Linear/Vercel style on the U-A tokens and shared
   parts: header with badges, live workflow wrappers, agent cards, side panel on the shared Radix
   Tabs, chat, plan review, ticket info, changes and checks; subtle motion and a page-shaped
   loading skeleton. Behaviour, data, copy, roles, names, test ids and app `data-*` unchanged.
2. **Files changed (packages/web):**
   - modified: `src/features/ticket/{TicketPage,AgentCanvas,SidePanel,LiveWorkflow,PlanReview,TicketInfo,ChangesTab,ChecksTab}.tsx`,
     `src/features/control/Chat.tsx` (styling and the arrival motion only),
     `tests/features/ticket.test.tsx`;
   - created: this file.
3. **Commands and results:** `pnpm check` from the root: format ✓, lint ✓, typecheck ✓,
   test 2121/2121 ✓ (web 499, server 419, orchestrator 451, adapter-claude-code 323, core 249,
   db 168, adapter-demo 12), build ✓. `ACP_E2E_PORT=8551 ACP_E2E_CONTROL_PORT=8561 pnpm --filter
@acp/web test:e2e`: 49/49 passed (ticket 11/11). Screenshots (light/dark, 1440/1024) in the
   session scratchpad `u-d-shots/`.
4. **Acceptance criteria:**
   - header: mono key + title, stage/type/priority/labels as badges, native run picker restyled,
     Re-run / Stop all / Open board as shared buttons → met;
   - live workflow on v2 tokens, `.react-flow__*` hooks and `data-state`/`data-stage` kept,
     `src/features/workflow/**` untouched → met (notes for U-E above);
   - approvals banner, agent canvas (status, budget, latest, message, Stop),
     `.overflow-x-auto` inside `agent-canvas`, `data-testid`s → met (the banner's own styling is
     U-F's `Approvals`);
   - side panel on the shared Tabs with `role=tab`/`aria-selected` → met (no app `data-*` on a
     Radix part);
   - chat follow-up tag/divider and notices, plan review, ticket info → met;
   - hand-rolled `bg-accent` send button → `buttonClass('primary')`; local `fieldClass` → shared
     `fieldClass`/`inputClass`; motion for the side panel and new chat messages (reduced motion
     via `MotionProvider`); skeletons while loading → met;
   - text unchanged → met, with one exception to review: the decorative, `aria-hidden` "·"
     between the type and the priority in the header is gone, because both are now separate tags.
5. **Assumptions:** the tab bar uses 13px text and a 12px gap so all six tabs fit the 25rem panel
   without a sideways scroll (`gap-3!` overrides the shared TabList gap); the side panel sticks at
   top bar height + 1.25rem (it used to slide under the sticky top bar); chat messages already
   there when the chat opens don't animate, later ones rise in.
6. **Contract or shared-file changes needed:** none.
7. **Known gaps / follow-ups:** the U-F items above (`Approvals`, `BudgetBar`, `ConfirmAction`);
   the full-width Stop button on agent cards comes from `ConfirmAction`.
8. **Next recommended task:** coordinator review and merge; U-E and U-F can take the notes above.
