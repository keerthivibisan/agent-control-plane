import type { NodePosition, WorkflowGraph, WorkflowNode, WorkflowNodeId } from '@acp/core';

/**
 * Where the editor draws each block. A block the owner moved keeps its saved `position`; the
 * others are laid out automatically in three rows that read like lines of text, as the version 1
 * graph did, so the canvas stays readable at 1024px without zooming far out:
 *
 *   Ticket → (Planner →) Plan approval
 *   Lead → helpers (stacked) → change reviewers (stacked)
 *   Checks → Ticket branch → final reviewers and testers (chain order) → Your merge
 *                                                                          ↓ Done
 *
 * Each cell's first block sits on the row's line; more blocks in a cell (helpers, reviewers, Done
 * under your merge) stack below it. Deterministic: the same graph is always drawn the same way, and a block added from the palette
 * lands in its kind's place without moving the blocks before it.
 */

export const AGENT_W = 208;
export const AGENT_H = 132;
/** A named helper has one more line (how many may run at once). */
export const HELPER_H = 148;
export const GATE_W = 156;
export const GATE_H = 72;
/** Ticket and Done are pills, like the version 1 graph's ends. */
export const END_W = 120;
export const END_H = 44;
const COL_GAP = 44;
const ROW_GAP = 72;
const STACK_GAP = 24;
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

export function sizeOf(node: WorkflowNode): { width: number; height: number } {
  if (node.type === 'ticket' || node.type === 'done') return { width: END_W, height: END_H };
  if (isGateType(node.type)) return { width: GATE_W, height: GATE_H };
  return { width: AGENT_W, height: node.type === 'helper' ? HELPER_H : AGENT_H };
}

function isFinalStage(node: WorkflowNode): boolean {
  return (node.type === 'reviewer' && node.scope === 'final') || node.type === 'tester';
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

/** Rows of columns of blocks: each cell stacks its blocks top to bottom. */
function rows(graph: WorkflowGraph): WorkflowNode[][][] {
  const of = (type: WorkflowNode['type']) => graph.nodes.filter((n) => n.type === type);
  const planRow: WorkflowNode[][] = [of('ticket'), of('planner'), of('plan-approval')].filter(
    (c) => c.length > 0,
  );
  const workRow: WorkflowNode[][] = [
    of('lead'),
    [...of('helper'), ...of('helper-pool')],
    graph.nodes.filter((n) => n.type === 'reviewer' && n.scope === 'change'),
  ].filter((c) => c.length > 0);
  const mergeRow: WorkflowNode[][] = [
    ...[of('checks'), of('ticket-merge')].filter((c) => c.length > 0),
    ...finalOrder(graph).map((n) => [n]),
    // Done hangs under your merge, as in the version 1 graph: one column less to fit.
    [...of('owner-merge'), ...of('done')],
  ].filter((c) => c.length > 0);
  return [planRow, workRow, mergeRow];
}

/** Every block's position: its own when it has one, else the automatic one. */
export function layoutGraph(graph: WorkflowGraph): Map<WorkflowNodeId, NodePosition> {
  const positions = new Map<WorkflowNodeId, NodePosition>();
  let top = 0;
  for (const row of rows(graph)) {
    // The first block of every cell sits on one line, centred on the tallest first block; a
    // stack continues below its first block.
    const lineH = Math.max(0, ...row.map((cell) => (cell[0] ? sizeOf(cell[0]).height : 0)));
    let rowH = 0;
    row.forEach((cell, c) => {
      const first = cell[0];
      let y = top + (first === undefined ? 0 : (lineH - sizeOf(first).height) / 2);
      for (const node of cell) {
        const { width, height } = sizeOf(node);
        positions.set(
          node.id,
          node.position ?? { x: c * (COL_W + COL_GAP) + (COL_W - width) / 2, y },
        );
        rowH = Math.max(rowH, y + height - top);
        y += height + STACK_GAP;
      }
    });
    if (row.length > 0) top += rowH + ROW_GAP;
  }
  // Anything the rows don't place (none in a graph of known kinds) goes below them.
  graph.nodes.forEach((node, i) => {
    if (!positions.has(node.id)) {
      positions.set(node.id, node.position ?? { x: i * (COL_W + COL_GAP), y: top });
    }
  });
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
