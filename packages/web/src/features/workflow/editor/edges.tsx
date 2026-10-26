import type { WorkflowEdgeType } from '@acp/core';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import type { LinkEdge } from './flow';
import { useLinkState } from './link-store';
import { labelPoint, pathOf, routePoints } from './routing';

/**
 * How each kind of link looks (DESIGN.md, "Agent views"): neutral lines that differ by weight and
 * dashes, never by the accent, which marks only the selected link. Calm on purpose: the forward
 * links are solid (the lead's assigns and merge darker, the merge heavier), the review route is
 * dashed, findings dotted, rework long-dashed with its rounds on a small label.
 */
export const EDGE_LOOK: Readonly<
  Record<WorkflowEdgeType, { stroke: string; width: number; dash?: string; round?: boolean }>
> = {
  flow: { stroke: 'var(--color-dim)', width: 1.5 },
  assigns: { stroke: 'var(--color-ink)', width: 1.5 },
  review: { stroke: 'var(--color-dim)', width: 1.5, dash: '6 4' },
  findings: { stroke: 'var(--color-dim)', width: 2, dash: '0.5 5', round: true },
  rework: { stroke: 'var(--color-ink)', width: 1.5, dash: '9 4' },
  merge: { stroke: 'var(--color-ink)', width: 2.5 },
};

/** The stroke a link is drawn with: the accent when selected, danger when the rules refuse it. */
export function linkStroke(type: WorkflowEdgeType, selected: boolean, refused: boolean): string {
  if (selected) return 'var(--color-accent)';
  if (refused) return 'var(--color-danger)';
  return EDGE_LOOK[type].stroke;
}

/** A short sample of a link kind's line, for the legend, the link chooser and the panel. */
export function LinkSample({ type, width = 28 }: { type: WorkflowEdgeType; width?: number }) {
  const { stroke, dash, round } = EDGE_LOOK[type];
  const end = width - 6;
  return (
    <svg width={width} height="8" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2={end}
        y2="4"
        stroke={stroke}
        strokeWidth={Math.min(EDGE_LOOK[type].width, 2.25)}
        strokeDasharray={dash}
        strokeLinecap={round === true ? 'round' : 'butt'}
      />
      <path d={`M${end - 1} 1 L${width - 1} 4 L${end - 1} 7 Z`} fill={stroke} />
    </svg>
  );
}

/**
 * A link on the canvas: the route `routing.ts` planned (its kind and lane), drawn from the handles'
 * live positions, so it follows a block the owner drags. The selected link is drawn in the accent
 * over a soft halo; while a block is selected or a link is being dragged, the links that don't
 * touch it fade back. Rework links carry a small "Rework ×n" label on their lower run.
 */
export const LinkEdgeView = memo(function LinkEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
  label,
}: EdgeProps<LinkEdge>) {
  // While a link is being made the others fade back (the link store, so no remapping).
  const linking = useLinkState((s) => s.mode !== null);
  if (data === undefined) return null;
  const dim = data.dim || linking;
  const points = routePoints({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, data.route);
  const d = pathOf(points);
  const look = EDGE_LOOK[data.type];
  const isSelected = selected === true;
  const stroke = linkStroke(data.type, isSelected, data.refused);
  const at = labelPoint(points);
  return (
    <g opacity={dim ? 0.3 : 1} data-link={data.type} className="transition-opacity">
      {isSelected ? (
        <path
          d={d}
          fill="none"
          stroke="var(--color-accent)"
          strokeOpacity={0.18}
          strokeWidth={look.width + 7}
          strokeLinejoin="round"
          className="pointer-events-none"
        />
      ) : null}
      <BaseEdge
        id={id}
        path={d}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
        interactionWidth={18}
        style={{
          stroke,
          strokeWidth: isSelected ? look.width + 0.75 : look.width,
          strokeLinecap: look.round === true ? 'round' : 'butt',
          ...(look.dash !== undefined ? { strokeDasharray: look.dash } : {}),
        }}
      />
      {typeof label === 'string' ? (
        <EdgeLabelRenderer>
          <div
            className={`nodrag nopan pointer-events-none absolute inline-flex h-5 items-center rounded-full border bg-panel px-2 text-micro font-medium whitespace-nowrap tabular-nums ${
              isSelected ? 'border-accent text-accent' : 'border-line-strong text-ink'
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`,
              opacity: dim ? 0.3 : 1,
            }}
            data-testid="link-label"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
});

export const linkEdgeTypes = { link: LinkEdgeView };
