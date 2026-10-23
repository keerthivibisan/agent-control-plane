import {
  CHECK_FAILURE_ROUTES,
  type CheckBlockPlace,
  type CheckFailureRoute,
  type CheckSelection,
  type HarnessCheck,
  type HarnessStatus,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';
import { HARNESS_BLOCKS_COPY } from '../../lib/copy';

/**
 * The Checks blocks of a workflow graph (ADR-0027 §5), read the same way by the editor, the
 * Harness page ("Where each check runs") and the ticket page. Pure. A block's absent fields mean
 * the block from before ADR-0027: before the lead's merge, every required check, the lead decides.
 */

export type ChecksNode = Extract<WorkflowNode, { type: 'checks' }>;

export function isChecksNode(node: WorkflowNode | undefined): node is ChecksNode {
  return node?.type === 'checks';
}

export function checkPlaceOf(node: ChecksNode): CheckBlockPlace {
  return node.place ?? 'merge';
}

const REQUIRED: CheckSelection = Object.freeze({ kind: 'required' });

export function checkSelectionOf(node: ChecksNode): CheckSelection {
  return node.select ?? REQUIRED;
}

/** The routes a place allows (`CHECK_FAILURE_ROUTES`); the first is the default. */
export function failureRoutes(place: CheckBlockPlace): readonly CheckFailureRoute[] {
  return CHECK_FAILURE_ROUTES[place];
}

/** The block's failure route; a route its place does not allow reads as the place's default. */
export function checkFailureOf(node: ChecksNode): CheckFailureRoute {
  const routes = failureRoutes(checkPlaceOf(node));
  const route = node.onFailure;
  return route !== undefined && routes.includes(route) ? route : (routes[0] ?? 'lead');
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

/** The editing block a change block checks: the one with a `flow` link into it. */
export function checkedBlock(graph: WorkflowGraph, block: ChecksNode): WorkflowNode | undefined {
  const into = graph.edges.find((e) => e.type === 'flow' && e.to === block.id);
  const from = into === undefined ? undefined : graph.nodes.find((n) => n.id === into.from);
  return isEditingBlock(from) ? from : undefined;
}

/** The block's `rework` link back to the helper (onFailure `helper`), if it has one. */
export function reworkLinkOf(
  graph: WorkflowGraph,
  block: ChecksNode,
): Extract<WorkflowEdge, { type: 'rework' }> | undefined {
  return graph.edges.find(
    (e): e is Extract<WorkflowEdge, { type: 'rework' }> =>
      e.type === 'rework' && e.from === block.id,
  );
}

/** The editing blocks that have no change block yet (a change block per helper, at most). */
export function blocksWithoutChangeChecks(graph: WorkflowGraph): WorkflowNode[] {
  const checked = new Set(
    checksBlocks(graph)
      .filter((b) => checkPlaceOf(b) === 'change')
      .map((b) => checkedBlock(graph, b)?.id)
      .filter((id): id is string => id !== undefined),
  );
  return graph.nodes.filter((n) => isEditingBlock(n) && !checked.has(n.id));
}

// ---------------------------------------------------------------- the harness's checks

type Check = Pick<HarnessCheck, 'id' | 'required' | 'labels'>;

/** The checks a selection runs, in the harness file's order. */
export function selectedChecks<C extends Check>(
  selection: CheckSelection,
  checks: readonly C[],
): C[] {
  switch (selection.kind) {
    case 'required':
      return checks.filter((c) => c.required);
    case 'ids':
      return checks.filter((c) => selection.ids.includes(c.id));
    case 'labels':
      return checks.filter((c) => (c.labels ?? []).some((l) => selection.labels.includes(l)));
  }
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

/** A warning the editor adds (the core issue shape; `nodeId` names the block). */
export interface CheckSelectionIssue {
  code: 'check-missing' | 'check-label-missing';
  severity: 'warning';
  message: string;
  nodeId: string;
}

/**
 * Warnings for checks and labels the harness file does not have (README part 5 §3: "warns when a
 * name no longer exists in the harness file"). Computed here from the Harness status until core
 * offers the same check; nothing is flagged while the harness is unknown or unreadable.
 */
export function checkSelectionWarnings(
  graph: Pick<WorkflowGraph, 'nodes'>,
  checks: readonly Check[] | undefined,
): CheckSelectionIssue[] {
  if (checks === undefined) return [];
  const W = HARNESS_BLOCKS_COPY.warnings;
  const out: CheckSelectionIssue[] = [];
  for (const block of checksBlocks(graph)) {
    const missing = missingSelection(checkSelectionOf(block), checks);
    const label = block.label.trim() || block.id;
    for (const id of missing.ids) {
      out.push({
        code: 'check-missing',
        severity: 'warning',
        message: W.check(label, id),
        nodeId: block.id,
      });
    }
    for (const l of missing.labels) {
      out.push({
        code: 'check-label-missing',
        severity: 'warning',
        message: W.label(label, l),
        nodeId: block.id,
      });
    }
  }
  return out;
}

/** Where a check runs in a workflow: every block whose selection includes it. */
export function blocksRunningCheck(
  graph: Pick<WorkflowGraph, 'nodes'>,
  check: Check,
): ChecksNode[] {
  const order: Record<CheckBlockPlace, number> = { change: 0, merge: 1, branch: 2 };
  return checksBlocks(graph)
    .filter((b) => selectedChecks(checkSelectionOf(b), [check]).length > 0)
    .sort((a, b) => order[checkPlaceOf(a)] - order[checkPlaceOf(b)]);
}
