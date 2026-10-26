import type {
  NodePosition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
} from '@acp/core';
import { rowOf, sizeOf } from './layout';

/**
 * How the editor draws each link (v0.3.0 D-C): which side of each block it leaves and enters by,
 * and an orthogonal route with its own lane, so links cross as little as possible. Pure, so it is
 * tested without a canvas; the canvas's edge view (`edges.tsx`) draws the same route from the
 * handles' live positions, so a moved block keeps its links tidy.
 *
 * - **Forward links in a row** join side to side (right edge → left edge).
 * - **Links between rows** leave by the bottom or top and run along a lane in the gap between the
 *   rows; links that share a gap get different lanes.
 * - **Links that go back in a row** loop: findings and reviews over the top, rework underneath.
 *   Each loop in a row gets its own height.
 * - Blocks have hidden handles at 15, 30, 50, 70 and 85% of their top and bottom edges, so links
 *   that meet a block keep apart (the lead's merge leaves at 50%, its rework at 85%, findings come
 *   in at 85% of its top).
 *
 * Lanes: for each group (a gap between two rows, the loops over or under one row) every order of
 * its links over the group's lanes is tried, and the one with the fewest crossings with the links
 * already placed wins (the first such order on ties, so the drawing is deterministic).
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type RouteKind = 'side' | 'corridor' | 'loop-top' | 'loop-bottom';

export interface Route {
  kind: RouteKind;
  /** Side and corridor: the shift from the midpoint; loops: how far out the loop runs. */
  lane: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Positions of the hidden top and bottom handles, in percent of the block's width. */
export const HANDLE_SPOTS = [15, 30, 50, 70, 85] as const;
export type Spot = (typeof HANDLE_SPOTS)[number];

/** A hidden handle's id: `s-top-50` (a link leaves there) or `t-bottom-30` (one arrives). */
export function handleId(kind: 'source' | 'target', side: 'top' | 'bottom', at: Spot): string {
  return `${kind === 'source' ? 's' : 't'}-${side}-${at}`;
}

/** The stored ends of a forward link in a row: `out` (the right connector) and `in` (the left edge). */
export const OUT_HANDLE = 'out';
export const IN_HANDLE = 'in';

export interface PlannedLink {
  id: string;
  sourceHandle: string;
  targetHandle: string;
  route: Route;
}

