import type { NodePosition, WorkflowGraph, WorkflowNode, WorkflowNodeId } from '@acp/core';
import { checkPlaceOf, isChecksNode } from '../check-blocks';
import { finishParts } from '../finish';

/**
 * Where the editor draws each block. A block the owner moved keeps its saved `position`; the
 * others are laid out automatically in three rows that read like lines of text (v0.3.0 D-C):
 *
 *   Ticket → (Planner →) Approve the plan                       the plan path
 *   Lead → helpers (stacked) → change checks → change reviewers (stacked)    the work
 *   Checks → final reviewers, testers, branch checks → Finish
 *
 * The plan path and the work share columns, so the plan reaches the lead with one straight or
 * one-bend line. The merge chain starts under the lead (the lead's merge line goes straight down)
 * and runs left to right at the steps' own width. The Finish block (ADR-0028 §3) stands for the
 * ticket merge, your merge and Done (`finish.ts`): the two hidden steps take its position. A graph
 * without exactly one of each end step (never a valid one) draws them as separate steps, with Done
 * under your merge when the row would sprawl. The gaps between rows leave room for the links that go back
 * (over the top and underneath) and for the links between rows, each in its own lane
 * (`routing.ts`). Deterministic: the same graph is always drawn the same way, and a block added
 * from the menu lands in its kind's place without moving the blocks before it.
 */

/** Every agent block is a card of one width; its height is fixed by its kind. */
export const AGENT_W = 216;
/** Read-only agents: kind, name, model, skills and agent file. */
export const AGENT_H = 108;
/** Agents that edit (helpers, the pool, the tester) have one more line: their approval mode. */
export const EDIT_H = 132;
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
const COL_GAP = 56;
const CHAIN_GAP = 40;
/** Room between rows for the back links and the lanes between rows (`routing.ts`). */
export const ROW_GAP = 128;
const STACK_GAP = 44;
const COL_W = AGENT_W;

export function isGateType(type: WorkflowNode['type']): boolean {
  return (
    type === 'ticket' ||
    type === 'plan-approval' ||
    type === 'checks' ||
    type === 'ticket-merge' ||
    type === 'owner-merge' ||
    type === 'done'
  );
}

/** Whether a block's agent changes files (and so has an approval mode line). */
export function editsFiles(type: WorkflowNode['type']): boolean {
  return type === 'helper' || type === 'helper-pool' || type === 'tester';
}

export function sizeOf(node: WorkflowNode): { width: number; height: number } {
  if (node.type === 'ticket' || node.type === 'done') return { width: END_W, height: STEP_H };
  // A Checks block also shows what it runs ("fast · full"), so it is as wide as an agent.
  if (node.type === 'checks') return { width: AGENT_W, height: CHECKS_H };
  if (node.type === 'owner-merge') return { width: FINISH_W, height: FINISH_H };
  if (isGateType(node.type)) return { width: STEP_W, height: STEP_H };
  return { width: AGENT_W, height: editsFiles(node.type) ? EDIT_H : AGENT_H };
}

function isFinalStage(node: WorkflowNode): boolean {
  return (
    (node.type === 'reviewer' && node.scope === 'final') ||
    node.type === 'tester' ||
    (isChecksNode(node) && checkPlaceOf(node) === 'branch')
  );
}

/** A Checks block on a change sits with the work, next to the helpers it checks (ADR-0027). */
function isChangeChecks(node: WorkflowNode): boolean {
  return isChecksNode(node) && checkPlaceOf(node) === 'change';
}

/**
 * The row a block's kind belongs to: 0 the plan path, 1 the work, 2 the merge chain. Links are
 * routed by rows (not by where a moved block happens to be), so moving a block never flips a link
 * to the other side of the canvas.
 */
export function rowOf(node: WorkflowNode): 0 | 1 | 2 {
  switch (node.type) {
    case 'ticket':
    case 'planner':
    case 'plan-approval':
      return 0;
    case 'lead':
    case 'helper':
    case 'helper-pool':
      return 1;
    case 'reviewer':
      return node.scope === 'change' ? 1 : 2;
    case 'checks':
      return checkPlaceOf(node) === 'change' ? 1 : 2;
    default:
      return 2;
  }
}

/** The final stages in chain order (following flow links from the ticket merge), then the rest. */
function finalOrder(graph: WorkflowGraph): WorkflowNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: WorkflowNode[] = [];
  const seen = new Set<WorkflowNodeId>();
  let current: WorkflowNode | undefined = graph.nodes.find((n) => n.type === 'ticket-merge');
  while (current !== undefined) {
    const from: WorkflowNode = current;
    const next = graph.edges
      .filter((e) => e.type === 'flow' && e.from === from.id)
      .map((e) => byId.get(e.to))
      .find((n): n is WorkflowNode => n !== undefined && isFinalStage(n) && !seen.has(n.id));
    if (next === undefined) break;
    seen.add(next.id);
    out.push(next);
    current = next;
  }
  return [...out, ...graph.nodes.filter((n) => isFinalStage(n) && !seen.has(n.id))];
}

