import {
  Position,
  getBezierPath,
  useStore,
  type ConnectionLineComponentProps,
  type InternalNode,
} from '@xyflow/react';
import { useContext, useEffect } from 'react';
import { LinkStoreContext, useLinkState } from './link-store';
import { EDGE_SLOP, SNAP_RADIUS, anchorOn, snapTarget, type BlockRect } from './linking';
import type { BlockNode } from './nodes';

/**
 * The link being dragged (v0.3.1 P-C): a smooth curve that follows the pointer and, near a block
 * it may end on, snaps onto the side of that block that faces it (magnetic snapping, within
 * `SNAP_RADIUS` screen pixels). The block it would end on is published to the link store, so that
 * block alone lights up as "drop here". Dashed while there is nowhere to drop it; solid once it
 * has snapped. Finished links stay orthogonal (DESIGN.md, "Agent views"): only the line being
 * drawn is curved.
 */

const SIDE_POSITION = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
} as const;

/** The drawn blocks' boxes in the flow's own coordinates. */
export function blockRects(lookup: ReadonlyMap<string, InternalNode>): BlockRect[] {
  const out: BlockRect[] = [];
  for (const n of lookup.values()) {
    const { x, y } = n.internals.positionAbsolute;
    out.push({
      id: n.id,
      x,
      y,
      width: n.measured.width ?? n.width ?? 0,
      height: n.measured.height ?? n.height ?? 0,
    });
  }
  return out;
}

export function LinkConnectionLine({
  fromX,
  fromY,
  fromPosition,
  pointer,
}: ConnectionLineComponentProps<BlockNode>) {
  const store = useContext(LinkStoreContext);
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const lookup = useStore((s) => s.nodeLookup);
  const targets = useLinkState((s) => s.targets);
  const from = useLinkState((s) => s.from);
  // The pointer arrives in the canvas's pixels; the blocks are in the flow's coordinates.
  const p = { x: (pointer.x - tx) / zoom, y: (pointer.y - ty) / zoom };
  const rects = blockRects(lookup);
  const snap = snapTarget(p, rects, targets, SNAP_RADIUS / zoom, from, EDGE_SLOP / zoom);
  const valid = snap !== null && targets?.get(snap.id) === 'valid';
  const snapId = snap?.id ?? null;
  useEffect(() => {
    store?.set({ snap: snapId });
  }, [store, snapId]);

  const rect = valid ? rects.find((r) => r.id === snapId) : undefined;
  const end = rect === undefined ? null : anchorOn(rect, { x: fromX, y: fromY });
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: end?.x ?? p.x,
    targetY: end?.y ?? p.y,
    targetPosition: end === null ? Position.Left : SIDE_POSITION[end.side],
  });
  return (
    <g data-testid="link-line" data-snapped={valid ? 'true' : 'false'}>
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeOpacity={0.16}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={valid ? undefined : '6 5'}
      />
      <circle
        cx={end?.x ?? p.x}
        cy={end?.y ?? p.y}
        r={valid ? 5 : 3.5}
        fill={valid ? 'var(--color-accent)' : 'var(--color-panel)'}
        stroke="var(--color-accent)"
        strokeWidth={2}
      />
    </g>
  );
}