interface End {
  side: Side;
  at: Spot | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LOOP_TOP = { first: 18, step: 12 };
const LOOP_BOTTOM = { first: 18, step: 16 };
const CORRIDOR_STEP = 14;
/** More than this many links in one group are not reordered (n! orders). */
const MAX_PERMUTED = 6;

function rectOf(
  node: WorkflowNode,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
): Rect | undefined {
  const p = positions.get(node.id);
  if (p === undefined) return undefined;
  const { width, height } = sizeOf(node);
  return { x: p.x, y: p.y, w: width, h: height };
}

function endPoint(r: Rect, end: End): Point {
  switch (end.side) {
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case 'left':
      return { x: r.x, y: r.y + r.h / 2 };
    case 'top':
      return { x: r.x + (r.w * (end.at ?? 50)) / 100, y: r.y };
    case 'bottom':
      return { x: r.x + (r.w * (end.at ?? 50)) / 100, y: r.y + r.h };
  }
}

function idOf(kind: 'source' | 'target', end: End): string {
  if (end.side === 'right') return OUT_HANDLE;
  if (end.side === 'left') return IN_HANDLE;
  return handleId(kind, end.side, end.at ?? 50);
}

/** Which sides a link leaves and enters by, and the kind of route between them. */
export function linkShape(
  e: WorkflowEdge,
  from: WorkflowNode,
  to: WorkflowNode,
  a: Rect,
  b: Rect,
): { source: End; target: End; kind: RouteKind } {
  const ra = rowOf(from);
  const rb = rowOf(to);
  const toRight = b.x + b.w / 2 >= a.x + a.w / 2;
  if (ra === rb) {
    if (e.type === 'rework') {
      // Underneath, leaving and entering on the sides that face each other.
      return {
        source: { side: 'bottom', at: toRight ? 85 : 15 },
        target: { side: 'bottom', at: toRight ? 15 : 85 },
        kind: 'loop-bottom',
      };
    }
    if (b.x >= a.x + a.w - 1) {
      return {
        source: { side: 'right', at: null },
        target: { side: 'left', at: null },
        kind: 'side',
      };
    }
    if (b.y >= a.y + a.h - 1) {
      return {
        source: { side: 'bottom', at: 50 },
        target: { side: 'top', at: 50 },
        kind: 'corridor',
      };
    }
    if (b.y + b.h <= a.y + 1) {
      return {
        source: { side: 'top', at: 50 },
        target: { side: 'bottom', at: 50 },
        kind: 'corridor',
      };
    }
    // Back to a block on the left (findings, a review sent to the lead): over the top.
    return {
      source: { side: 'top', at: 50 },
      target: { side: 'top', at: toRight ? 15 : 85 },
      kind: 'loop-top',
    };
  }
  if (rb > ra) {
    return {
      source: { side: 'bottom', at: e.type === 'rework' ? (toRight ? 85 : 15) : 50 },
      target: { side: 'top', at: 50 },
      kind: 'corridor',
    };
  }
  // Up to an earlier row: off-centre on the sides that face each other, clear of the 50% lines.
  return {
    source: { side: 'top', at: toRight ? 70 : 30 },
    target: { side: 'bottom', at: toRight ? 30 : 70 },
    kind: 'corridor',
  };
}

/** The route's corner points from `s` to `t` (straight when the two ends line up). */
export function routePoints(s: Point, t: Point, route: Route): Point[] {
  switch (route.kind) {
    case 'loop-top': {
      const y = Math.min(s.y, t.y) - route.lane;
      return [s, { x: s.x, y }, { x: t.x, y }, t];
    }
    case 'loop-bottom': {
      const y = Math.max(s.y, t.y) + route.lane;
      return [s, { x: s.x, y }, { x: t.x, y }, t];
    }
    case 'corridor': {
      if (Math.abs(s.x - t.x) < 0.5) return [s, t];
      const y = (s.y + t.y) / 2 + route.lane;
      return [s, { x: s.x, y }, { x: t.x, y }, t];
    }
    case 'side': {
      if (Math.abs(s.y - t.y) < 0.5) return [s, t];
      const x = (s.x + t.x) / 2 + route.lane;
      return [s, { x, y: s.y }, { x, y: t.y }, t];
    }
  }
}

/** An SVG path through the points (square corners, DESIGN.md "Agent views"). */
export function pathOf(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Where a link's label sits: the middle of its middle segment. */
export function labelPoint(points: readonly Point[]): Point {
  const i = Math.max(0, Math.floor((points.length - 1) / 2));
  const a = points[i] ?? { x: 0, y: 0 };
  const b = points[i + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ---------------------------------------------------------------- crossings

interface Segment {
  a: Point;
  b: Point;
}

function segmentsOf(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a !== undefined && b !== undefined) out.push({ a, b });
  }
  return out;
}

const EPS = 0.5;
const inside = (v: number, lo: number, hi: number) =>
  v > Math.min(lo, hi) + EPS && v < Math.max(lo, hi) - EPS;

/** 1 when a horizontal and a vertical segment cross in their insides, or two collinear overlap. */
function conflict(p: Segment, q: Segment): number {
  const pH = Math.abs(p.a.y - p.b.y) < EPS;
  const qH = Math.abs(q.a.y - q.b.y) < EPS;
  if (pH && !qH) return inside(q.a.x, p.a.x, p.b.x) && inside(p.a.y, q.a.y, q.b.y) ? 1 : 0;
  if (!pH && qH) return conflict(q, p);
  if (pH && qH) {
    if (Math.abs(p.a.y - q.a.y) >= EPS) return 0;
    const lo = Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
    const hi = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x));
    return hi - lo > 2 ? 1 : 0;
  }
  if (Math.abs(p.a.x - q.a.x) >= EPS) return 0;
  const lo = Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
  const hi = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y));
  return hi - lo > 2 ? 1 : 0;
}

