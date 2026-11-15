import type {
  NodePosition,
  WorkflowEdgeV3,
  WorkflowGraphV3,
  WorkflowNodeId,
  WorkflowNodeV3,
} from '@acp/core';
import { columnIndexOf, sizeOf } from './layout';

type WorkflowEdge = WorkflowEdgeV3;
type WorkflowGraph = WorkflowGraphV3;
type WorkflowNode = WorkflowNodeV3;

/**
 * How the editor draws each link (v0.3.0 D-C): which side of each block it leaves and enters by,
 * and an orthogonal route with its own lane, so links cross as little as possible. Pure, so it is
 * tested without a canvas; the canvas's edge view (`edges.tsx`) draws the same route from the
 * handles' live positions, so a moved block keeps its links tidy.
 *
 * - **Forward links in a row** join side to side (right edge → left edge); several that bend in one
 *   row get different lanes.
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
 *
 * Labels: placed after the routes, on the first spot along the link (the middle of its longest
 * run first) that covers no block and no label placed before it, so two labelled links between
 * the same blocks never stack their labels.
 *
 * ADR-0040: the blocks stand in stage columns, left to right (`layout.ts`). The planner works on
 * the canvas turned on its side (x and y swapped, `flip`): a column is a "row" above, so a forward
 * link to a later column runs right through a lane in the gap between the columns, a link back to
 * an earlier column runs left in its own lane, and the loops of a column go round its sides. The
 * handles are named on the real canvas (left and right spots too), and the routes carry `flip`, so
 * the canvas turns their points back.
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type RouteKind = 'side' | 'corridor' | 'loop-top' | 'loop-bottom' | 'detour';

export interface Route {
  kind: RouteKind;
  /** Side and corridor: the shift from the midpoint; loops: how far out the loop runs. */
  lane: number;
  /** Where the label sits: a segment of the route and how far along it (0 to 1). */
  labelAt?: { segment: number; t: number };
  /** ADR-0040: planned on the canvas turned on its side; its points are turned back to draw. */
  flip?: boolean;
  /**
   * ADR-0040, `detour` routes: a link that skips rows with blocks in its way leaves along the gap
   * after its source (`from`), runs round the rows between at `level`, and arrives along the gap
   * before its target (`to`); planner coordinates.
   */
  detour?: { from: number; to: number; level: number };
  /**
   * ADR-0040: how far each end sits from its hidden handle along the block's side (planner
   * coordinates), so the links meeting one side are spaced out evenly, not only at the handles.
   */
  shift?: { source: number; target: number };
}

export interface Point {
  x: number;
  y: number;
}

/** Positions of the hidden handles on each side, in percent of the block's width or height. */
export const HANDLE_SPOTS = [15, 30, 50, 70, 85] as const;
export type Spot = (typeof HANDLE_SPOTS)[number];

/** A hidden handle's id: `s-top-50` (a link leaves there) or `t-left-30` (one arrives). */
export function handleId(kind: 'source' | 'target', side: Side, at: Spot): string {
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
  /** Percent along the side (any value: `spreadEnds` spaces them out); null: a side's middle. */
  at: number | null;
}

