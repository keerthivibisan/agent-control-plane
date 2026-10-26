import {
  CHECK_FAILURE_ROUTES,
  checkBlockOf,
  checksForBlock,
  type CheckBlockPlace,
  type CheckFailureRoute,
  type CheckSelection,
  type HarnessCheck,
  type HarnessManifest,
  type HarnessStatus,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';

/**
 * The Checks blocks of a workflow graph (ADR-0027 §5), read the same way by the editor, the
 * Harness page ("Where each check runs") and the ticket page. Thin, pure helpers over core's
 * `checkBlockOf` (a block's absent fields are the block from before ADR-0027: before the lead's
 * merge, every required check, the lead decides) and `checksForBlock`.
 */

export type ChecksNode = Extract<WorkflowNode, { type: 'checks' }>;

export function isChecksNode(node: WorkflowNode | undefined): node is ChecksNode {
  return node?.type === 'checks';
}

export function checkPlaceOf(node: ChecksNode): CheckBlockPlace {
  return checkBlockOf(node).place;
}

export function checkSelectionOf(node: ChecksNode): CheckSelection {
  return checkBlockOf(node).select;
}

/** The routes a place allows (`CHECK_FAILURE_ROUTES`); the first is the default. */
export function failureRoutes(place: CheckBlockPlace): readonly CheckFailureRoute[] {
  return CHECK_FAILURE_ROUTES[place];
}

/**
 * The block's failure route for the panel. Core returns a stored route as it is even when its
 * place does not allow it (the validator flags that); the panel shows the place's default then.
 */
export function checkFailureOf(node: ChecksNode): CheckFailureRoute {
  const block = checkBlockOf(node);
  const routes = failureRoutes(block.place);
  return routes.includes(block.onFailure) ? block.onFailure : (routes[0] ?? 'owner');
}

export function checksBlocks(graph: Pick<WorkflowGraph, 'nodes'>): ChecksNode[] {
  return graph.nodes.filter(isChecksNode);
}

/** A block that changes files and so has changes a block can check: a helper, the pool, a tester. */
export function isEditingBlock(node: WorkflowNode | undefined): boolean {
  return (
    node !== undefined &&
    (node.type === 'helper' || node.type === 'helper-pool' || node.type === 'tester')
  );
}

/** The editing blocks a change block checks: every one with a `flow` link into it. */
export function checkedBlocks(graph: WorkflowGraph, block: ChecksNode): WorkflowNode[] {
  return graph.edges
    .filter((e) => e.type === 'flow' && e.to === block.id)
    .map((e) => graph.nodes.find((n) => n.id === e.from))
    .filter((n): n is WorkflowNode => isEditingBlock(n));
}

/** True for a flow link into a change block (not a step of the final chain). */
export function isChangeBlockLink(graph: WorkflowGraph, edge: WorkflowEdge): boolean {
  const to = graph.nodes.find((n) => n.id === edge.to);
  return edge.type === 'flow' && isChecksNode(to) && checkPlaceOf(to) === 'change';
}

/** The block's `rework` links back to the blocks it checks (onFailure `helper`). */
export function reworkLinksOf(
  graph: WorkflowGraph,
  block: ChecksNode,
): Extract<WorkflowEdge, { type: 'rework' }>[] {
  return graph.edges.filter(
    (e): e is Extract<WorkflowEdge, { type: 'rework' }> =>
      e.type === 'rework' && e.from === block.id,
  );
}

/** The editing blocks that no change block checks yet (a helper flows into at most one). */
export function blocksWithoutChangeChecks(graph: WorkflowGraph): WorkflowNode[] {
  const checked = new Set(
    checksBlocks(graph)
      .filter((b) => checkPlaceOf(b) === 'change')
      .flatMap((b) => checkedBlocks(graph, b).map((n) => n.id)),
  );
  return graph.nodes.filter((n) => isEditingBlock(n) && !checked.has(n.id));
}

// ---------------------------------------------------------------- the harness's checks

type Check = Pick<HarnessCheck, 'id' | 'required' | 'labels'>;

/** The checks a selection runs, in the harness file's order (core's `checksForBlock`). */
export function selectedChecks(
  selection: CheckSelection,
  checks: readonly HarnessCheck[],
): HarnessCheck[] {
  return checksForBlock({ checks: [...checks] }, selection);
}

/** Every label the harness's checks carry, in first-seen order. */
export function harnessLabels(checks: readonly Check[]): string[] {
  const out: string[] = [];
  for (const c of checks) for (const l of c.labels ?? []) if (!out.includes(l)) out.push(l);
  return out;
}

/** The checks list is meaningful only for a readable harness file. */
export function usableHarness(
  harness: Pick<HarnessStatus, 'state' | 'checks'> | undefined,
): readonly HarnessCheck[] | undefined {
  if (harness === undefined) return undefined;
  return harness.state === 'ready' || harness.state === 'partial' ? harness.checks : undefined;
}

/**
 * The harness file for core's selection warnings (`ValidateGraphContext.harness`): its checks,
 * null when the project has none, undefined while unknown or unreadable (no warnings then).
 */
export function harnessForValidation(
  harness: Pick<HarnessStatus, 'state' | 'checks'> | undefined,
): Pick<HarnessManifest, 'checks'> | null | undefined {
  if (harness === undefined || harness.state === 'invalid') return undefined;
  if (harness.state === 'none') return null;
  return { checks: harness.checks };
}

/** Ids or labels a block picks that the harness file no longer has. */
export function missingSelection(
  selection: CheckSelection,
  checks: readonly Check[],
): { ids: string[]; labels: string[] } {
  if (selection.kind === 'ids') {
    const known = new Set(checks.map((c) => c.id));
    return { ids: selection.ids.filter((id) => !known.has(id)), labels: [] };
  }
  if (selection.kind === 'labels') {
    const known = new Set(harnessLabels(checks));
    return { ids: [], labels: selection.labels.filter((l) => !known.has(l)) };
  }
  return { ids: [], labels: [] };
}

/** Where a check runs in a workflow: every block whose selection includes it. */
export function blocksRunningCheck(
  graph: Pick<WorkflowGraph, 'nodes'>,
  check: HarnessCheck,
): ChecksNode[] {
  const order: Record<CheckBlockPlace, number> = { change: 0, merge: 1, branch: 2 };
  return checksBlocks(graph)
    .filter((b) => selectedChecks(checkSelectionOf(b), [check]).length > 0)
    .sort((a, b) => order[checkPlaceOf(a)] - order[checkPlaceOf(b)]);
}
