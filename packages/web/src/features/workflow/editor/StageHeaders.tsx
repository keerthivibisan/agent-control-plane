import {
  PLAYBOOK_STAGE_TITLES,
  workflowPlaybook,
  type NodePosition,
  type PlaybookStageKey,
  type WorkflowGraphV3,
  type WorkflowNodeId,
} from '@acp/core';
import { ViewportPortal } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { finishParts } from '../finish';
import { columnOf, sizeOf, type LayoutColumn } from './layout';

/**
 * ADR-0040: the numbered stage over each column of the laid-out canvas ("1 Ticket and research",
 * "3 Build", …), the same numbers as the lead's playbook, so the owner reads the canvas left to
 * right in the order a run follows it. Drawn in the flow's coordinates (`ViewportPortal`), so they
 * pan and zoom with the blocks; shown only while no block has been moved by hand, when the
 * columns are the layout's own.
 */

const STAGE_OF_COLUMN: Readonly<Record<LayoutColumn, PlaybookStageKey>> = {
  start: 'start',
  plan: 'plan',
  lead: 'build',
  build: 'build',
  review: 'review',
  merge: 'merge',
  final: 'final',
  finish: 'finish',
};

/** How far above the blocks the headers sit. */
const ABOVE = 40;

export interface StageHeader {
  key: PlaybookStageKey;
  n: number;
  title: string;
  x: number;
  y: number;
  width: number;
}

/** The headers for a laid-out graph; none once a block has a saved position. */
export function stageHeaders(
  graph: WorkflowGraphV3,
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>,
): StageHeader[] {
  if (graph.nodes.some((n) => n.position !== undefined)) return [];
  const numbers = new Map(workflowPlaybook(graph).map((s) => [s.key, s.n]));
  const columns = columnOf(graph);
  const finish = finishParts(graph);
  const hidden = new Set(finish === null ? [] : [finish.ticketMerge, finish.done]);
  const spans = new Map<PlaybookStageKey, { lo: number; hi: number }>();
  let top = Infinity;
  for (const node of graph.nodes) {
    const at = positions.get(node.id);
    const column = columns.get(node.id);
    if (at === undefined || column === undefined || hidden.has(node.id)) continue;
    const stage = STAGE_OF_COLUMN[column];
    const { width } = sizeOf(node);
    const span = spans.get(stage);
    spans.set(stage, {
      lo: Math.min(span?.lo ?? Infinity, at.x),
      hi: Math.max(span?.hi ?? -Infinity, at.x + width),
    });
    top = Math.min(top, at.y);
  }
  const out: StageHeader[] = [];
  for (const [key, span] of spans) {
    const n = numbers.get(key);
    if (n === undefined) continue;
    out.push({
      key,
      n,
      title: PLAYBOOK_STAGE_TITLES[key],
      x: span.lo,
      y: top - ABOVE,
      width: span.hi - span.lo,
    });
  }
  return out.sort((a, b) => a.n - b.n);
}

export const StageHeaders = memo(function StageHeaders({
  graph,
  positions,
}: {
  graph: WorkflowGraphV3;
  positions: ReadonlyMap<WorkflowNodeId, NodePosition>;
}) {
  const headers = useMemo(() => stageHeaders(graph, positions), [graph, positions]);
  if (headers.length === 0) return null;
  return (
    <ViewportPortal>
      {headers.map((h) => (
        <div
          key={h.key}
          className="pointer-events-none absolute flex items-center gap-1.5 border-t border-line-strong pt-1 text-caption font-medium text-dim"
          style={{ transform: `translate(${h.x}px, ${h.y}px)`, width: h.width }}
          data-testid={`stage-header-${h.key}`}
        >
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-micro text-ink tabular-nums">
            {h.n}
          </span>
          <span className="truncate">{h.title}</span>
        </div>
      ))}
    </ViewportPortal>
  );
});