/** The hidden handle closest to a spot along a side. */
function nearestSpot(at: number): Spot {
  let best: Spot = 50;
  for (const s of HANDLE_SPOTS) if (Math.abs(s - at) < Math.abs(best - at)) best = s;
  return best;
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
const SIDE_STEP = 14;
/** Detours round the same rows keep this far apart, and this far out from the blocks. */
const DETOUR_STEP = 10;
const DETOUR_MARGIN = 28;
/** A detour turns this far from the blocks it leaves and reaches. */
const EDGE_LANE = 8;
/** How far further out the detour on the first lane turns (each later lane turns closer). */
const DETOUR_SPAN = DETOUR_STEP;

/**
 * A detour on its lane: detours below the same rows keep apart, and the one that runs lower turns
 * closer to the blocks, so two of them leaving one side never cross.
 */
function laneDetour(
  d: { from: number; to: number; level: number },
  lane: number,
): { from: number; to: number; level: number } {
  const out = Math.max(0, DETOUR_SPAN - lane);
  const dir = d.from < d.to ? 1 : -1;
  return { from: d.from + dir * out, to: d.to - dir * out, level: d.level + lane };
}
/** A label's box for placement: a 12px label is about this wide per character, plus padding. */
const LABEL_CHAR_W = 6.6;
const LABEL_PAD_W = 20;
const LABEL_H = 20;
const LABEL_GAP = 4;
/** More than this many links in one group are not reordered (n! orders). */
const MAX_PERMUTED = 6;

/** A point of the canvas turned on its side, and back (the same swap). */
const turn = (p: Point): Point => ({ x: p.y, y: p.x });

/** A block's box on the canvas turned on its side (`flip`), where the planner works. */
function rectOf(
  node: WorkflowNode,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
): Rect | undefined {
  const p = positions.get(node.id);
  if (p === undefined) return undefined;
  const { width, height } = sizeOf(node);
  return { x: p.y, y: p.x, w: height, h: width };
}

/** A block's box on the real canvas, for labels. */
function realRectOf(
  node: WorkflowNode,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
): Rect | undefined {
  const p = positions.get(node.id);
  if (p === undefined) return undefined;
  const { width, height } = sizeOf(node);
  return { x: p.x, y: p.y, w: width, h: height };
}

/** A side of the turned canvas on the real one: its top is the real left, its right the bottom. */
const REAL_SIDE: Readonly<Record<Side, Side>> = {
  top: 'left',
  bottom: 'right',
  left: 'top',
  right: 'bottom',
};

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

/** The real handle an end of the turned canvas meets (a turned side's middle is spot 50). */
function idOf(kind: 'source' | 'target', end: End): string {
  return handleId(kind, REAL_SIDE[end.side], nearestSpot(end.at ?? 50));
}

/** The end at the hidden handle `idOf` names, which the canvas measures. */
function spotEnd(end: End): End {
  return end.at === null ? end : { side: end.side, at: nearestSpot(end.at) };
}

/** Which sides a link leaves and enters by, and the kind of route between them. */
export function linkShape(
  e: WorkflowEdge,
  from: WorkflowNode,
  to: WorkflowNode,
  a: Rect,
  b: Rect,
  rows: ReadonlyMap<WorkflowNodeId, number>,
): { source: End; target: End; kind: RouteKind } {
  const ra = rows.get(from.id) ?? 0;
  const rb = rows.get(to.id) ?? 0;
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
    // ADR-0040: a rework runs low on both blocks, apart from the work line through the middle.
    const at = e.type === 'rework' ? 85 : 50;
    return {
      source: { side: 'bottom', at },
      target: { side: 'top', at },
      kind: 'corridor',
    };
  }
  // Back to an earlier row (a review, findings, a When route): high on both blocks, apart from the
  // work line through the middle and the rework below it.
  return {
    source: { side: 'top', at: 30 },
    target: { side: 'bottom', at: 30 },
    kind: 'corridor',
  };
}

/**
 * The route's corner points from `s` to `t` (straight when the two ends line up), on the real
 * canvas: a `flip` route is laid out on the canvas turned on its side and turned back.
 */
export function routePoints(s: Point, t: Point, route: Route): Point[] {
  if (route.flip !== true) return rawRoutePoints(s, t, route);
  const a = turn(s);
  const b = turn(t);
  const shift = route.shift ?? { source: 0, target: 0 };
  return rawRoutePoints(
    { x: a.x + shift.source, y: a.y },
    { x: b.x + shift.target, y: b.y },
    route,
  ).map(turn);
}

/** The route's corner points in the frame the route was planned in. */
function rawRoutePoints(s: Point, t: Point, route: Route): Point[] {
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
    case 'detour': {
      const d = route.detour;
      if (d === undefined) return [s, t];
      return [
        s,
        { x: s.x, y: d.from },
        { x: d.level, y: d.from },
        { x: d.level, y: d.to },
        { x: t.x, y: d.to },
        t,
      ];
    }
  }
}

/** An SVG path through the points (square corners, DESIGN.md "Agent views"). */
export function pathOf(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Where a link's label sits: the planned spot when the route still has that segment (a dragged
 * block can straighten a route), otherwise the middle of its middle segment.
 */
