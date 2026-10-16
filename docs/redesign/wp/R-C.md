# R-C — Engine: planner, reviewer, tester stages

> Progress file for R-C. Only the agent working on R-C edits it (coordinator: `docs/redesign/STATUS.md`).
> Protocol: `docs/phase-4/README.md` §9 with redesign paths. Scope, owned paths and dependencies:
> `docs/redesign/README.md` §7.

| Field   | Value                                             |
| ------- | ------------------------------------------------- |
| Status  | in-progress                                       |
| Owner   | engine agent                                      |
| Branch  | `wp/r-c-engine`                                   |
| Started | 2026-10-16                                        |
| Updated | 2026-10-16 (paused)                               |

## Work log (append-only; newest last)

| Date | What was done | Commit | Checks |
| ---- | ------------- | ------ | ------ |
| 2026-10-16 | Claimed R-C on `wp/r-c-engine` from `main` (eb458d6). | claim | — |
| 2026-10-16 | WIP engine: workflow snapshot, agent stages, separate planner, reviewer/tester stages, post_review, continueStages, controlToolsFor, prompts. Paused by owner. | fb73268 | typecheck ✗; orchestrator tests 366/366 ✓ (existing) |

## Handoff notes

### Paused (2026-10-16)

Owner paused all agents. Branch `wp/r-c-engine`, WIP commit `fb73268` (not checked). Status stays
`in-progress`. Continue on this branch; do not restart.

**Done (in `packages/orchestrator/src`, uncommitted-to-green):**

- `state.ts`: `RunState.workflow` (snapshot), `leadBrief` (separate mode, until the lead starts),
  `stagesHeld` (set after a restart); `EngineAgent.stage`, `reviewPosts`; effects
  `create-review-checkout`, `remove-review-checkout`, `review-comment`; optional `model` on
  `start-agent`.
- `stages.ts` (new): role→stage map, `planningAgent`, `nextStage` (code-review then unit-tests,
  only when a helper's change was merged), skill lines (`Use the project skill \`<name>\`.`),
  stage models, reviewer and tester briefs. `plan-read.ts` (new): `pendingPlan`/`approvedPlan`
  moved here to avoid an import cycle.
- `draft.ts`: `planner()`, `planningAgent()`, `liveNonLeadDeepestFirst()` (Stop all covers every
  role), tester gets `review: pending`, reconcile: separate-mode PLANNING fails if planner or the
  QUEUED lead ends; REVIEW starts the next post-merge stage (run stays REVIEW; the lead is stopped)
  or completes; `startStage`, `flushCheckoutRemovals` (called in `applyCommand`).
- `commands.ts`: `createRun` takes `workflow` (validated, ticket runs only) and
  `ticket.plannerPrompt` (separate mode); owner chat goes to the planner while planning; planner
  text is chat (role `lead`); `requestPermission` refuses planner/reviewer, allows the tester in
  REVIEW, allowlist covers the tester; restart sets `stagesHeld`; new `continueStages`.
- `plan.ts`: planner submits/revises in separate mode, lead refused; approval stops the planner
  and starts the lead with brief + approved plan; `ticketPlannerPrompt`,
  `ticketOrchestratorPrompt`, `ticketRunPrompts`.
- `review-tool.ts` (new): `post_review` schema and `postReview` (redacted, capped 8000 chars,
  max 5 posts). `lead-tools.ts`: role-scoped tool checks, `post_review` routing, `controlToolsFor`.

**Left (exact next steps):**

1. Fix typecheck: `exactOptionalPropertyTypes` — change the `Pick<RunState, 'workflow'>` params in
   `stages.ts` (`isSeparatePlanner`, `planningAgent`, `nextStage`) to
   `{ readonly workflow?: ProjectWorkflow | undefined }`-style types; `plan.ts:182` `lead`
   possibly undefined (narrow with the `separate && lead !== undefined` check already above).
2. `policy.ts`: `mayStartHelpers` only for `lead`/`worker`; `checkStartAgent` counts
   `countsAsHelper` kinds; `checkReviewAction` accepts the tester (`hasReviewableChange`).
3. `index.ts`: export `continueStages`, `controlToolsFor`, `POST_REVIEW_TOOL`,
   `PostReviewInputSchema`, `ticketPlannerPrompt`, `ticketOrchestratorPrompt`, `ticketRunPrompts`,
   stage helpers.
4. New `run-workflow.ts`: pure `deriveRunWorkflow(state, workflow?)` → `RunWorkflowDto`
   (validate with `RunWorkflowDtoSchema` in tests); rules sketched in the stage design (off /
   waiting / active / needs-you / done / failed / skipped; lead covers plan in lead mode).
5. Tests: default-workflow equivalence, separate planner end to end, code-review alone,
   unit-tests alone, both, Stop/Stop all in each stage, restart + `continueStages`, refusals.
6. Adapter (`adapters/claude-code/src/managed/**`): role toolsets keyed on `AgentRoleKind`
   (planner read-only + submit_plan, input kept open; reviewer read-only via `disallowedTools`,
   input closed; tester = worker). Planner/reviewer specs and the `post_review` MCP tool are
   **blocked** on the contract change below.
7. README of the orchestrator, `pnpm check`, completion report, status `review`.

**Open problems / decisions recorded:**

- `RUN_TRANSITIONS` is pinned by an existing test, so post-merge stages run while the run stays
  `REVIEW` (no REVIEW → RUNNING edge).
- No new refusal codes (the server's `REFUSAL_STATUS` is exhaustive); existing codes are reused.
- Whether Claude Code loads project skills with `settingSources: []` is unverified (R-V).

## Blockers / proposed contract changes

Adapter part blocked (not made; for the coordinator):

- `packages/core/src/adapters/managed.ts`: `ManagedAgentSpec.kind: 'lead' | 'worker'` →
  `kind: AgentRoleKind`, so the adapter can give the planner, reviewer and tester their toolsets;
  optionally `controlTools?: readonly string[]` from the engine's `controlToolsFor`.
- `packages/core/src/orchestration/orchestration.ts`: add
  `post_review: z.object({ findings: z.string().trim().min(1).max(32000) })` to `LeadToolInputs`
  (then move it out of `orchestrator/src/review-tool.ts` and add `case 'post_review'` in
  `leadToolCall`).
- Optional: `ChatMessageDto.role` gains `planner`, so planner chat is not labelled `lead`.

## Completion report (AGENTS.md §9)

_Written when the WP moves to `review`._
