import { checksForBlock } from '@acp/core';
import type {
  CheckRunPlace,
  CheckSelection,
  HarnessCheck,
  HarnessManifest,
  WorkflowProgram,
} from '@acp/core';

/**
 * Which checks run, and which gate, at each place of the workflow (ADR-0027 §5). The selections
 * come from the run's compiled program; the checks from the harness file of the owner's checkout
 * (never from the code under check, ADR-0017 handoff).
 *
 * - the change's own block: its selection, which also gates (its pass or fail goes to the engine);
 * - before the lead's merge: the merge block's selection gates. With "all required checks" (every
 *   graph from before ADR-0027) every check of the file runs, as before; the required ones gate;
 * - the ticket branch (the owner's merge): every required check and the branch block's selection
 *   run (without a branch block every check runs, as before); only the required checks gate the
 *   owner's merge, as before (ADR-0027 §6): the branch block's other picks are shown, not enforced;
 * - main ("Run checks now"): every check runs; nothing gates.
 *
 * ADR-0028 §2 (checks gate only where the workflow places them), for a workflow WITHOUT a block
 * before the lead's merge (a graph saved after ADR-0028; every older graph and every version 1
 * run has one and keeps the rules above exactly):
 * - before the lead's merge: nothing runs and nothing gates (`NO_CHECKS`);
 * - the ticket branch: with a branch block, its selection runs and gates the owner's merge; without
 *   one, nothing runs and nothing gates, so the owner merges without "Merge anyway".
 */
export interface CheckSpec {
  place: CheckRunPlace;
  /** The Checks block (graph node) that runs them; null for main. */
  blockNodeId: string | null;
  /** `all`: every check in the file; otherwise the checks any selection picks. */
  run: 'all' | readonly CheckSelection[];
  /** The checks whose latest result on the commit must be a pass. */
  gate: readonly CheckSelection[];
}

const REQUIRED: CheckSelection = { kind: 'required' };

/** The checks any of `selections` picks, in the file's order, each once. */
function union(
  manifest: Pick<HarnessManifest, 'checks'>,
  selections: readonly CheckSelection[],
): HarnessCheck[] {
  const picked = new Set(selections.flatMap((s) => checksForBlock(manifest, s).map((c) => c.id)));
  return manifest.checks.filter((c) => picked.has(c.id));
}

export function checksToRun(
  manifest: Pick<HarnessManifest, 'checks'>,
  spec: CheckSpec,
): HarnessCheck[] {
  return spec.run === 'all' ? [...manifest.checks] : union(manifest, spec.run);
}

export function checksToGate(
  manifest: Pick<HarnessManifest, 'checks'>,
  spec: CheckSpec,
): HarnessCheck[] {
  return union(manifest, spec.gate);
}

/** No check runs and none gates (ADR-0028 §2: no Checks block at this place). */
function noChecks(place: CheckRunPlace): CheckSpec {
  return { place, blockNodeId: null, run: [], gate: [] };
}

/** True when the spec runs no check at all, so there is nothing to start (or set up) for it. */
export function runsNothing(spec: CheckSpec): boolean {
  return spec.run !== 'all' && spec.run.length === 0;
}

/**
 * The block before the lead's merge (and its early run on a sealed change). `program` null: a
 * stored graph the validator refuses, which keeps the old defaults (every required check).
 */
export function mergeSpec(program: WorkflowProgram | null): CheckSpec {
  if (program !== null && program.checkBlocks.merge === null) return noChecks('merge');
  const block = program?.checkBlocks.merge;
  const select = block?.select ?? REQUIRED;
  return {
    place: 'merge',
    blockNodeId: block?.nodeId ?? null,
    run: select.kind === 'required' ? 'all' : [select],
    gate: [select],
  };
}

/** The ticket branch tip before the owner's merge (and the branch block's own run). */
export function branchSpec(program: WorkflowProgram | null): CheckSpec {
  const block = program?.checkBlocks.branch ?? null;
  if (program !== null && program.checkBlocks.merge === null) {
    // ADR-0028 §2: gated only by a block placed on the ticket branch, by its own selection.
    return block === null
      ? noChecks('branch')
      : { place: 'branch', blockNodeId: block.nodeId, run: [block.select], gate: [block.select] };
  }
  if (block === null) return { place: 'branch', blockNodeId: null, run: 'all', gate: [REQUIRED] };
  return {
    place: 'branch',
    blockNodeId: block.nodeId,
    run: [REQUIRED, block.select],
    gate: [REQUIRED],
  };
}

/** A Checks block on a helper's or tester's change. */
export function changeSpec(blockNodeId: string, select: CheckSelection): CheckSpec {
  return { place: 'change', blockNodeId, run: [select], gate: [select] };
}

/** "Run checks now" on main. */
export const MAIN_SPEC: CheckSpec = { place: 'main', blockNodeId: null, run: 'all', gate: [] };