export function labelPoint(points: readonly Point[], at?: Route['labelAt']): Point {
  const planned = at !== undefined && points[at.segment + 1] !== undefined ? at : undefined;
  const i = planned?.segment ?? Math.max(0, Math.floor((points.length - 1) / 2));
  const t = planned?.t ?? 0.5;
  const a = points[i] ?? { x: 0, y: 0 };
  const b = points[i + 1] ?? a;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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
      return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * SIDE_STEP);
    case 'detour':
      return Array.from({ length: n }, (_, i) => i * DETOUR_STEP);
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
  /** Detours: the two gaps and the level round the rows between (planner coordinates). */
  detour?: { from: number; to: number; level: number };
  /** The two blocks' boxes (planner coordinates), to measure each end's shift from its handle. */
  ar: Rect;
  br: Rect;
}

/**
 * The gaps a link from row `ra` to row `rb` can run in, as their middles: the one just before the
 * target's row first, then the one just after the source's (the same gap for neighbouring rows).
 */
function gapsBetween(
  bands: ReadonlyMap<number, { top: number; bottom: number }>,
  ra: number,
  rb: number,
): { mid: number; after: number }[] {
  const rows = [...bands.keys()].sort((x, y) => x - y);
  const lo = Math.min(ra, rb);
  const hi = Math.max(ra, rb);
  const between = rows.filter((r) => r >= lo && r <= hi);
  const gap = (i: number) => {
    const a = between[i];
    const b = between[i + 1];
    const ba = a === undefined ? undefined : bands.get(a);
    const bb = b === undefined ? undefined : bands.get(b);
    return a === undefined || ba === undefined || bb === undefined
      ? undefined
      : { mid: (ba.bottom + bb.top) / 2, after: a };
  };
  const last = between.length - 2;
  // Towards the target: for a link going down that is the last gap, going up the first.
  const nearTarget = rb > ra ? gap(last) : gap(0);
  const nearSource = rb > ra ? gap(0) : gap(last);
  return [nearTarget, nearSource].filter(
    (g, i, all): g is { mid: number; after: number } =>
      g !== undefined && all.findIndex((x) => x?.after === g.after) === i,
  );
}

/** Whether a route runs through a block other than its own two ends. */
function crossesBlocks(
  points: readonly Point[],
  blocks: readonly { id: string; r: Rect }[],
  ends: readonly string[],
): boolean {
  for (const seg of segmentsOf(points)) {
    const x1 = Math.min(seg.a.x, seg.b.x);
    const x2 = Math.max(seg.a.x, seg.b.x);
    const y1 = Math.min(seg.a.y, seg.b.y);
    const y2 = Math.max(seg.a.y, seg.b.y);
    for (const { id, r } of blocks) {
      if (ends.includes(id)) continue;
      if (x2 > r.x + 1 && x1 < r.x + r.w - 1 && y2 > r.y + 1 && y1 < r.y + r.h - 1) return true;
    }
  }
  return false;
}

