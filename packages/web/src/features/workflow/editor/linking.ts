import type { WorkflowEdgeType, WorkflowGraph, WorkflowNodeId } from '@acp/core';
import { FINISH_COPY } from '../../../lib/copy';
import { finishView } from '../finish';
import type { LinkTarget } from './nodes';
import { refusalFor, refusalTarget, resolveLink, type LinkOption } from './state';

/**
 * Linking blocks, the pure parts (v0.3.1 P-C): where a dropped link ends (magnetic snapping), the
 * links "Link to…" offers, and moving an end of a link. Whether a link may exist is always core's
 * `canConnect` through `resolveLink` (state.ts), so every way of linking (drag, click, the menus,
 * moving an end) makes exactly the links the server accepts.
 */

/** How far (screen pixels) from a valid block a dropped link still snaps onto it. */
export const SNAP_RADIUS = 80;

/**
 * How far (screen pixels) outside a block's border a drop still counts as on it, valid or not: a
 * drop on the very edge (a rounded pointer position, the left border where links used to end)
 * lands on the block instead of falling through to the empty canvas.
 */
export const EDGE_SLOP = 8;

export interface Point {
  x: number;
  y: number;
}

export interface BlockRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The distance from a point to a block's box (0 inside it). */
export function distanceToBlock(p: Point, r: BlockRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/**
 * The block a link dropped at `p` ends on. The block under the pointer (or within `slop` of its
 * border) wins, valid or not, so a refused drop can say why; over empty canvas, the nearest valid
 * block within `radius`. Both in the same units as the boxes. The block the link starts from is
 * never its end.
 */
export function snapTarget(
  p: Point,
  rects: readonly BlockRect[],
  targets: ReadonlyMap<string, LinkTarget> | null,
  radius: number,
  from: string | null,
  slop = 0,
): { id: string; under: boolean } | null {
  let under: { id: string; d: number } | null = null;
  let best: { id: string; d: number } | null = null;
  for (const r of rects) {
    const d = distanceToBlock(p, r);
    if (d <= slop && (under === null || d < under.d)) under = { id: r.id, d };
    if (r.id === from || targets?.get(r.id) !== 'valid') continue;
    if (d <= radius && (best === null || d < best.d)) best = { id: r.id, d };
  }
  if (under !== null) return under.id === from ? null : { id: under.id, under: true };
  return best === null ? null : { id: best.id, under: false };
}

/** Where a snapped link meets its block: the middle of the side that faces where it comes from. */
export function anchorOn(
  r: BlockRect,
  from: Point,
): Point & { side: 'left' | 'right' | 'top' | 'bottom' } {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = (cx - from.x) / Math.max(r.width, 1);
  const dy = (cy - from.y) / Math.max(r.height, 1);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: r.x, y: cy, side: 'left' } : { x: r.x + r.width, y: cy, side: 'right' };
  }
  return dy >= 0 ? { x: cx, y: r.y, side: 'top' } : { x: cx, y: r.y + r.height, side: 'bottom' };
}

/** What dropping (or clicking) a link from `from` onto `to`, both as drawn, does. */
export type LinkOutcome =
  /** Exactly one kind fits: the link is made at once. */
  | { kind: 'link'; from: WorkflowNodeId; to: WorkflowNodeId; type: WorkflowEdgeType }
  /** Several kinds fit: the owner picks one by the drop point. */
  | { kind: 'choose'; option: LinkOption }
  /** None fits: refused in `canConnect`'s own words. */
  | { kind: 'refused'; message: string }
  /** Dropped on nothing, or back on the block it starts from. */
  | { kind: 'none' };

/** The outcome of a link from `from` dropped on `to` (null: on no block), checked with core. */
export function linkOutcome(
  graph: WorkflowGraph,
  from: WorkflowNodeId,
  to: WorkflowNodeId | null,
): LinkOutcome {
  if (to === null || to === from) return { kind: 'none' };
  const option = resolveLink(graph, from, to);
  if (option === null) {
    return { kind: 'refused', message: refusalFor(graph, from, refusalTarget(graph, to)) };
  }
  const [only, ...more] = option.types;
  if (only !== undefined && more.length === 0) {
    return { kind: 'link', from: option.from, to: option.to, type: only };
  }
  return { kind: 'choose', option };
}

