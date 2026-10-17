import type { WorkflowStageId } from '@acp/core';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  useStore,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { STAGE_AGENT_COPY, WORKFLOW_COPY } from '../../lib/copy';
import {
  EDGE_STYLE,
  stageOfNode,
  type WorkflowEdgeKind,
  type WorkflowGraph as Graph,
  type WorkflowNode,
} from './graph';
import { AgentFileIcon } from './icons';
import { WorkflowGraphContext, workflowNodeTypes } from './WorkflowNodes';

const C = WORKFLOW_COPY;
// fitView counts nodes only: the extra top padding keeps the "Changes" loop above Plan in view.
const FIT = {
  padding: { top: '56px', right: '24px', bottom: '24px', left: '24px' },
  maxZoom: 1,
} as const;

/**
 * The zoom controls as one small segmented toolbar: hairline border, no drop shadow, buttons that
 * take the hover fill (the theme's variables are in index.css; this adds the shape).
 */
const CONTROLS_CLASS =
  'overflow-hidden rounded-control border border-line bg-panel [&>button]:size-7! [&>button]:border-0! [&>button]:text-dim [&>button]:transition-colors [&>button:hover]:text-ink [&>button:not(:last-child)]:border-r! [&>button:not(:last-child)]:border-line! [&>button>svg]:max-h-[11px]! [&>button>svg]:max-w-[11px]!';
const CONTROLS_STYLE = { '--xy-controls-box-shadow': 'var(--shadow-card)' } as CSSProperties;

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
      // The canvas takes the graph's own shape, so it fills the width without empty bands, but
      // never grows past the viewport: the whole flow, Done included, fits on screen.
      style={{
        aspectRatio: `${graph.width} / ${graph.height + 40}`,
        maxHeight: 'min(780px, calc(100vh - 18rem))',
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
          {/* A quiet dot grid: the canvas reads as a canvas, the cards stay the loudest thing. */}
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.1} />
          <FitOnChange shape={shape} />
          {/* Top left, in a row: the corner the flow never uses (the Done edge runs bottom right). */}
          <Controls
            showInteractive={false}
            position="top-left"
            orientation="horizontal"
            className={CONTROLS_CLASS}
            style={CONTROLS_STYLE}
          />
        </ReactFlow>
      </WorkflowGraphContext.Provider>
    </div>
  );
}

function LineSample({ kind }: { kind: WorkflowEdgeKind }) {
  const { stroke, dash } = EDGE_STYLE[kind];
  return (
    <svg width="28" height="8" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        y1="4"
        x2="22"
        y2="4"
        stroke={stroke}
        strokeWidth="1.75"
        strokeDasharray={dash}
      />
      <path d="M21 1 L27 4 L21 7 Z" fill={stroke} />
    </svg>
  );
}

function LegendItem({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {sample}
      {children}
    </li>
  );
}

const SWATCH = 'inline-block h-3.5 w-5 shrink-0 rounded-[4px] border';
const CHIP =
  'inline-flex h-4.5 shrink-0 items-center justify-center rounded-[0.3125rem] border px-1 text-micro font-medium';

/** The graph's legend: line styles and node kinds, in words (color is never the only signal). */
export function WorkflowLegend() {
  const L = C.legend;
  return (
    <ul
      className="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-dim"
      aria-label={L.label}
      data-testid="workflow-legend"
    >
      <LegendItem sample={<LineSample kind="flow" />}>{L.flow}</LegendItem>
      <LegendItem sample={<LineSample kind="loop" />}>{L.loop}</LegendItem>
      <LegendItem sample={<LineSample kind="bypass" />}>{L.bypass}</LegendItem>
      <LegendItem
        sample={<span aria-hidden="true" className={`${SWATCH} border-line-strong bg-panel`} />}
      >
        {L.agent}
      </LegendItem>
      <LegendItem
        sample={<span aria-hidden="true" className={`${SWATCH} border-accent/40 bg-accent-soft`} />}
      >
        {L.you}
      </LegendItem>
      <LegendItem
        sample={<span className={`${CHIP} border-accent/20 bg-accent-soft text-accent`}>✦</span>}
      >
        {L.skill}
      </LegendItem>
      <LegendItem
        sample={
          <span className={`${CHIP} border-line-strong bg-sunken`}>
            <AgentFileIcon size={11} className="text-accent" />
          </span>
        }
      >
        {STAGE_AGENT_COPY.legend}
      </LegendItem>
    </ul>
  );
}
