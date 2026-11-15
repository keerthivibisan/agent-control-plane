import type { WorkflowEdgeTypeV3 } from '@acp/core';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import type { LinkEdge } from './flow';
import { useLinkState } from './link-store';
import { labelPoint, pathOf, routePoints } from './routing';

/**
 * ADR-0040: links come in families, each with its own colour, and the dashes still tell the kinds
 * apart, so colour is never the only signal (DESIGN.md, "Agent views"). The accent stays for the
 * selected link only.
 * - work (next step, plan, implement, merge): neutral and solid, the lead's darker, merge heaviest;
 * - review (review dashed, findings dotted): teal;
 * - fixes (rework long-dashed, orange; a When failure route dashed, red);
 * - research (dash-dotted) and test (short-dashed): purple, what runs beside or after the work;
 * - a custom hand-off: neutral, dash-dot-dotted.
 */
export type LinkFamily = 'work' | 'review' | 'fix' | 'check' | 'handoff';

export const LINK_FAMILY: Readonly<Record<WorkflowEdgeTypeV3, LinkFamily>> = {
  flow: 'work',
  plan: 'work',
  implement: 'work',
  merge: 'work',
  review: 'review',
  findings: 'review',
  rework: 'fix',
  when: 'fix',
  research: 'check',
  test: 'check',
  custom: 'handoff',
};

/** The families in the legend's order, each with its kinds. */
export const LINK_FAMILIES: readonly { family: LinkFamily; types: WorkflowEdgeTypeV3[] }[] = [
  { family: 'work', types: ['flow', 'plan', 'implement', 'merge'] },
  { family: 'review', types: ['review', 'findings'] },
  { family: 'fix', types: ['rework', 'when'] },
  { family: 'check', types: ['research', 'test'] },
  { family: 'handoff', types: ['custom'] },
];

const REVIEW = 'var(--color-token-cache-read)';
const CHECK = 'var(--color-done)';

export const EDGE_LOOK: Readonly<
  Record<WorkflowEdgeTypeV3, { stroke: string; width: number; dash?: string; round?: boolean }>
> = {
  flow: { stroke: 'var(--color-dim)', width: 1.5 },
  research: { stroke: CHECK, width: 1.75, dash: '10 3 1 3', round: true },
  plan: { stroke: 'var(--color-dim)', width: 2.25 },
  implement: { stroke: 'var(--color-ink)', width: 1.5 },
  review: { stroke: REVIEW, width: 1.75, dash: '6 4' },
  findings: { stroke: REVIEW, width: 2, dash: '0.5 5', round: true },
  rework: { stroke: 'var(--color-token-output)', width: 1.75, dash: '9 4' },
  test: { stroke: CHECK, width: 1.75, dash: '3 3' },
  custom: { stroke: 'var(--color-dim)', width: 1.5, dash: '8 3 1 3 1 3', round: true },
  merge: { stroke: 'var(--color-ink)', width: 2.5 },
  // ADR-0038: failure routing, red and dashed.
  when: { stroke: 'var(--color-danger)', width: 1.75, dash: '5 4' },
};

/** The arrowhead's size on the canvas (ADR-0040: larger, so a link's direction reads at once). */
export const ARROW_SIZE = 18;

/** The stroke a link is drawn with: the accent when selected, danger when the rules refuse it. */
export function linkStroke(type: WorkflowEdgeTypeV3, selected: boolean, refused: boolean): string {
  if (selected) return 'var(--color-accent)';
  if (refused) return 'var(--color-danger)';
  return EDGE_LOOK[type].stroke;
}

/** A short sample of a link kind's line, for the legend, the link chooser and the panel. */
export function LinkSample({ type, width = 28 }: { type: WorkflowEdgeTypeV3; width?: number }) {
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
 * touch it fade back. Rework links carry a small "Rework ×n" label on their lower run, and an
 * arrow with the owner's label (ADR-0037 §2) shows it there; its purpose is the hover text.
 *
 * ADR-0040: a link the pointer is on, or one of the block under the pointer, is drawn thicker with
 * a light dash moving along it from start to end, so its direction shows; the others fade back.
 */
export const LinkEdgeView = memo(function LinkEdgeView({
  id,
  source,
  target,
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
  const hover = useLinkState((s) => s.hover);
  const focus = useLinkState((s) => s.focus);
  if (data === undefined) return null;
  // The pointer wins over a lit playbook step (ADR-0040).
  const lit =
    hover !== null
      ? hover === source || hover === target || hover === `edge:${id}`
      : focus !== null && focus.edges.includes(id);
  const dim = data.dim || linking || ((hover !== null || focus !== null) && !lit);
  const points = routePoints({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, data.route);
  const d = pathOf(points);
  const look = EDGE_LOOK[data.type];
  const isSelected = selected === true;
  const stroke = linkStroke(data.type, isSelected, data.refused);
  const at = labelPoint(points, data.route.labelAt);
  return (
    <g opacity={dim ? 0.3 : 1} data-link={data.type} className="transition-opacity">
      {data.purpose !== undefined ? <title>{data.purpose}</title> : null}
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
          strokeWidth: isSelected || lit ? look.width + 0.75 : look.width,
          strokeLinecap: look.round === true ? 'round' : 'butt',
          ...(look.dash !== undefined ? { strokeDasharray: look.dash } : {}),
        }}
      />
      {lit || isSelected ? (
        <path
          d={d}
          fill="none"
          stroke="var(--color-panel)"
          strokeOpacity={0.85}
          strokeWidth={Math.max(1, look.width - 0.5)}
          strokeDasharray="2 14"
          strokeLinecap="round"
          className="acp-link-flow pointer-events-none"
          data-testid="link-flow"
        />
      ) : null}
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
            title={data.purpose}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
});

export const linkEdgeTypes = { link: LinkEdgeView };
