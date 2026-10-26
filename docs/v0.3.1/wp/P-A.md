# P-A

> Progress file for P-A. Only its agent edits it. Plan: [../README.md](../README.md). Decision:
> [ADR-0028](../../decisions/0028-agent-effort-optional-checks-finish-block.md) §1–§2, with
> ADR-0023, ADR-0027 (and its F-2 amendment) and ADR-0021 §4 (and its F-1/F-2 amendments).
> Contract from P-0 (`a9b419f`).

| Field  | Value                                            |
| ------ | ------------------------------------------------ |
| Status | review                                           |
| Branch | `wp/p-a-core`, from `release/0.3.1` at `5994a8d` |

## What changed

### Effort per agent block (ADR-0028 §1)

- **Compile** (`core/workspace/graph/compile.ts`): an agent block's `effort` is copied into its
  program node (`ProgramAgentNode.effort`) only when set; absent stays absent.
- **Engine** (`orchestrator`): `launchFieldsFor` adds `effort` to the launch fields when the node
  has one. Every start of a node's agents goes through it (first turn, the lead's or a reviewer's
  rework, a Checks block's rework), so they all keep it. `start-agent.effort?` and
  `start-follow-up.effort?` (the lead node's effort on a follow-up turn) are new optional effect
  fields.
- **Server** (`control/service.ts`): `start-agent.effort` → `LaunchInput.effort` →
  `ManagedAgentSpec.effort` (lead, planner, reviewers, helpers, testers, rework turns), and
  `start-follow-up.effort` → the follow-up's spec. Absent: not set.
- **Adapter** (`managed/adapter.ts`): `options.effort = spec.effort` only when set. The SDK
  option is `Options.effort?: EffortLevel` (`'low' | 'medium' | 'high' | 'xhigh' | 'max'`, Agent SDK
  0.3.296, `sdk.d.ts`); the app passes only `low`, `medium` or `high`.
- **Golden traces byte-identical:** the field is spread in only when set, and no template or
  generated graph sets one, so no effect changes. Proven by running the golden, legacy-snapshot and
  graph-correctness suites with `CI=true` (vitest never writes a snapshot in CI mode, and a changed
  one fails); no snapshot file changed.

### Optional Checks blocks (ADR-0028 §2)

- **Contract** (in the brief): `NODE_CAPABILITIES.checks.minPerGraph` 0 (`maxPerGraph` 1 still
  means "one block before the merge"; the validator counts by place);
  `ProgramCheckBlocks.merge: ProgramMergeCheckBlock | null`; new **warning** code `no-checks`.
- **The lead's merge link** (`connect.ts`, the edge matrix): `merge` goes lead → the block before
  the merge when the graph has one, else lead → the ticket merge (`ticket-merge`). Which one
  depends on the graph, like the plan path on the planner (`NodeIndex.hasMergeBlock`), so the lead
  can never bypass a block before the merge, and `canConnect` and the validator stay one rule. A
  refused lead → ticket merge link with a block present says "The workflow has a Checks block
  before the merge, so the Lead merges through it."
- **Validator** (`validate.ts`): no `missing-node` for Checks blocks any more; at most one before
  the merge and one on the ticket branch (`too-many-nodes`, unchanged); `merge-path` without a
  block before the merge: "\"Lead\" needs a merge link to \"Ticket branch\": only the Lead merges
  changes into the ticket branch, after their review."; the warning `no-checks`, exactly "No checks:
  changes merge after review only." (exported as `NO_CHECKS_MESSAGE`), when the graph has no
  `checks` node at all (after the instance warnings, before the harness selection warnings).
- **Compile:** `checkBlocks.merge` is null without a block before the merge.
- **Engine:** `hasMergeChecks(view)` (exported). Without a merge block: `checkChange` never
  refuses a merge for checks (`checks-pending`/`checks-failed`), `checksFinished` on a change is
  ignored (nothing recorded, no lead message), `mergeFailureRoute` is `lead`, `view_change` says
  "Required checks: none (this workflow has no Checks block before the merge; merge_change merges
  after the review)", and the tester's brief drops "after the project's checks" (only for such
  graphs, so old traces are unchanged). Every F-1/F-2 rule is untouched: only the lead (or the
  owner) merges, a merge refused for a moved or checked-out ticket branch goes to the owner at once,
  three failed merges in a row go to the owner, work that could not be saved is never merged.
- **Server** (`harness/blocks.ts`, `control/review-loop.ts`, `board/checks.ts`): a `CheckSpec` that
  runs nothing (`runsNothing`) is never started (no checkout, no setup, no result), and gates
  nothing. See the gating table below.

### Final-merge gating: old graphs and new graphs

The owner's answer (ADR-0028 §2): checks gate only where the workflow places them. The safe
reading keeps every graph that has a block before the lead's merge exactly as in 0.3.0:

| Graph                                                      | Before the lead's merge         | The owner's final merge (tip)                                      |
| ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| Has a merge block (every graph before 0.3.1, every v1 run) | its selection gates (unchanged) | required ∪ branch block's selection run; **required gate** (0.3.0) |
| No merge block, no branch block                            | nothing runs, nothing gates     | nothing runs, nothing gates; no "Merge anyway" (409 if asked)      |
| No merge block, a branch block                             | nothing runs, nothing gates     | **the branch block's selection** runs and gates; "Merge anyway"    |
| A stored graph the validator now refuses (`program` null)  | required (old defaults)         | every check runs; required gate (old defaults)                     |