/** Each row's extent (a column's, on the turned canvas): from its first block to its last. */
function rowBands(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
  rows: ReadonlyMap<WorkflowNodeId, number>,
): Map<number, { top: number; bottom: number }> {
  const bands = new Map<number, { top: number; bottom: number }>();
  for (const node of graph.nodes) {
    const r = rectOf(node, positions);
    if (r === undefined) continue;
    const row = rows.get(node.id) ?? 0;
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
 * (a refused link to an unknown block) get the side handles and no lane. `rows` are the blocks'
 * columns (`columnIndexOf`) of the stored graph: the drawn graph (the Finish view) redraws the
 * final chain's links. `labels` are the links' label texts, placed so they cover no block and no
 * other label.
 */
export function planLinks(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
  rows: ReadonlyMap<WorkflowNodeId, number> = columnIndexOf(graph),
  labels: ReadonlyMap<string, string> = new Map(),
): Map<string, PlannedLink> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, PlannedLink>();
  const pending: Pending[] = [];
  const bands = rowBands(graph, positions, rows);
  const blocks = graph.nodes.flatMap((n) => {
    const r = rectOf(n, positions);
    return r === undefined ? [] : [{ id: n.id, r }];
  });
  const shaped: {
    e: WorkflowEdge;
    from: WorkflowNode;
    to: WorkflowNode;
    a: Rect;
    b: Rect;
    shape: ReturnType<typeof linkShape>;
  }[] = [];
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
    shaped.push({ e, from, to, a, b, shape: linkShape(e, from, to, a, b, rows) });
  }
  // The links that will go round the rows they skip (no gap between gets them through clear).
  const detours = new Set(
    shaped
      .filter(({ e, a, b, shape }) => {
        const ra = rows.get(e.from) ?? 0;
        const rb = rows.get(e.to) ?? 0;
        if (shape.kind !== 'corridor' || Math.abs(ra - rb) < 2) return false;
        const s = endPoint(a, shape.source);
        const t = endPoint(b, shape.target);
        return gapsBetween(bands, ra, rb).every((g) =>
          crossesBlocks(
            rawRoutePoints(s, t, { kind: 'corridor', lane: g.mid - (s.y + t.y) / 2 }),
            blocks,
            [e.from, e.to],
          ),
        );
      })
      .map(({ e }) => e.id),
  );
  spreadEnds(shaped, detours);
  for (const { e, from, to, a, b, shape } of shaped) {
    const ra = rows.get(from.id) ?? 0;
    const rb = rows.get(to.id) ?? 0;
    const group =
      shape.kind === 'loop-top'
        ? `top-${ra}`
        : shape.kind === 'loop-bottom'
          ? `bottom-${ra}`
          : shape.kind === 'corridor'
            ? `gap-${Math.min(ra, rb)}-${Math.max(ra, rb)}`
            : `side-${ra}`;
    const s = endPoint(a, shape.source);
    const t = endPoint(b, shape.target);
    // A link between rows runs along the middle of a gap between them, not the middle of its
    // own two ends: an end on a stacked block would otherwise put the lane across the stack. A
    // link that skips a row (a column, on the canvas) takes the gap just before its target, or
    // just after its source when that one crosses no block, never the middle of a row it skips.
    let base = 0;
    let lanes = group;
    let kind: RouteKind = shape.kind;
    let detour: Pending['detour'];
    if (shape.kind === 'corridor' && ra !== rb) {
      const gaps = gapsBetween(bands, ra, rb);
      const pick =
        gaps.find(
          (g) =>
            !crossesBlocks(
              rawRoutePoints(s, t, { kind: 'corridor', lane: g.mid - (s.y + t.y) / 2 }),
              blocks,
              [e.from, e.to],
            ),
        ) ?? gaps[0];
      // Decided before the ends were spread out (`detours`), so the ends and the route agree.
      const clear = !detours.has(e.id);
      const near = gaps[0];
      const far = gaps[gaps.length - 1];
      if (!clear && near !== undefined && far !== undefined && gaps.length > 1) {
        // Every lane runs through a block of a row it skips: go round the rows between.
        const between = blocks.filter(({ id }) => {
          const row = rows.get(id) ?? 0;
          return row > Math.min(ra, rb) && row < Math.max(ra, rb);
        });
        const lo = Math.min(...between.map((b) => b.r.x));
        const hi = Math.max(...between.map((b) => b.r.x + b.r.w));
        const mid = (s.x + t.x) / 2;
        // Below the rows between, where its ends sit (`spreadEnds`).
        const level = Math.max(hi, lo) + DETOUR_MARGIN;
        kind = 'detour';
        // Down close to the source's row, up close to the target's: clear of the lanes in the
        // middle of those gaps, and of the links above it on its two sides (`spreadEnds`).
        const sourceBand = bands.get(ra);
        const targetBand = bands.get(rb);
        const down = rb > ra;
        const from =
          sourceBand === undefined
            ? far.mid
            : down
              ? sourceBand.bottom + EDGE_LANE
              : sourceBand.top - EDGE_LANE;
        const to =
          targetBand === undefined
            ? near.mid
            : down
              ? targetBand.top - EDGE_LANE
              : targetBand.bottom + EDGE_LANE;
        detour = { from, to, level };
        lanes = `detour-${level < mid ? 'low' : 'high'}`;
      } else if (pick !== undefined) {
        base = pick.mid - (s.y + t.y) / 2;
        lanes = `gap-${pick.after}`;
      }
    }
    pending.push({
      edge: e,
      ...shape,
      ar: a,
      br: b,
      kind,
      s,
      t,
      group: lanes,
      base,
      ...(detour !== undefined ? { detour } : {}),
    });
  }

  const ends = (p: Pending) => [
    `${p.edge.from}:${idOf('source', p.source)}`,
    `${p.edge.to}:${idOf('target', p.target)}`,
  ];
  const placed: Drawn[] = [];
  const finish = (p: Pending, lane: number) => {
    // A side lane stays inside the gap between the two blocks.
    const room = Math.max(0, Math.abs(p.t.x - p.s.x) / 2 - 8);
    const shift = {
      source: p.s.x - endPoint(p.ar, spotEnd(p.source)).x,
      target: p.t.x - endPoint(p.br, spotEnd(p.target)).x,
    };
    const route: Route = {
      kind: p.kind,
      lane: p.kind === 'side' ? Math.max(-room, Math.min(room, lane)) : lane,
      flip: true,
      ...(Math.abs(shift.source) > 0.05 || Math.abs(shift.target) > 0.05 ? { shift } : {}),
      ...(p.detour !== undefined ? { detour: laneDetour(p.detour, lane) } : {}),
    };
    placed.push({ id: p.edge.id, points: rawRoutePoints(p.s, p.t, route), ends: ends(p) });
    out.set(p.edge.id, {
      id: p.edge.id,
      sourceHandle: idOf('source', p.source),
      targetHandle: idOf('target', p.target),
      route,
    });
  };

  // Each group in a fixed order: the side links of each row first, then the gaps and loops.
  const isSide = (g: string) => g.startsWith('side-');
  const groups = [...new Set(pending.map((x) => x.group))].sort(
    (x, y) => Number(isSide(y)) - Number(isSide(x)) || x.localeCompare(y),
  );
  for (const group of groups) {
    const members = pending.filter((x) => x.group === group);
    const kind = members[0]?.kind ?? 'side';
    // Links that run straight need no lane; the others share the group's lanes.
    const straight = (m: Pending) =>
      (kind === 'corridor' && Math.abs(m.s.x - m.t.x) < EPS) ||
      (kind === 'side' && Math.abs(m.s.y - m.t.y) < EPS);
    const bending = members.filter((m) => !straight(m));
    for (const m of members.filter((x) => !bending.includes(x))) finish(m, 0);
    const lanes = lanesFor(kind, bending.length);
    const orders =
      bending.length <= MAX_PERMUTED
        ? permutations(bending.length)
        : [greedyOrder(bending, lanes, kind, placed, ends)];
    let best = orders[0] ?? [];
    let bestScore = Infinity;
    for (const order of orders) {
      const drawn = bending.map((m, i) => {
        const lane = m.base + (lanes[order[i] ?? i] ?? 0);
        const d = m.detour;
        const route: Route =
          d === undefined ? { kind, lane } : { kind, lane, detour: laneDetour(d, lane) };
        return { id: m.edge.id, points: rawRoutePoints(m.s, m.t, route), ends: ends(m) };
      });
      let score = countConflicts(drawn);
      for (const d of drawn) for (const q of placed) score += conflicts(d, q);
      if (score < bestScore) {
        bestScore = score;
        best = order;
      }
    }
    bending.forEach((m, i) => finish(m, m.base + (lanes[best[i] ?? i] ?? 0)));
  }
  placeLabels(graph, positions, pending, out, labels);
  return out;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlapArea = (p: Box, q: Box) =>
  Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) *
  Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));

