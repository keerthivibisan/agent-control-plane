import type { WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeId } from '@acp/core';

/**
 * The Finish block (ADR-0028 §3): the editor and the live run graph draw the end of every flow,
 * the `ticket-merge` → `owner-merge` → `done` steps, as one fixed block, "Merge into <target> or
 * open a pull request, then Done". Presentation only: the stored graph keeps its three nodes and
 * their links, so nothing is migrated and a save writes exactly what the reducer holds.
 *
 * The block is the `owner-merge` node itself (its id, its position, its selection); the ticket
 * merge and Done are hidden. Links are redrawn around the hidden steps:
 * - a link into the ticket merge ends on the Finish block when the ticket merge goes straight to
 *   your merge; otherwise it is drawn by the links that leave the ticket merge, which start where
 *   it came from (the Checks block before the merge, or the lead);
 * - the links inside the Finish block (ticket merge → your merge → Done) are not drawn.
 * Every drawn link keeps the id of a stored link, so selecting or removing it acts on that link.
 */

export interface FinishParts {
  ticketMerge: WorkflowNodeId;
  ownerMerge: WorkflowNodeId;
  done: WorkflowNodeId;
}

/** What the canvas draws: the graph with the Finish block in place of the three end steps. */
export interface FinishView {
  graph: WorkflowGraph;
  /** Null when the graph does not have exactly one of each end step: nothing is folded then. */
  finish: FinishParts | null;
}

function single(graph: Pick<WorkflowGraph, 'nodes'>, type: WorkflowNode['type']) {
  const all = graph.nodes.filter((n) => n.type === type);
  return all.length === 1 ? all[0] : undefined;
}

export function finishParts(graph: Pick<WorkflowGraph, 'nodes'>): FinishParts | null {
  const ticketMerge = single(graph, 'ticket-merge');
  const ownerMerge = single(graph, 'owner-merge');
  const done = single(graph, 'done');
  if (ticketMerge === undefined || ownerMerge === undefined || done === undefined) return null;
  return { ticketMerge: ticketMerge.id, ownerMerge: ownerMerge.id, done: done.id };
}

/** True for the steps the Finish block hides (the ticket merge and Done). */
export function isHiddenByFinish(parts: FinishParts | null, id: WorkflowNodeId): boolean {
  return parts !== null && (id === parts.ticketMerge || id === parts.done);
}

/** The graph as drawn, with the Finish block (pure; the same for the editor and the live graph). */
export function finishView(graph: WorkflowGraph): FinishView {
  const parts = finishParts(graph);
  if (parts === null) return { graph, finish: null };
  const { ticketMerge: tm, ownerMerge: om, done } = parts;
  const straight = graph.edges.some((e) => e.from === tm && e.to === om);
  const source = graph.edges.find((e) => e.to === tm && e.from !== tm && e.from !== om)?.from;
  const edges: WorkflowEdge[] = [];
  for (const e of graph.edges) {
    // Inside the Finish block, or out of Done: not drawn.
    if (e.from === done || (e.from === tm && (e.to === om || e.to === done))) continue;
    if (e.from === om && e.to === done) continue;
    if (e.to === tm) {
      if (straight && e.from !== om) edges.push({ ...e, to: om });
      continue;
    }
    if (e.from === tm) {
      if (source !== undefined && source !== e.to) edges.push({ ...e, from: source });
      continue;
    }
    edges.push(e.to === done ? { ...e, to: om } : e);
  }
  return {
    graph: { ...graph, nodes: graph.nodes.filter((n) => n.id !== tm && n.id !== done), edges },
    finish: parts,
  };
}

/**
 * The problems as the canvas shows them: a problem with the hidden steps, or with a link that is
 * not drawn, belongs to the Finish block.
 */
export function finishIssues<
  T extends { nodeId?: string | undefined; edgeId?: string | undefined },
>(issues: readonly T[], graph: WorkflowGraph, view: FinishView): T[] {
  const parts = view.finish;
  if (parts === null) return [...issues];
  const drawn = new Set(view.graph.edges.map((e) => e.id));
  const stored = new Set(graph.edges.map((e) => e.id));
  return issues.map((issue) => {
    let next: T = issue;
    if (next.edgeId !== undefined && stored.has(next.edgeId) && !drawn.has(next.edgeId)) {
      const { edgeId: _hidden, ...rest } = next;
      next = { ...rest, nodeId: parts.ownerMerge } as T;
    }
    if (next.nodeId !== undefined && isHiddenByFinish(parts, next.nodeId)) {
      next = { ...next, nodeId: parts.ownerMerge };
    }
    return next;
  });
}
