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

/** The block before the lead's merge (and its early run on a sealed change). */
export function mergeSpec(program: WorkflowProgram | null): CheckSpec {
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
