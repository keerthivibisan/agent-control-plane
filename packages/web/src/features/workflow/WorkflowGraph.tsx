import type { WorkflowStageId } from '@acp/core';
import { Controls, ReactFlow, useReactFlow, useStore, type NodeMouseHandler } from '@xyflow/react';
import { useEffect, useMemo } from 'react';
import { SessionsIcon } from '../../components/icons';
import { STAGE_AGENT_COPY, WORKFLOW_COPY } from '../../lib/copy';
import {
  EDGE_STYLE,
  stageOfNode,
  type WorkflowEdgeKind,
  type WorkflowGraph as Graph,
  type WorkflowNode,
} from './graph';
import { WorkflowGraphContext, workflowNodeTypes } from './WorkflowNodes';

const C = WORKFLOW_COPY;
// fitView counts nodes only: the extra top padding keeps the "Changes" loop above Plan in view.
const FIT = {
  padding: { top: '56px', right: '24px', bottom: '24px', left: '24px' },
  maxZoom: 1,
} as const;

/** Refits whenever the canvas is resized or the graph's shape changes (helpers, panel opening). */
function FitOnChange({ shape }: { shape: string }) {
  const { fitView } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (width === 0 || height === 0) return;
    void fitView(FIT);
  }, [fitView, width, height, shape]);
  return null;
}

/**
 * The workflow as a read-only canvas: no dragging or connecting (the stages are fixed for now,
 * ADR-0019), and wheel scrolling scrolls the page. A click on a stage selects it.
 */
export function WorkflowGraph({
  graph,
  selected,
  onSelect,
}: {
  graph: Graph;
  selected: WorkflowStageId | null;
  onSelect: ((stage: WorkflowStageId) => void) | null;
}) {
  const actions = useMemo(() => ({ selected, select: onSelect }), [selected, onSelect]);
  const onNodeClick: NodeMouseHandler<WorkflowNode> = (_, node) => {
    const stage = stageOfNode(node.id);
    if (stage !== null && onSelect !== null) onSelect(stage);
  };
  const shape = graph.nodes.map((n) => n.id).join(',');
  return (
    <div
      className="w-full overflow-hidden"
      // The canvas takes the graph's own shape, so it fills the width without empty bands.
      style={{
        aspectRatio: `${graph.width} / ${graph.height + 40}`,
        maxHeight: 780,
        minHeight: 420,
      }}
      data-testid="workflow-graph"
      role="group"
      aria-label={C.graphLabel}
    >
      <WorkflowGraphContext.Provider value={actions}>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={workflowNodeTypes}
          onNodeClick={onNodeClick}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={FIT}
          minZoom={0.4}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <FitOnChange shape={shape} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </WorkflowGraphContext.Provider>
    </div>
  );
}

function LineSample({ kind }: { kind: WorkflowEdgeKind }) {
  const { stroke, dash } = EDGE_STYLE[kind];
  return (
    <svg width="32" height="8" aria-hidden="true" className="shrink-0">
      <line x1="0" y1="4" x2="26" y2="4" stroke={stroke} strokeWidth="2" strokeDasharray={dash} />
      <path d="M25 1 L31 4 L25 7 Z" fill={stroke} />
    </svg>
  );
}

/** The graph's legend: line styles and node kinds, in words (color is never the only signal). */
export function WorkflowLegend() {
  const L = C.legend;
  return (
    <ul
      className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-dim"
      aria-label={L.label}
      data-testid="workflow-legend"
    >
      <li className="flex items-center gap-1.5">
        <LineSample kind="flow" />
        {L.flow}
      </li>
      <li className="flex items-center gap-1.5">
        <LineSample kind="loop" />
        {L.loop}
      </li>
      <li className="flex items-center gap-1.5">
        <LineSample kind="bypass" />
        {L.bypass}
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-5 rounded-[4px] border border-line-strong bg-panel"
        />
        {L.agent}
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-5 rounded-[4px] border border-accent/40 bg-accent-soft"
        />
        {L.you}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="rounded-full border border-accent/25 bg-accent-soft px-1.5 font-medium text-accent">
          ✦
        </span>
        {L.skill}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-full border border-line-strong bg-sunken px-1.5 py-0.5">
          <SessionsIcon size={12} className="text-accent" />
        </span>
        {STAGE_AGENT_COPY.legend}
      </li>
    </ul>
  );
}