/** One entry of "Link to…": a block a link from `from` may end on, and one kind that fits. */
export interface LinkChoice {
  /** The block as drawn (the Finish block for the end steps). */
  to: WorkflowNodeId;
  label: string;
  type: WorkflowEdgeType;
  /** The stored ends (`resolveLink`). */
  link: LinkOption;
}

/** The label a block is drawn with (the Finish block's title for your merge). */
export function drawnLabel(graph: WorkflowGraph, id: WorkflowNodeId): string {
  const view = finishView(graph);
  if (view.finish !== null && id === view.finish.ownerMerge) return FINISH_COPY.title;
  return graph.nodes.find((n) => n.id === id)?.label ?? id;
}

/**
 * Every link "Link to…" offers from a block: only the blocks core allows, each kind that fits as
 * its own entry, in the canvas's order. Empty for a block no link can start from.
 */
export function linkChoices(graph: WorkflowGraph, from: WorkflowNodeId): LinkChoice[] {
  const view = finishView(graph);
  if (!view.graph.nodes.some((n) => n.id === from)) return [];
  const out: LinkChoice[] = [];
  for (const n of view.graph.nodes) {
    if (n.id === from) continue;
    const link = resolveLink(graph, from, n.id);
    if (link === null) continue;
    for (const type of link.types)
      out.push({ to: n.id, label: drawnLabel(graph, n.id), type, link });
  }
  return out;
}

/** Which end of a link is being moved. */
export type LinkEnd = 'source' | 'target';

function withoutEdge(graph: WorkflowGraph, id: string): WorkflowGraph {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== id) };
}

/** A link as drawn (its ends on the Finish block where it ends on a hidden step). */
function drawnEdge(graph: WorkflowGraph, id: string) {
  return finishView(graph).graph.edges.find((e) => e.id === id);
}

/**
 * While an end of link `id` is moved: every drawn block is a valid new end when core allows a
 * link from the end that stays to it (or from it to the end that stays), on the graph without
 * the link. Null for a link that isn't there.
 */
export function reconnectTargets(
  graph: WorkflowGraph,
  id: string,
  moving: LinkEnd,
): ReadonlyMap<WorkflowNodeId, LinkTarget> | null {
  const edge = drawnEdge(graph, id);
  if (edge === undefined) return null;
  const without = withoutEdge(graph, id);
  const fixed = moving === 'target' ? edge.from : edge.to;
  return new Map(
    finishView(graph).graph.nodes.map((n): [WorkflowNodeId, LinkTarget] => {
      if (n.id === fixed) return [n.id, 'source'];
      const option =
        moving === 'target' ? resolveLink(without, fixed, n.id) : resolveLink(without, n.id, fixed);
      return [n.id, option === null ? 'invalid' : 'valid'];
    }),
  );
}

export type ReconnectResult =
  /** Dropped back on the block it was on: nothing changes. */
  | { kind: 'same' }
  | { kind: 'refused'; message: string }
  /** The new ends and the kinds that fit there: the link's own kind first when it still fits. */
  | { kind: 'ok'; from: WorkflowNodeId; to: WorkflowNodeId; types: WorkflowEdgeType[] };

/** What moving an end of link `id` onto block `onto` (as drawn) does, checked with core. */
export function resolveReconnect(
  graph: WorkflowGraph,
  id: string,
  moving: LinkEnd,
  onto: WorkflowNodeId,
): ReconnectResult {
  const edge = drawnEdge(graph, id);
  const stored = graph.edges.find((e) => e.id === id);
  if (edge === undefined || stored === undefined) return { kind: 'same' };
  if ((moving === 'target' ? edge.to : edge.from) === onto) return { kind: 'same' };
  const without = withoutEdge(graph, id);
  const from = moving === 'target' ? edge.from : onto;
  const to = moving === 'target' ? onto : edge.to;
  if (from === to) return { kind: 'same' };
  const option = resolveLink(without, from, to);
  if (option === null) {
    return { kind: 'refused', message: refusalFor(without, from, refusalTarget(without, to)) };
  }
  // The link keeps its kind when it fits its new ends; else it takes the kinds that do.
  const types = option.types.includes(stored.type) ? [stored.type] : option.types;
  return { kind: 'ok', from: option.from, to: option.to, types };
}