/** The first two rows: columns of cells, each cell a stack of blocks. */
function columnRows(graph: WorkflowGraph): WorkflowNode[][][] {
  const of = (type: WorkflowNode['type']) => graph.nodes.filter((n) => n.type === type);
  const planRow: WorkflowNode[][] = [of('ticket'), of('planner'), of('plan-approval')].filter(
    (c) => c.length > 0,
  );
  const workRow: WorkflowNode[][] = [
    of('lead'),
    [...of('helper'), ...of('helper-pool')],
    graph.nodes.filter(isChangeChecks),
    graph.nodes.filter((n) => n.type === 'reviewer' && n.scope === 'change'),
  ].filter((c) => c.length > 0);
  return [planRow, workRow];
}

/** Every block's position: its own when it has one, else the automatic one. */
export function layoutGraph(graph: WorkflowGraph): Map<WorkflowNodeId, NodePosition> {
  const auto = new Map<WorkflowNodeId, NodePosition>();
  let top = 0;
  let widest = 0;
  for (const row of columnRows(graph)) {
    // The first block of every cell sits on one line, centred on the tallest first block; a
    // stack continues below its first block.
    const lineH = Math.max(0, ...row.map((cell) => (cell[0] ? sizeOf(cell[0]).height : 0)));
    let rowH = 0;
    row.forEach((cell, c) => {
      const first = cell[0];
      let y = top + (first === undefined ? 0 : (lineH - sizeOf(first).height) / 2);
      for (const node of cell) {
        const { width, height } = sizeOf(node);
        auto.set(node.id, { x: c * (COL_W + COL_GAP) + (COL_W - width) / 2, y });
        rowH = Math.max(rowH, y + height - top);
        y += height + STACK_GAP;
      }
    });
    if (row.length > 0) {
      widest = Math.max(widest, row.length * COL_W + (row.length - 1) * COL_GAP);
      top += rowH + ROW_GAP;
    }
  }

  // The merge chain, left to right from under the lead, each block at its own width.
  const of = (type: WorkflowNode['type']) => graph.nodes.filter((n) => n.type === type);
  const finish = finishParts(graph);
  const chain = [
    ...of('checks').filter((n) => isChecksNode(n) && checkPlaceOf(n) === 'merge'),
    ...(finish === null ? of('ticket-merge') : []),
    ...finalOrder(graph),
    ...of('owner-merge'),
  ];
  const done = finish === null ? of('done') : [];
  const lineH = Math.max(0, ...[...chain, ...done].map((n) => sizeOf(n).height));
  const startX = (COL_W - (chain[0] ? sizeOf(chain[0]).width : COL_W)) / 2;
  const widthOf = (list: readonly WorkflowNode[]) =>
    list.reduce((w, n, i) => w + sizeOf(n).width + (i > 0 ? CHAIN_GAP : 0), 0);
  // A little wider than the rows above is fine: Done hangs below only when the row would sprawl.
  const doneInRow = startX + widthOf([...chain, ...done]) <= Math.max(widest, COL_W) + CHAIN_GAP;
  let x = startX;
  const place = (node: WorkflowNode, at: NodePosition) => auto.set(node.id, at);
  for (const node of doneInRow ? [...chain, ...done] : chain) {
    const { width, height } = sizeOf(node);
    place(node, { x, y: top + (lineH - height) / 2 });
    x += width + CHAIN_GAP;
  }
  if (!doneInRow) {
    // Done hangs under your merge (or under the chain's last block).
    const last = chain[chain.length - 1];
    const anchor = last === undefined ? undefined : auto.get(last.id);
    for (const node of done) {
      const { width } = sizeOf(node);
      const lastSize = last === undefined ? { width, height: STEP_H } : sizeOf(last);
      place(
        node,
        anchor === undefined
          ? { x: startX, y: top }
          : {
              x: anchor.x + (lastSize.width - width) / 2,
              y: anchor.y + lastSize.height + STACK_GAP,
            },
      );
    }
  }
  if (chain.length > 0 || done.length > 0) top += lineH + ROW_GAP;

  const positions = new Map<WorkflowNodeId, NodePosition>();
  graph.nodes.forEach((node, i) => {
    // Anything the rows don't place (none in a graph of known kinds) goes below them.
    positions.set(
      node.id,
      node.position ?? auto.get(node.id) ?? { x: i * (COL_W + COL_GAP), y: top },
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