/** The box a label takes centred on `at`; with `gap`, the small margin kept around it. */
function labelBox(text: string, at: Point, gap = LABEL_GAP): Box {
  const w = text.length * LABEL_CHAR_W + LABEL_PAD_W + gap * 2;
  const h = LABEL_H + gap * 2;
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

/**
 * Picks each labelled link's label spot, in link order: along each segment (longest first) at its
 * middle, then nearer its ends, the first spot that covers no block and no earlier label; with no
 * clear spot, the one that covers least.
 */
function placeLabels(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
  pending: readonly Pending[],
  out: Map<string, PlannedLink>,
  labels: ReadonlyMap<string, string>,
): void {
  const blocks = graph.nodes.flatMap((n) => realRectOf(n, positions) ?? []);
  const taken: Box[] = [];
  for (const p of pending) {
    const text = labels.get(p.edge.id);
    const link = out.get(p.edge.id);
    if (text === undefined || link === undefined) continue;
    // Labels are read on the real canvas.
    const points = rawRoutePoints(p.s, p.t, link.route).map(turn);
    const segments = segmentsOf(points)
      .map((seg, i) => ({ i, len: Math.abs(seg.a.x - seg.b.x) + Math.abs(seg.a.y - seg.b.y) }))
      .filter((x) => x.len > 0)
      .sort((x, y) => y.len - x.len || x.i - y.i);
    let best: { segment: number; t: number; box: Box; cost: number } | undefined;
    for (const { i } of segments) {
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const box = labelBox(text, labelPoint(points, { segment: i, t }));
        let cost = 0;
        for (const b of [...blocks, ...taken]) cost += overlapArea(box, b);
        if (best === undefined || cost < best.cost) best = { segment: i, t, box, cost };
        if (cost === 0) break;
      }
      if (best?.cost === 0) break;
    }
    if (best === undefined) continue;
    taken.push(best.box);
    const labelAt = { segment: best.segment, t: best.t };
    out.set(p.edge.id, { ...link, route: { ...link.route, labelAt } });
  }
}