interface Drawn {
  id: string;
  points: Point[];
  /** Links that share an end handle may share a segment there (a fork), which is no conflict. */
  ends: string[];
}

function conflicts(x: Drawn, y: Drawn): number {
  if (x.ends.some((e) => y.ends.includes(e))) {
    // A fork: only true crossings count, not the shared stretch from the handle.
    let n = 0;
    for (const p of segmentsOf(x.points)) {
      for (const q of segmentsOf(y.points)) {
        const pH = Math.abs(p.a.y - p.b.y) < EPS;
        const qH = Math.abs(q.a.y - q.b.y) < EPS;
        if (pH !== qH) n += conflict(p, q);
      }
    }
    return n;
  }
  let n = 0;
  for (const p of segmentsOf(x.points)) for (const q of segmentsOf(y.points)) n += conflict(p, q);
  return n;
}

/** How many times links cross or run over each other (for tests and the lane choice). */
export function countConflicts(drawn: readonly Drawn[]): number {
  let n = 0;
  for (let i = 0; i < drawn.length; i += 1) {
    for (let j = i + 1; j < drawn.length; j += 1) {
      const x = drawn[i];
      const y = drawn[j];
      if (x !== undefined && y !== undefined) n += conflicts(x, y);
    }
  }
  return n;
}

