import type {
  NodePosition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
} from '@acp/core';

/**
 * Where the editor draws each block. A block the owner moved keeps its saved `position`; the
 * others are laid out automatically, left to right like the version 1 graph reads: each block's
 * column is the longest chain of forward links (flow, assigns, merge, and a review sent to a
 * reviewer) from the ticket, and blocks in one column stack top to bottom in a fixed kind order.
 * The links that go back (findings, rework, a review sent to the lead) don't count, so they never
 * push a block further right. Deterministic: the same graph is
 * always drawn the same way, and adding a block never moves the blocks before it in its column.
 */

export const AGENT_W = 216;
export const AGENT_H = 120;
export const GATE_W = 168;
export const GATE_H = 72;
/** Ticket and Done are pills, like the version 1 graph's ends. */
export const END_W = 132;
export const END_H = 44;
const COL_GAP = 72;
const ROW_GAP = 32;
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
  return { width: AGENT_W, height: AGENT_H };
}

/**
 * Links that move a ticket forward. A review sent to the lead goes back to it, like findings and
 * rework, so it doesn't count (it would make a loop through the lead).
 */
function isForward(e: WorkflowEdge, byId: ReadonlyMap<WorkflowNodeId, WorkflowNode>): boolean {
  if (e.type === 'flow' || e.type === 'assigns' || e.type === 'merge') return true;
  return e.type === 'review' && byId.get(e.to)?.type !== 'lead';
}

/** The order blocks stack in within a column. */
const KIND_ORDER: Readonly<Record<WorkflowNode['type'], number>> = {
  ticket: 0,
  planner: 1,
  lead: 2,
  'plan-approval': 3,
  helper: 4,
  'helper-pool': 5,
  reviewer: 6,
  tester: 7,
  checks: 8,
  'ticket-merge': 9,
  'owner-merge': 10,
  done: 11,
};

/** Columns by longest forward chain from the ticket; a cycle (an invalid graph) stops growing. */
function columns(graph: WorkflowGraph): Map<WorkflowNodeId, number> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const forward = graph.edges.filter(
    (e) => isForward(e, byId) && byId.has(e.from) && byId.has(e.to) && e.from !== e.to,
  );
  const col = new Map<WorkflowNodeId, number>();
  const ticket = graph.nodes.find((n) => n.type === 'ticket');
  if (ticket !== undefined) col.set(ticket.id, 0);
  // Bellman-Ford style relaxation, at most one pass per node: longest paths in a DAG, and a cycle
  // simply stops after the passes run out.
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let changed = false;
    for (const e of forward) {
      const from = col.get(e.from);
      if (from === undefined) continue;
      if ((col.get(e.to) ?? -1) < from + 1) {
        col.set(e.to, Math.min(from + 1, graph.nodes.length));
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Blocks no link reaches yet (just added from the palette) go where their kind usually sits.
  const leadCol = col.get(graph.nodes.find((n) => n.type === 'lead')?.id ?? '') ?? 1;
  const last = Math.max(0, ...col.values());
  for (const node of graph.nodes) {
    if (col.has(node.id)) continue;
    switch (node.type) {
      case 'planner':
        col.set(node.id, 1);
        break;
      case 'helper':
      case 'helper-pool':
        col.set(node.id, leadCol + 1);
        break;
      case 'reviewer':
        col.set(node.id, node.scope === 'change' ? leadCol + 2 : last);
        break;
      default:
        col.set(node.id, last);
    }
  }
  return col;
}

/** Every block's position: its own when it has one, else the automatic one. */
export function layoutGraph(graph: WorkflowGraph): Map<WorkflowNodeId, NodePosition> {
  const col = columns(graph);
  const byCol = new Map<number, WorkflowNode[]>();
  graph.nodes.forEach((node) => {
    const c = col.get(node.id) ?? 0;
    byCol.set(c, [...(byCol.get(c) ?? []), node]);
  });
  const positions = new Map<WorkflowNodeId, NodePosition>();
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  for (const [c, nodes] of byCol) {
    nodes.sort(
      (a, b) =>
        KIND_ORDER[a.type] - KIND_ORDER[b.type] || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    let y = 0;
    for (const node of nodes) {
      const { width, height } = sizeOf(node);
      positions.set(
        node.id,
        node.position ?? { x: c * (COL_W + COL_GAP) + (COL_W - width) / 2, y },
      );
      y += height + ROW_GAP;
    }
  }
  return positions;
}