/** How many times a drawn label covers a block, and another label (for tests). */
export function labelOverlaps(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
  labels: ReadonlyMap<string, string>,
  plan: ReadonlyMap<string, PlannedLink> = planLinks(
    graph,
    positions,
    columnIndexOf(graph),
    labels,
  ),
  rows: ReadonlyMap<WorkflowNodeId, number> = columnIndexOf(graph),
): { blocks: number; labels: number } {
  const blocks = graph.nodes.flatMap((n) => realRectOf(n, positions) ?? []);
  const boxes: Box[] = [];
  const count = { blocks: 0, labels: 0 };
  for (const d of drawnLinks(graph, positions, plan, rows)) {
    const text = labels.get(d.id);
    if (text === undefined) continue;
    const box = labelBox(text, labelPoint(d.points, plan.get(d.id)?.route.labelAt), 0);
    count.blocks += blocks.filter((b) => overlapArea(box, b) > 0).length;
    count.labels += boxes.filter((b) => overlapArea(box, b) > 0).length;
    boxes.push(box);
  }
  return count;
}

/** Which links meeting one side of a block sit first: links back above, the work, then rework. */
const END_RANK: Readonly<Record<WorkflowEdge['type'], number>> = {
  review: 0,
  findings: 0,
  when: 0,
  flow: 1,
  plan: 1,
  implement: 1,
  merge: 1,
  test: 1,
  research: 1,
  custom: 1,
  rework: 2,
};

/**
 * ADR-0040: the links meeting one side of a block are spaced out evenly along it, in the order of
 * the blocks at their other ends (and links back, the work, then rework for the same block), so the
 * links to and from one block run as a parallel bundle and no two cross where they meet a block.
 */
