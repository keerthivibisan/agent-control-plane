import type { NodePosition, WorkflowGraphV3, WorkflowNodeId, WorkflowNodeV3 } from '@acp/core';
import { playbookStages } from '@acp/core';
import { checkPlaceOf, isChecksNode } from '../check-blocks';
import { finishParts } from '../finish';
import { graphRoles, kindIn, type GraphRoles } from './roles';

type WorkflowGraph = WorkflowGraphV3;
type WorkflowNode = WorkflowNodeV3;

/**
 * Where the editor draws each block. A block the owner moved keeps its saved `position`; the
 * others are laid out automatically in **stage columns**, left to right in the order a run follows
 * them (ADR-0040; the stages are core's `playbookStages`, the same as the lead's playbook):
 *
 *   Ticket, research | Planners | Lead and plan approval | Helpers | Change checks, reviewers |
 *   Merge checks |
 *   Testers, final reviewers, branch checks (chain order), Author | Finish
 *
 * Each column is a stack, centred on the tallest; the gaps between columns leave room for the
 * lanes of the links between them and the loops of the links that go back (`routing.ts`). The
 * Finish block (ADR-0028 §3) stands for the ticket merge, your merge and Done (`finish.ts`): the
 * two hidden steps take its position. Deterministic: the same graph is always drawn the same way.
 */

/** Every agent block is a card of one width. */
export const AGENT_W = 216;
/** The lead: kind, name, model, skills and agent file. */
export const AGENT_H = 108;
/**
 * An Agent block (ADR-0037) has two more lines: when the lead uses it, or what starts it
 * (ADR-0040), and its approval mode when its role edits. Every agent block has the same size
 * whatever its role, so drawing an arrow never moves the blocks around it.
 */
export const EDIT_H = 152;
/** Steps are pills. */
export const STEP_W = 172;
export const STEP_H = 40;
/** Ticket and Done are shorter pills. */
export const END_W = 112;
/** A Checks block: its kind over its name, and what it runs, as wide as an agent. */
export const CHECKS_H = 52;
/** The Finish block: "Finish", "Merge into <target> or open a pull request", then Done. */
export const FINISH_W = 320;
export const FINISH_H = 64;
/** Room between stage columns for the lanes and loops of the links (`routing.ts`) and labels. */
export const COLUMN_GAP = 112;
const STACK_GAP = 44;
const COL_W = AGENT_W;

/** The canvas's columns: the playbook's stages, with the lead in its own column before its helpers. */
export const LAYOUT_COLUMNS = [
  'start',
  'plan',
  'lead',
  'build',
  'review',
  'merge',
  'final',
  'finish',
] as const;
export type LayoutColumn = (typeof LAYOUT_COLUMNS)[number];

export function isGateType(type: WorkflowNode['type']): boolean {
  return (
    type === 'ticket' ||
    type === 'plan-approval' ||
    type === 'checks' ||
    type === 'ticket-merge' ||
    type === 'owner-merge' ||
    type === 'done' ||
    // ADR-0038 §4: a routing block, drawn as a step (it runs no agent of its own).
    type === 'author'
  );
}

export function sizeOf(node: WorkflowNode): { width: number; height: number } {
  if (node.type === 'ticket' || node.type === 'done') return { width: END_W, height: STEP_H };
  // A Checks block also shows what it runs ("fast · full"), so it is as wide as an agent.
  if (node.type === 'checks') return { width: AGENT_W, height: CHECKS_H };
  if (node.type === 'owner-merge') return { width: FINISH_W, height: FINISH_H };
  if (isGateType(node.type)) return { width: STEP_W, height: STEP_H };
  return { width: AGENT_W, height: node.type === 'agent' ? EDIT_H : AGENT_H };
}

function isFinalStage(node: WorkflowNode, roles: GraphRoles): boolean {
  if (isChecksNode(node)) return checkPlaceOf(node) === 'branch';
  const kind = kindIn(roles, node);
  return kind === 'reviewer-final' || kind === 'tester';
}

/** A Checks block on a change sits with the work, next to the helpers it checks (ADR-0027). */
function isChangeChecks(node: WorkflowNode): boolean {
  return isChecksNode(node) && checkPlaceOf(node) === 'change';
}

/**
 * The row a block's kind belongs to: 0 the plan path (researchers and planners), 1 the work (the
 * lead, helpers, change reviewers, and agents without one role), 2 the merge chain. Links are
 * routed by rows (not by where a moved block happens to be), so moving a block never flips a link
 * to the other side of the canvas. `roles` are the stored graph's (`graphRoles`).
 */
export function rowOf(node: WorkflowNode, roles: GraphRoles): 0 | 1 | 2 {
  if (isChecksNode(node)) return checkPlaceOf(node) === 'change' ? 1 : 2;
  switch (kindIn(roles, node)) {
    case 'ticket':
    case 'researcher':
    case 'planner':
    case 'plan-approval':
      return 0;
    case 'lead':
    case 'helper':
    case 'helper-pool':
    case 'reviewer-change':
    case 'agent':
    case 'mixed':
    case 'author':
      return 1;
    default:
      return 2;
  }
}