So only graphs without a block before the merge change behaviour, and of those only the ones
without a branch block lose the tip gate. A graph that keeps its merge block and adds a branch
block behaves as in 0.3.0 (its block's other picks run and are shown, not enforced).

## For P-B (web)

- Validity is core's: `validateWorkflowGraph` and `canConnect` (no rule duplicated in the web).
- Removing the block before the merge: drop it and its links, then add `merge` lead →
  `ticket-merge` (core's `canConnect` allows it only once no merge block is left). Adding one back:
  remove that link and wire lead → block (`merge`) and block → ticket merge (`flow`). Without the
  rewiring the validator reports `merge-path` / `edge-not-allowed` with plain words, so the owner
  can also draw it by hand.
- The warning: code `no-checks`, severity `warning`, no `nodeId`; text `NO_CHECKS_MESSAGE`.
- Test support: `withoutCheckBlocks(graph)` (core, `testing/graph-ops.ts`) gives a template's
  "no checks" variant with the lead's merge link rewired.
- The ticket DTOs are unchanged: for the owner's final step, a run whose graph has no block before
  the merge and no branch block has no tip checks at all (an empty `checks` list on the tip), and
  `merge` succeeds without them.

## Proposed ADR-0028 note (for the coordinator; not edited here)

> **Amendment (P-A): what gates the owner's final merge.** A workflow with a Checks block before
> the lead's merge (every graph saved before 0.3.1 and every version 1 run) keeps 0.3.0's rule:
> the required checks gate the owner's merge on the ticket branch tip (with "Merge anyway"), and
> a branch block's other picks run and are shown, not enforced. A workflow without a block before
> the merge is gated on the tip only by a block on the ticket branch, by that block's own
> selection; without one, nothing runs on the tip and the owner merges without "Merge anyway".
> The lead's `merge` link goes to the ticket merge when there is no block before the merge, and is
> refused there when there is one, so the lead can never merge past a block.

## Decisions

- **The lead's direct merge link is graph-dependent** (allowed only without a merge block), rather
  than always allowed with a path rule refusing it next to a block: the matrix then refuses it
  wherever it would bypass checks, and the editor's drag hints follow.
- **The tip gate for graphs with a merge block stays `required`** even with a branch block (0.3.0
  exactly). Only graphs without a merge block are gated by the branch block's own selection.
- **Old seeds stay the same:** the generator's new moves ("remove merge checks", "add merge checks")
  run only with `optionalChecks: true`; a fingerprint test pins seeds 1–2000 and 100001–100600 to
  the graphs v0.3.0's generator made. The mutant "delete the checks block" now expects
  `merge-path` (removing the block without rewiring); "the lead merges into the ticket merge
  directly" applies only next to a merge block; "add a second Checks block before the merge" adds
  two when there is none; two mutants for graphs without a merge block are appended.
- **`no-checks` only when no `checks` node exists at all** (a change or branch block alone is a
  workflow with checks).
- **No new text in core's tool descriptions:** `merge_change`'s description in
  `core/orchestration` still says the required checks must pass first. It is outside P-A's paths;
  `view_change` and the tester brief say the truth for graphs without checks.

## Tests

- core: `tests/graph/optional-checks.test.ts` (10, new: templates without checks valid and
  compiled, the warning, branch block alone, merge path, `canConnect`, too many, old graphs
  unchanged, effort compiled); `properties.test.ts` (+600 optional-check seeds, the v0.3.0
  fingerprint, "no merge checks" and "no checks at all" covered, `no-checks` a warning);
  `check-blocks.test.ts` and `validate.test.ts` (the missing-node rules for Checks blocks replaced).
- orchestrator: `tests/optional-checks-effort.test.ts` (new: merge without checks, stray results,
  `view_change`, the tester brief, deciders, F-2 moved/checked-out branch and bounded failed
  merges, effort on the lead, a helper, its rework, the follow-up);
  `graph-correctness/optional-checks.test.ts` (new: every template's no-checks variant explored in
  3 setups, a default run to the owner's merge with no checks, every template with efforts, seeds
  1–40 with `optionalChecks`); invariants 9 (each start carries its node's effort) and 10 (no merge
  checks without a merge block); the simulator's server never blocks a merge for checks without a
  merge block; `adversarial/simulated.test.ts` (+ every template without checks, both modes, and
  seeds 1–10 with `optionalChecks`).
- server: `tests/board/optional-checks.test.ts` (new: save a no-checks graph; merge and owner's
  merge with no checks; a branch block alone gates by its selection; effort on
  `ManagedAgentSpec`); `adversarial/hostile-helper.test.ts` (+ "without any Checks block", both
  modes: ACPGIT-3 checkout-and-commit, a moved ticket branch, an honest run to the owner's merge;
  the kit's `scenario({ graph })`).
- adapter: `tests/managed/effort.test.ts` (new: the option for each level, absent without one, every
  role, rework, follow-up).

## Checks

Lean verification (owner rule), vitest with `--maxWorkers=2`: `pnpm -r typecheck` ✓ (all
packages); eslint and prettier on every changed file ✓; core `tests/graph`,
`workflow-graph-contracts`, `harness-select`, `harness-blocks-contracts`, `agent-effort-contracts`
175/175 ✓; orchestrator, whole package with `CI=true` (golden, legacy snapshot, graph-correctness,
adversarial and the rest) 2481/2481 ✓, no snapshot written or changed; server, whole package with
`CI=true`, 848/848 ✓; adapter `tests/managed/effort`, `title`, `follow-up` 17/17 ✓; web
`workflow-editor-state` 23/23 ✓ (unchanged web against the new core). The full `pnpm check` and
e2e are the coordinator's.

## Work log

- 2026-10-26: branch from `release/0.3.1` (`5994a8d`); core (validator, matrix, compile, effort,
  generators, mutants), engine, server, adapter, tests; scoped checks green; status `review`.