function spreadEnds(
  shaped: readonly { e: WorkflowEdge; a: Rect; b: Rect; shape: { source: End; target: End } }[],
  detours: ReadonlySet<string>,
): void {
  const groups = new Map<
    string,
    { other: number; rank: number; skip: number; order: number; set: (at: number) => void }[]
  >();
  shaped.forEach(({ e, a, b, shape }, order) => {
    for (const which of ['source', 'target'] as const) {
      const end = shape[which];
      if (end.side !== 'top' && end.side !== 'bottom') continue;
      const node = which === 'source' ? e.from : e.to;
      const other = which === 'source' ? b : a;
      const key = `${node}:${end.side}`;
      const list = groups.get(key) ?? [];
      list.push({
        other: other.x + other.w / 2,
        rank: END_RANK[e.type],
        // A link that goes round the rows it skips runs below them, so it sits last on its sides.
        skip: detours.has(e.id) ? 1 : 0,
        order,
        set: (at) => {
          shape[which] = { side: end.side, at };
        },
      });
      groups.set(key, list);
    }
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort(
      (x, y) => x.skip - y.skip || x.other - y.other || x.rank - y.rank || x.order - y.order,
    );
    list.forEach((item, i) => item.set(12 + (76 * (i + 0.5)) / list.length));
  }
}

/** Lanes for a group too big to try every order: each link takes the lane that crosses least. */
function greedyOrder(
  members: readonly Pending[],
  lanes: readonly number[],
  kind: RouteKind,
  placed: readonly Drawn[],
  ends: (p: Pending) => string[],
): number[] {
  const free = lanes.map((_, i) => i);
  const drawn: Drawn[] = [...placed];
  const order = members.map((m) => {
    let pick = free[0] ?? 0;
    let least = Infinity;
    for (const i of free) {
      const points = rawRoutePoints(m.s, m.t, { kind, lane: m.base + (lanes[i] ?? 0) });
      const d = { id: m.edge.id, points, ends: ends(m) };
      let n = 0;
      for (const q of drawn) n += conflicts(d, q);
      if (n < least) {
        least = n;
        pick = i;
      }
    }
    free.splice(free.indexOf(pick), 1);
    drawn.push({
      id: m.edge.id,
      points: rawRoutePoints(m.s, m.t, { kind, lane: m.base + (lanes[pick] ?? 0) }),
      ends: ends(m),
    });
    return pick;
  });
  // Then swap two links' lanes while that crosses less.
  const score = (order: readonly number[]) => {
    const list = members.map((m, i) => ({
      id: m.edge.id,
      points: rawRoutePoints(m.s, m.t, { kind, lane: m.base + (lanes[order[i] ?? i] ?? 0) }),
      ends: ends(m),
    }));
    let n = countConflicts(list);
    for (const d of list) for (const q of placed) n += conflicts(d, q);
    return n;
  };
  let best = score(order);
  for (let improved = true; improved && best > 0;) {
    improved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order];
        [next[i], next[j]] = [next[j] ?? 0, next[i] ?? 0];
        const n = score(next);
        if (n < best) {
          best = n;
          order.splice(0, order.length, ...next);
          improved = true;
        }
      }
    }
  }
  return order;
}

/** The end of the turned canvas a stored handle id stands for (`idOf` in reverse). */
function endOf(handle: string): End | undefined {
  if (handle === OUT_HANDLE) return { side: 'bottom', at: 50 };
  if (handle === IN_HANDLE) return { side: 'top', at: 50 };
  const m = /^[st]-(top|bottom|left|right)-(\d+)$/.exec(handle);
  const at = HANDLE_SPOTS.find((x) => String(x) === m?.[2]);
  const real = m?.[1] as Side | undefined;
  if (real === undefined || at === undefined) return undefined;
  const side = (Object.keys(REAL_SIDE) as Side[]).find((k) => REAL_SIDE[k] === real) ?? 'top';
  // A turned side's middle (the real top or bottom) has no spot of its own.
  return { side, at: side === 'left' || side === 'right' ? null : at };
}

/** The drawn routes of a plan, for tests that count crossings. */
export function drawnLinks(
  graph: WorkflowGraph,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
  plan: ReadonlyMap<string, PlannedLink> = planLinks(graph, positions),
  rows: ReadonlyMap<WorkflowNodeId, number> = columnIndexOf(graph),
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
    const shape = linkShape(e, from, to, a, b, rows);
    // The plan's handles, which may have moved off a shared spot.
    const source = endOf(link.sourceHandle) ?? shape.source;
    const target = endOf(link.targetHandle) ?? shape.target;
    out.push({
      id: e.id,
      points: routePoints(
        turn(endPoint(a, spotEnd(source))),
        turn(endPoint(b, spotEnd(target))),
        link.route,
      ),
      ends: [`${e.from}:${link.sourceHandle}`, `${e.to}:${link.targetHandle}`],
    });
  }
  return out;
}
