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
  type WorkflowEdgeV3,
  type WorkflowGraph,
  type WorkflowGraphV3,
  type WorkflowNode,
  type WorkflowNodeV3,
} from '@acp/core';
import { graphRoles, isEditingKind } from './editor/roles';

/**
 * The Checks blocks of a workflow graph (ADR-0027 §5), read the same way by the editor, the
 * Harness page ("Where each check runs") and the ticket page. Thin, pure helpers over core's
 * `checkBlockOf` (a block's absent fields are the block from before ADR-0027: before the lead's
 * merge, every required check, the lead decides) and `checksForBlock`. They take a graph of either
 * version: the editor works on version 3 (ADR-0037), the Harness and ticket pages on the version 2
 * graph the server sends; in version 3 an agent edits when its derived role does.
 */

/** A graph of either version, its blocks and its links. */
export type AnyGraph = WorkflowGraph | WorkflowGraphV3;
export type AnyNode = WorkflowNode | WorkflowNodeV3;
export type AnyEdge = WorkflowEdge | WorkflowEdgeV3;

export type ChecksNode = Extract<WorkflowNode, { type: 'checks' }>;

export function isChecksNode(node: AnyNode | undefined): node is ChecksNode {
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

export function checksBlocks(graph: { nodes: readonly AnyNode[] }): ChecksNode[] {
  return graph.nodes.filter(isChecksNode);
}

/** A version 2 block that changes files: a helper, the pool, a tester. */
export function isEditingBlock(node: AnyNode | undefined): boolean {
  return (
    node !== undefined &&
    (node.type === 'helper' || node.type === 'helper-pool' || node.type === 'tester')
  );
}

/**
 * The blocks that change files and so have changes a block can check: by type in version 2, by
 * derived role (helper, pool or tester) in version 3.
 */
export function editingIds(graph: AnyGraph): Set<string> {
  if (graph.version === 2) {
    return new Set(graph.nodes.filter((n) => isEditingBlock(n)).map((n) => n.id));
  }
  const { kinds } = graphRoles(graph);
  return new Set([...kinds].filter(([, kind]) => isEditingKind(kind)).map(([id]) => id));
}

/** The editing blocks a change block checks: every one with a `flow` link into it. */
export function checkedBlocks<G extends AnyGraph>(
  graph: G,
  block: ChecksNode,
): G['nodes'][number][] {
  const editing = editingIds(graph);
  const nodes: readonly AnyNode[] = graph.nodes;
  const edges: readonly AnyEdge[] = graph.edges;
  return edges
    .filter((e) => e.type === 'flow' && e.to === block.id && editing.has(e.from))
    .map((e) => nodes.find((n) => n.id === e.from))
    .filter((n): n is G['nodes'][number] => n !== undefined);
}

/** True for a flow link into a change block (not a step of the final chain). */
export function isChangeBlockLink(graph: AnyGraph, edge: AnyEdge): boolean {
  const nodes: readonly AnyNode[] = graph.nodes;
  const to = nodes.find((n) => n.id === edge.to);
  return edge.type === 'flow' && isChecksNode(to) && checkPlaceOf(to) === 'change';
}

/** The block's `rework` links back to the blocks it checks (onFailure `helper`). */
export function reworkLinksOf(
  graph: AnyGraph,
  block: ChecksNode,
): Extract<AnyEdge, { type: 'rework' }>[] {
  const edges: readonly AnyEdge[] = graph.edges;
  return edges.filter(
    (e): e is Extract<AnyEdge, { type: 'rework' }> => e.type === 'rework' && e.from === block.id,
  );
}

/** The editing blocks that no change block checks yet (a helper flows into at most one). */
export function blocksWithoutChangeChecks<G extends AnyGraph>(graph: G): G['nodes'][number][] {
  const checked = new Set(
    checksBlocks(graph)
      .filter((b) => checkPlaceOf(b) === 'change')
      .flatMap((b) => checkedBlocks(graph, b).map((n) => n.id)),
  );
  const editing = editingIds(graph);
  const nodes: readonly G['nodes'][number][] = graph.nodes;
  return nodes.filter((n) => editing.has(n.id) && !checked.has(n.id));
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
  graph: { nodes: readonly AnyNode[] },
  check: HarnessCheck,
): ChecksNode[] {
  const order: Record<CheckBlockPlace, number> = { change: 0, merge: 1, branch: 2 };
  return checksBlocks(graph)
    .filter((b) => selectedChecks(checkSelectionOf(b), [check]).length > 0)
    .sort((a, b) => order[checkPlaceOf(a)] - order[checkPlaceOf(b)]);
}