function permutations(n: number): number[][] {
  if (n <= 1) return [Array.from({ length: n }, (_, i) => i)];
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    rest.forEach((r, i) => walk([...prefix, r], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  walk(
    [],
    Array.from({ length: n }, (_, i) => i),
  );
  return out;
}

function lanesFor(kind: RouteKind, n: number): number[] {
  switch (kind) {
    case 'loop-top':
      return Array.from({ length: n }, (_, i) => LOOP_TOP.first + i * LOOP_TOP.step);
    case 'loop-bottom':
      return Array.from({ length: n }, (_, i) => LOOP_BOTTOM.first + i * LOOP_BOTTOM.step);
    case 'corridor':
      return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * CORRIDOR_STEP);
    case 'side':
      return Array.from({ length: n }, () => 0);
  }
}

interface Pending {
  edge: WorkflowEdge;
  source: End;
  target: End;
  kind: RouteKind;
  s: Point;
  t: Point;
  group: string;
  /** Corridors: the shift that puts the lane in the middle of the gap between the two rows. */
  base: number;
}

/** Each row's vertical extent: from its highest block's top to its lowest block's bottom. */
function rowBands(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
): Map<number, { top: number; bottom: number }> {
  const bands = new Map<number, { top: number; bottom: number }>();
  for (const node of graph.nodes) {
    const r = rectOf(node, positions);
    if (r === undefined) continue;
    const row = rowOf(node);
    const band = bands.get(row);
    bands.set(row, {
      top: Math.min(band?.top ?? Infinity, r.y),
      bottom: Math.max(band?.bottom ?? -Infinity, r.y + r.h),
    });
  }
  return bands;
}

/**
 * Every link's handles and route for the blocks at `positions`. Links whose blocks are missing
 * (a refused link to an unknown block) get the side handles and no lane.
 */
export function planLinks(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
): Map<string, PlannedLink> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, PlannedLink>();
  const pending: Pending[] = [];
  const bands = rowBands(graph, positions);
  for (const e of graph.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    const a = from === undefined ? undefined : rectOf(from, positions);
    const b = to === undefined ? undefined : rectOf(to, positions);
    if (from === undefined || to === undefined || a === undefined || b === undefined) {
      out.set(e.id, {
        id: e.id,
        sourceHandle: OUT_HANDLE,
        targetHandle: IN_HANDLE,
        route: { kind: 'side', lane: 0 },
      });
      continue;
    }
    const shape = linkShape(e, from, to, a, b);
    const ra = rowOf(from);
    const rb = rowOf(to);
    const group =
      shape.kind === 'loop-top'
        ? `top-${ra}`
        : shape.kind === 'loop-bottom'
          ? `bottom-${ra}`
          : shape.kind === 'corridor'
            ? `gap-${Math.min(ra, rb)}-${Math.max(ra, rb)}`
            : 'side';
    const s = endPoint(a, shape.source);
    const t = endPoint(b, shape.target);
    // A link between rows runs along the middle of the gap between them, not the middle of its
    // own two ends: an end on a stacked block would otherwise put the lane across the stack.
    const upper = bands.get(Math.min(ra, rb));
    const lower = bands.get(Math.max(ra, rb));
    const base =
      shape.kind === 'corridor' && ra !== rb && upper !== undefined && lower !== undefined
        ? (upper.bottom + lower.top) / 2 - (s.y + t.y) / 2
        : 0;
    pending.push({ edge: e, ...shape, s, t, group, base });
  }

  const ends = (p: Pending) => [
    `${p.edge.from}:${idOf('source', p.source)}`,
    `${p.edge.to}:${idOf('target', p.target)}`,
  ];
  const placed: Drawn[] = [];
  const finish = (p: Pending, lane: number) => {
    const route: Route = { kind: p.kind, lane };
    placed.push({ id: p.edge.id, points: routePoints(p.s, p.t, route), ends: ends(p) });
    out.set(p.edge.id, {
      id: p.edge.id,
      sourceHandle: idOf('source', p.source),
      targetHandle: idOf('target', p.target),
      route,
    });
  };

  // Side links first (their lane is fixed), then each group in a fixed order.
  for (const p of pending.filter((x) => x.group === 'side')) finish(p, 0);
  const groups = [...new Set(pending.filter((x) => x.group !== 'side').map((x) => x.group))].sort();
  for (const group of groups) {
    const members = pending.filter((x) => x.group === group);
    const kind = members[0]?.kind ?? 'side';
    // Links that run straight need no lane; the others share the group's lanes.
    const bending = members.filter((m) => kind !== 'corridor' || Math.abs(m.s.x - m.t.x) >= EPS);
    for (const m of members.filter((x) => !bending.includes(x))) finish(m, 0);
    const lanes = lanesFor(kind, bending.length);
    const orders =
      bending.length <= MAX_PERMUTED ? permutations(bending.length) : [bending.map((_, i) => i)];
    let best = orders[0] ?? [];
    let bestScore = Infinity;
    for (const order of orders) {
      const drawn = bending.map((m, i) => ({
        id: m.edge.id,
        points: routePoints(m.s, m.t, { kind, lane: m.base + (lanes[order[i] ?? i] ?? 0) }),
        ends: ends(m),
      }));
      let score = countConflicts(drawn);
      for (const d of drawn) for (const q of placed) score += conflicts(d, q);
      if (score < bestScore) {
        bestScore = score;
        best = order;
      }
    }
    bending.forEach((m, i) => finish(m, m.base + (lanes[best[i] ?? i] ?? 0)));
  }
  return out;
}

/** The drawn routes of a plan, for tests that count crossings. */
export function drawnLinks(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
  plan: ReadonlyMap<string, PlannedLink> = planLinks(graph, positions),
): Drawn[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: Drawn[] = [];
  for (const e of graph.edges) {
    const link = plan.get(e.id);
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    const a = from === undefined ? undefined : rectOf(from, positions);
    const b = to === undefined ? undefined : rectOf(to, positions);
    if (link === undefined || from === undefined || to === undefined || !a || !b) continue;
    const shape = linkShape(e, from, to, a, b);
    out.push({
      id: e.id,
      points: routePoints(endPoint(a, shape.source), endPoint(b, shape.target), link.route),
      ends: [`${e.from}:${link.sourceHandle}`, `${e.to}:${link.targetHandle}`],
    });
  }
  return out;
}
