import type {
  SessionEdgeDto,
  SessionTreeDto,
  SessionSummaryDto,
  UsageTotalsDto,
} from '@acp/core/api';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { SESSIONS_COPY } from '../../lib/copy';

const EDGE_LABEL: Record<SessionEdgeDto['kind'], string> = SESSIONS_COPY.relate.legend;

export type SessionNodeData = {
  session: SessionSummaryDto;
  aggregateUsage: UsageTotalsDto;
  /** `unknown` when no edge in the tree points at this node. Never inferred from anything else. */
  parent: 'known' | 'unknown';
  isRoot: boolean;
  isFocus: boolean;
  /** Outgoing edges in the tree (both kinds). */
  childEdgeCount: number;
  collapsed: boolean;
  /** Descendants currently hidden because this node (or one above it) is collapsed. */
  hiddenDescendants: number;
};

export type SessionNode = Node<SessionNodeData, 'session'>;
export type SessionGraphEdge = Edge<{
  kind: SessionEdgeDto['kind'];
  provenance: SessionEdgeDto['provenance'];
  evidence: SessionEdgeDto['evidence'];
}>;

export const NODE_WIDTH = 280;
export const X_GAP = 350;
export const Y_GAP = 170;

/** Theme colors only (index.css), so both themes work. Dashes tell the kinds apart without color. */
export const EDGE_STYLE: Record<SessionEdgeDto['kind'], { stroke: string; dash?: string }> = {
  // Neutral ink: lime marks only what is working or selected (DESIGN.md, "Agent views").
  subagent: { stroke: 'var(--color-ink)' },
  continuation: { stroke: 'var(--color-dim)', dash: '6 4' },
};

export interface GraphModel {
  nodes: SessionNode[];
  edges: SessionGraphEdge[];
  /** Edges whose endpoint is missing from `nodes`; they are dropped, not guessed. */
  danglingEdges: number;
}

/**
 * Maps a SessionTreeDto to React Flow nodes and edges. Relationships come ONLY from `tree.edges`
 * (verified edges with evidence); nothing is inferred from timing, ids, paths, or `childCount`.
 */
export function buildGraph(
  tree: SessionTreeDto,
  collapsed: ReadonlySet<string> = new Set(),
  focusId?: string,
): GraphModel {
  const byId = new Map(tree.nodes.map((n) => [n.session.id, n]));
  const edges = tree.edges.filter((e) => byId.has(e.parentId) && byId.has(e.childId));
  const out = new Map<string, SessionEdgeDto[]>();
  const incoming = new Map<string, number>();
  for (const e of edges) {
    out.set(e.parentId, [...(out.get(e.parentId) ?? []), e]);
    incoming.set(e.childId, (incoming.get(e.childId) ?? 0) + 1);
  }
  const byFirstSeen = (a: string, b: string) => {
    const sa = byId.get(a)?.session.firstSeenAt ?? '';
    const sb = byId.get(b)?.session.firstSeenAt ?? '';
    return sa < sb ? -1 : sa > sb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  };
  const childrenOf = (id: string) =>
    [...new Set((out.get(id) ?? []).map((e) => e.childId))].sort(byFirstSeen);

  // Start points: the tree root, then other nodes no edge points at, then anything left (cycles).
  const allIds = [...byId.keys()];
  const starts = [
    ...(byId.has(tree.rootId) ? [tree.rootId] : []),
    ...allIds.filter((id) => id !== tree.rootId && !incoming.has(id)).sort(byFirstSeen),
  ];

  // Visible spanning forest: BFS that does not descend below collapsed nodes.
  const visible = new Set<string>();
  const spanParent = new Map<string, string>();
  const depth = new Map<string, number>();
  const visit = (start: string) => {
    if (visible.has(start)) return;
    visible.add(start);
    depth.set(start, 0);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift() as string; // non-empty: checked by the loop condition
      if (collapsed.has(id)) continue;
      for (const c of childrenOf(id)) {
        if (visible.has(c)) continue;
        visible.add(c);
        spanParent.set(c, id);
        depth.set(c, (depth.get(id) ?? 0) + 1);
        queue.push(c);
      }
    }
  };
  for (const s of starts) visit(s);
  // Nodes unreachable from any start (only possible in a cycle) that aren't hidden by a collapse.
  const reachableAll = new Set<string>();
  const walk = (id: string) => {
    if (reachableAll.has(id)) return;
    reachableAll.add(id);
    for (const c of childrenOf(id)) walk(c);
  };
  for (const s of starts) walk(s);
  for (const id of allIds.sort(byFirstSeen)) if (!reachableAll.has(id)) visit(id);

  const hiddenBelow = (id: string): number => {
    const seen = new Set<string>();
    const stack = childrenOf(id);
    while (stack.length > 0) {
      const c = stack.pop() as string; // non-empty: checked by the loop condition
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(...childrenOf(c));
    }
    return [...seen].filter((c) => !visible.has(c)).length;
  };

  // Tidy layout: each leaf takes the next row; a parent sits at the middle of its children.
  const spanChildren = new Map<string, string[]>();
  for (const [child, parent] of spanParent) {
    spanChildren.set(parent, [...(spanChildren.get(parent) ?? []), child]);
  }
  const y = new Map<string, number>();
  let row = 0;
  const place = (id: string): number => {
    const kids = (spanChildren.get(id) ?? []).sort(byFirstSeen);
    if (kids.length === 0) {
      y.set(id, row);
      row += 1;
      return row - 1;
    }
    const ys = kids.map(place);
    const mid = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2;
    y.set(id, mid);
    return mid;
  };
  for (const id of [...visible].filter((v) => !spanParent.has(v))) place(id);

  const nodes: SessionNode[] = [...visible].map((id) => {
    const n = byId.get(id) as SessionTreeDto['nodes'][number]; // visible ⊆ byId keys
    return {
      id,
      type: 'session',
      position: { x: (depth.get(id) ?? 0) * X_GAP, y: (y.get(id) ?? 0) * Y_GAP },
      data: {
        session: n.session,
        aggregateUsage: n.aggregateUsage,
        parent: incoming.has(id) ? 'known' : 'unknown',
        isRoot: id === tree.rootId,
        isFocus: id === focusId,
        childEdgeCount: out.get(id)?.length ?? 0,
        collapsed: collapsed.has(id),
        hiddenDescendants: hiddenBelow(id),
      },
    };
  });

  const graphEdges: SessionGraphEdge[] = edges
    .filter((e) => visible.has(e.parentId) && visible.has(e.childId))
    .map((e) => ({
      id: `${e.kind}:${e.parentId}->${e.childId}`,
      source: e.parentId,
      target: e.childId,
      // Straight segments with square corners, as in the logo's connectors.
      type: 'step',
      className: `edge-${e.kind}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STYLE[e.kind].stroke },
      style: {
        stroke: EDGE_STYLE[e.kind].stroke,
        strokeWidth: 1.5,
        ...(EDGE_STYLE[e.kind].dash ? { strokeDasharray: EDGE_STYLE[e.kind].dash } : {}),
      },
      ariaLabel: EDGE_LABEL[e.kind],
      data: { kind: e.kind, provenance: e.provenance, evidence: e.evidence },
    }));

  return { nodes, edges: graphEdges, danglingEdges: tree.edges.length - edges.length };
}