/** The final stages in chain order (following chain links from the ticket merge), then the rest. */
function finalOrder(graph: WorkflowGraph, roles: GraphRoles): WorkflowNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: WorkflowNode[] = [];
  const seen = new Set<WorkflowNodeId>();
  let current: WorkflowNode | undefined = graph.nodes.find((n) => n.type === 'ticket-merge');
  while (current !== undefined) {
    const from: WorkflowNode = current;
    const next = graph.edges
      .filter((e) => (e.type === 'flow' || e.type === 'test') && e.from === from.id)
      .map((e) => byId.get(e.to))
      .find((n): n is WorkflowNode => n !== undefined && isFinalStage(n, roles) && !seen.has(n.id));
    if (next === undefined) break;
    seen.add(next.id);
    out.push(next);
    current = next;
  }
  return [...out, ...graph.nodes.filter((n) => isFinalStage(n, roles) && !seen.has(n.id))];
}

/** Every block's column (ADR-0040): its playbook stage, the lead apart from its helpers. */
export function columnOf(graph: WorkflowGraph): Map<WorkflowNodeId, LayoutColumn> {
  const stages = playbookStages(graph);
  const out = new Map<WorkflowNodeId, LayoutColumn>();
  for (const node of graph.nodes) {
    const stage = stages.get(node.id) ?? 'build';
    // Plan approval stands with the lead, so the plan reaches it in one step either way.
    out.set(node.id, node.type === 'lead' || node.type === 'plan-approval' ? 'lead' : stage);
  }
  return out;
}

/** The index of each block's column, for routing (the columns are its rows, turned on their side). */
export function columnIndexOf(graph: WorkflowGraph): Map<WorkflowNodeId, number> {
  const cols = columnOf(graph);
  return new Map([...cols].map(([id, c]) => [id, LAYOUT_COLUMNS.indexOf(c)]));
}

/** The blocks of each column, top to bottom. */
function columnCells(graph: WorkflowGraph, roles: GraphRoles): Map<LayoutColumn, WorkflowNode[]> {
  const cols = columnOf(graph);
  const finish = finishParts(graph);
  // The steps the Finish block stands for are never drawn.
  const hidden = new Set(finish === null ? [] : [finish.ticketMerge, finish.done]);
  const cells = new Map<LayoutColumn, WorkflowNode[]>(LAYOUT_COLUMNS.map((c) => [c, []]));
  for (const node of graph.nodes) {
    if (hidden.has(node.id)) continue;
    cells.get(cols.get(node.id) ?? 'build')?.push(node);
  }
  const first = (types: readonly WorkflowNode['type'][]) => (n: WorkflowNode) =>
    types.includes(n.type) ? 0 : 1;
  const order = (c: LayoutColumn, rank: (n: WorkflowNode) => number) =>
    cells.set(
      c,
      (cells.get(c) ?? [])
        .map((n, i) => ({ n, i }))
        .sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i)
        .map((x) => x.n),
    );
  order('start', first(['ticket']));
  // A planner's plan comes to the approval and then to the lead; the lead's own plan goes from it.
  const planners = (cells.get('plan') ?? []).length > 0;
  order('lead', (n) => (n.type === 'plan-approval' ? (planners ? -1 : 1) : 0));
  order('review', (n) => (isChangeChecks(n) ? 0 : 1));
  order('merge', first(['checks']));
  // The final checks in chain order, then the Author block that fixes their failures.
  const chain = finalOrder(graph, roles).map((n) => n.id);
  order('final', (n) => (n.type === 'author' ? 1000 : chain.indexOf(n.id) + 1));
  order('finish', first(['owner-merge']));
  return cells;
}

/** Every block's position: its own when it has one, else the automatic one. */
export function layoutGraph(graph: WorkflowGraph): Map<WorkflowNodeId, NodePosition> {
  const roles = graphRoles(graph);
  const cells = columnCells(graph, roles);
  const columns = LAYOUT_COLUMNS.map((c) => cells.get(c) ?? []).filter((list) => list.length > 0);
  const heightOf = (list: readonly WorkflowNode[]) =>
    list.reduce((h, n, i) => h + sizeOf(n).height + (i > 0 ? STACK_GAP : 0), 0);
  const tallest = Math.max(0, ...columns.map(heightOf));
  const auto = new Map<WorkflowNodeId, NodePosition>();
  let x = 0;
  for (const list of columns) {
    const width = Math.max(COL_W, ...list.map((n) => sizeOf(n).width));
    let y = (tallest - heightOf(list)) / 2;
    for (const node of list) {
      const size = sizeOf(node);
      auto.set(node.id, { x: x + (width - size.width) / 2, y });
      y += size.height + STACK_GAP;
    }
    x += width + COLUMN_GAP;
  }

  const finish = finishParts(graph);
  const positions = new Map<WorkflowNodeId, NodePosition>();
  graph.nodes.forEach((node, i) => {
    // Anything the columns don't place goes below them.
    positions.set(
      node.id,
      node.position ?? auto.get(node.id) ?? { x: i * (COL_W + COLUMN_GAP), y: tallest + STACK_GAP },
    );
  });
  if (finish !== null) {
    // The steps the Finish block stands for sit where it is (never drawn, never measured).
    const at = positions.get(finish.ownerMerge);
    if (at !== undefined) {
      positions.set(finish.ticketMerge, at);
      positions.set(finish.done, at);
    }
  }
  return positions;
}

/** The laid-out size of the whole graph, so the canvas can take its shape. */
export function graphBounds(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition> = layoutGraph(graph),
): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of graph.nodes) {
    const p = positions.get(node.id);
    if (p === undefined) continue;
    const { width, height } = sizeOf(node);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + width);
    maxY = Math.max(maxY, p.y + height);
  }
  return minX === Infinity ? { width: 0, height: 0 } : { width: maxX - minX, height: maxY - minY };
}
