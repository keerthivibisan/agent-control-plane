# H-A

> Progress file for H-A. Only its agent edits it. Plan: [../README.md](../README.md) (part 5, the
> harness in the workflow). Decision: [ADR-0027](../../decisions/0027-harness-setup-and-check-blocks.md)
> §5. Contracts from H-0 (`42bfbab`).

| Field  | Value                                            |
| ------ | ------------------------------------------------ |
| Status | review                                           |
| Branch | `wp/h-a-core`, from `release/0.3.0` at `6111ccd` |

## What changed

Pure core logic for configurable Checks blocks (`packages/core`):

- **Defaults** (`workspace/graph/check-blocks.ts`): `checkBlockOf(node)` fills a `checks` node's
  absent fields: place `merge`, select `{ kind: 'required' }`, and the place's first
  `CHECK_FAILURE_ROUTES` entry (`lead` before the merge and on a change, `owner` on the branch).
  `isCheckBlockAt(node, place)`, `defaultFailureRoute(place)`, and the owner's words for places and
  routes (`CHECK_PLACE_NAMES`, `CHECK_FAILURE_ROUTE_NAMES`).
- **Edge matrix** (`canConnect`, `connect.ts`): flow helper | pool | tester → change block (nothing
  flows out of a change block); rework change block → helper | pool | tester; merge lead → the
  merge block only; flow ticket merge | final stage → branch block → final stage | your merge
  (never branch block → branch block). The merge block keeps `checks → ticket-merge`.
- **Validator** (`validate.ts`), in the fixed order (Checks block rules after the final chain):
  - counts: exactly one block before the merge (`missing-node`, `too-many-nodes`; the old messages
    are kept when every block is a merge block), at most one on the branch (`too-many-nodes`);
  - `check-failure-route`: the route must be in `CHECK_FAILURE_ROUTES[place]`;
  - `check-block-input`: a change block needs at least one incoming flow;
  - `check-rework`: a change block's rework goes only to a node that flows into it, only with
    `onFailure: 'helper'`, and that route needs a rework link to every node it checks;
  - `many-check-blocks`: a helper or tester flows into at most one change block;
  - a branch block off the final chain is `final-chain`; a tester's flow to its change block is not
    a step of the chain;
  - `ctx.harness` (optional; `null` = no harness file) appends the selection warnings below.
- **Selection** (`workspace/harness-select.ts`): `checksForBlock(manifest, selection)` (required:
  every required check; ids and labels: the matching checks in the file's order, each once;
  unknown ids skipped) and `checkSelectionIssues(graph, manifest | null)`, warnings only:
  `unknown-check`, `unknown-check-label`, `no-checks-selected` (also each configured block when
  there is no harness file), `merge-skips-required` (the merge block leaves required checks out).
- **Compile** (`compile.ts`): `program.checkBlocks = { merge, branch, change }` (additive):
  `merge` `{ nodeId, label, place: 'merge', select, onFailure }`; `branch` the same with
  `place: 'branch'` and `afterStages` (how many `finalStages` run before it), or null; `change`
  keyed by the editing node's id, `{ ..., place: 'change', maxRounds }` (`maxRounds` is the block's
  rework edge's rounds for `onFailure: 'helper'`, else null).
- `graphRunDefaults` leaves a block's rework edges out of the review rounds.
- **Test support**: `generateValidGraph(seed, { checkBlocks: true })` adds seven Checks block moves;
  off by default, so every existing seed builds the same graph (asserted). Fifteen mutants
  appended to `GRAPH_MUTATIONS` (the existing ones are unchanged per seed); those that targeted
  "the" checks node now target the merge block.

### Contract changes (additive, in `workflow-graph.ts`)

- `GraphIssueCodeSchema`: errors `check-block-input`, `many-check-blocks`, `check-failure-route`,
  `check-rework`; warnings `unknown-check`, `unknown-check-label`, `no-checks-selected`,
  `merge-skips-required`.
- `WorkflowProgram.checkBlocks: ProgramCheckBlocks` with `ProgramCheckBlock`,
  `ProgramMergeCheckBlock`, `ProgramBranchCheckBlock`, `ProgramChangeCheckBlock`.

Not changed: `ChecksGateSchema`, `CheckSelectionSchema`, `CHECK_FAILURE_ROUTES`,
`NODE_CAPABILITIES` (its `checks.maxPerGraph: 1` now means "one merge block"; the validator counts
by place; see the report's proposal), templates, `migrateWorkflowV1` (its `checks` node has no
fields, which `checkBlockOf` reads as today's block).

## Decisions

- **A place's default route is its first allowed route**, so a branch block without `onFailure` is
  `owner`, not an invalid `lead`.
- **The run's review rounds do not replace a block's rounds.** `ctx.maxReworkRounds` is always set
  from the review settings at a run start; applying it to check blocks would erase the block's own
  `maxRounds`. `graphRunDefaults` leaves block rework out for the same reason.
- **"Back to the helper" needs a rework link to each node the block checks** (so every failing
  change can go back with known rounds); a block shared by two helpers needs two links.
- **Selection problems are warnings**, never errors: the harness file changes through tickets and
  can be out of step with the graph; the owner's merge still needs every required check on the tip.
- **No warnings for today's block without a harness file** (today's behaviour), so old projects'
  issue lists stay empty.

## For H-B, H-C and H-D

- Defaults: `checkBlockOf(node)`; place test: `isCheckBlockAt(node, place)`.
- Which checks to run: `checksForBlock(manifest, block.select)`.
- Program: `program.checkBlocks.merge`, `.branch` (null or with `afterStages`),
  `.change[editingNodeId]` (absent: no change block; `onFailure`, `maxRounds`).
- Editor: `canConnect`, `validateWorkflowGraph(graph, { ..., harness })` or
  `checkSelectionIssues(graph, manifest)`; `CHECK_PLACE_NAMES`, `CHECK_FAILURE_ROUTE_NAMES`,
  `defaultFailureRoute`, `CHECK_FAILURE_ROUTES`.
- Engine simulator tests can opt in with `generateValidGraph(seed, { checkBlocks: true })`.
- Anything that walks the final chain itself must skip a tester's flow edge to a change block.

## Checks

Lean verification (owner rule): `pnpm --filter @acp/core typecheck` ✓; eslint and prettier on the
changed files ✓; core vitest `tests/graph`, `harness-select`, `harness-blocks-contracts`,
`workflow-graph-contracts` 160/160 ✓; `pnpm -r typecheck` ✓ (all 7 packages); orchestrator
`tests/graph-correctness`, `legacy-snapshot`, `graph-engine` 1722/1722 ✓ with no snapshot written
or changed (golden traces byte-identical); server `graph-fuzz` 2/2 ✓ (the new mutants through the
API); web `workflow-editor-state` 23/23 ✓. The full `pnpm check` and e2e are the coordinator's.

## Work log

- 2026-10-23: branch from `release/0.3.0`; defaults, matrix, validator rules, selection, compile,
  generator moves and mutants, tests; scoped checks green; status `review`.
