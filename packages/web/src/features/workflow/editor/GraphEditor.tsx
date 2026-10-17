import type { WorkflowEdgeType, WorkflowGraph, WorkflowNodeId } from '@acp/core';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  ReactFlow,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnDelete,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
} from 'react';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { AlertIcon, CloseIcon } from '../../../components/icons';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { EDGE_LOOK, toFlowEdges, toFlowNodes, type BlockContext, type LinkEdge } from './flow';
import type { EditorIssue } from './IssuesList';
import { blockNodeTypes, type BlockNode } from './nodes';
import { allowedEdgeTypes, refusalFor, type EditorAction, type Selection } from './state';

const G = WORKFLOW_GRAPH_COPY;
const FIT = { padding: 0.12, maxZoom: 1 } as const;
const CONTROLS_CLASS =
  'overflow-hidden rounded-control border border-line bg-panel [&>button]:size-7! [&>button]:border-0! [&>button]:text-dim [&>button]:transition-colors [&>button:hover]:text-ink [&>button:not(:last-child)]:border-r! [&>button:not(:last-child)]:border-line! [&>button>svg]:max-h-[11px]! [&>button>svg]:max-w-[11px]!';
const CONTROLS_STYLE = { '--xy-controls-box-shadow': 'var(--shadow-card)' } as CSSProperties;

/** Asks the canvas to show a block or link (a click in the problems list). */
export interface FocusRequest {
  selection: NonNullable<Selection>;
  /** A new number per request, so the same block can be shown twice. */
  nonce: number;
}

/** Refits when the canvas is resized or blocks come and go; moving a block never refits. */
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

/** Pans to a block or a link's ends and moves keyboard focus to the block. */
function FocusOn({ request, graph }: { request: FocusRequest | null; graph: WorkflowGraph }) {
  const { fitView } = useReactFlow();
  // Only a new request moves the view; the graph changing under it doesn't.
  const latest = useRef(graph);
  useEffect(() => {
    latest.current = graph;
  });
  useEffect(() => {
    if (request === null) return;
    const { selection } = request;
    const edge =
      selection.kind === 'edge' ? latest.current.edges.find((x) => x.id === selection.id) : null;
    const ids = selection.kind === 'node' ? [selection.id] : edge ? [edge.from, edge.to] : [];
    if (ids.length === 0) return;
    void fitView({ nodes: ids.map((id) => ({ id })), maxZoom: 1, padding: 0.4, duration: 200 });
    if (selection.kind === 'node') {
      // Block ids are lowercase letters, digits and dashes: safe in a selector as they are.
      const el = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${selection.id}"]`,
      );
      el?.focus({ preventScroll: true });
    }
  }, [request, fitView]);
  return null;
}

/** The choice of link kind when more than one fits the two blocks. */
function EdgeChoice({
  from,
  to,
  types,
  onChoose,
  onClose,
}: {
  from: string;
  to: string;
  types: readonly WorkflowEdgeType[];
  onChoose: (t: WorkflowEdgeType) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={G.chooseEdge.title}
      description={G.chooseEdge.description(from, to)}
      onClose={onClose}
      testId="edge-choice"
    >
      <div className="flex flex-col gap-2">
        {types.map((t, i) => (
          <button
            key={t}
            type="button"
            onClick={() => onChoose(t)}
            data-autofocus={i === 0 ? true : undefined}
            className="flex flex-col items-start gap-0.5 rounded-control border border-line-strong bg-panel px-3 py-2.5 text-left transition-colors hover:bg-hover"
          >
            <span className="flex items-center gap-2 font-medium">
              <LinkSample type={t} />
              {G.edges[t]}
            </span>
            <span className="text-caption text-dim">{G.edgeText[t]}</span>
          </button>
        ))}
        <Button variant="quiet" className="self-end" onClick={onClose}>
          {G.chooseEdge.cancel}
        </Button>
      </div>
    </Dialog>
  );
}

/** A short sample of a link kind's line, for the legend and the link choice. */
export function LinkSample({ type }: { type: WorkflowEdgeType }) {
  const { stroke, dash } = EDGE_LOOK[type];
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

/**
 * The canvas: blocks the owner drags, links drawn from a block's right handle to another block's
 * left handle. Only the link kinds core's `canConnect` allows for the two blocks can be made: when
 * one fits it is made at once, when several fit the owner picks one, and when none fits the drop
 * is refused with `canConnect`'s own words. Delete or Backspace removes the selected block or link
 * (the steps every workflow has can't be removed), and the arrow keys nudge a focused block.
 */
export function GraphEditor({
  graph,
  selection,
  issues,
  context,
  refusal,
  dispatch,
  focus,
}: {
  graph: WorkflowGraph;
  selection: Selection;
  issues: readonly EditorIssue[];
  context: BlockContext;
  refusal: string | null;
  dispatch: Dispatch<EditorAction>;
  focus: FocusRequest | null;
}) {
  const [choice, setChoice] = useState<{
    from: WorkflowNodeId;
    to: WorkflowNodeId;
    types: WorkflowEdgeType[];
  } | null>(null);
  const nodes = useMemo(
    () => toFlowNodes(graph, issues, selection, context),
    [graph, issues, selection, context],
  );
  const edges = useMemo(() => toFlowEdges(graph, issues, selection), [graph, issues, selection]);
  const label = useCallback(
    (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id,
    [graph],
  );

  const connect = useCallback(
    (from: WorkflowNodeId, to: WorkflowNodeId) => {
      const types = allowedEdgeTypes(graph, from, to);
      if (types.length === 0) {
        dispatch({ type: 'refuse', message: refusalFor(graph, from, to) });
      } else if (types.length === 1 && types[0] !== undefined) {
        dispatch({ type: 'connect', from, to, edgeType: types[0] });
      } else {
        setChoice({ from, to, types });
      }
    },
    [graph, dispatch],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNode>[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position !== undefined) {
          dispatch({ type: 'move-node', id: c.id, position: c.position });
        } else if (c.type === 'select') {
          dispatch(
            c.selected
              ? { type: 'select', selection: { kind: 'node', id: c.id } }
              : { type: 'deselect', id: c.id },
          );
        }
      }
    },
    [dispatch],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<LinkEdge>[]) => {
      for (const c of changes) {
        if (c.type !== 'select') continue;
        dispatch(
          c.selected
            ? { type: 'select', selection: { kind: 'edge', id: c.id } }
            : { type: 'deselect', id: c.id },
        );
      }
    },
    [dispatch],
  );
  // One callback for a delete, so a block's own removal (which rejoins the final chain) runs
  // before its links are dropped one by one.
  const onDelete: OnDelete<BlockNode, LinkEdge> = useCallback(
    ({ nodes: gone, edges: goneEdges }) => {
      const ids = new Set(gone.map((n) => n.id));
      for (const n of gone) dispatch({ type: 'remove-node', id: n.id });
      for (const e of goneEdges) {
        if (!ids.has(e.source) && !ids.has(e.target)) dispatch({ type: 'remove-edge', id: e.id });
      }
    },
    [dispatch],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source !== c.target) connect(c.source, c.target);
    },
    [connect],
  );
  const isValidConnection = useCallback(
    (c: Connection | LinkEdge) =>
      c.source !== c.target && allowedEdgeTypes(graph, c.source, c.target).length > 0,
    [graph],
  );
  // A drop on a block's handle that no link kind allows: say why, in canConnect's words.
  const onConnectEnd = useCallback(
    (_: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const from = state.fromNode?.id;
      const to = state.toNode?.id;
      if (state.isValid === true || from === undefined || to === undefined) return;
      if (from === to) return;
      if (allowedEdgeTypes(graph, from, to).length === 0) {
        dispatch({ type: 'refuse', message: refusalFor(graph, from, to) });
      }
    },
    [graph, dispatch],
  );

  const shape = graph.nodes.map((n) => n.id).join(',');
  return (
    <div className="relative">
      <div
        className="h-[min(640px,calc(100vh-16rem))] min-h-[420px] w-full overflow-hidden"
        data-testid="graph-editor"
        role="group"
        aria-label={G.canvasLabel}
        aria-describedby="graph-editor-hint"
      >
        <ReactFlow<BlockNode, LinkEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={blockNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onDelete={onDelete}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onPaneClick={() => dispatch({ type: 'select', selection: null })}
          connectionLineType={ConnectionLineType.Step}
          connectionRadius={36}
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={FIT}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.1} />
          <FitOnChange shape={shape} />
          <FocusOn request={focus} graph={graph} />
          <Controls
            showInteractive={false}
            position="top-left"
            orientation="horizontal"
            className={CONTROLS_CLASS}
            style={CONTROLS_STYLE}
          />
        </ReactFlow>
      </div>
      <p id="graph-editor-hint" className="sr-only">
        {G.canvasHint}
      </p>
      {refusal !== null ? (
        <div
          role="alert"
          data-testid="link-refused"
          className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-caption text-danger shadow-pop sm:inset-x-auto sm:right-3 sm:max-w-md"
        >
          <AlertIcon size={15} className="mt-px shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{G.refused.title}</p>
            <p className="text-ink">{refusal}</p>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'dismiss-refusal' })}
            aria-label={G.refused.dismiss}
            className="-mt-0.5 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-control text-dim hover:bg-hover hover:text-ink"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}
      {choice !== null ? (
        <EdgeChoice
          from={label(choice.from)}
          to={label(choice.to)}
          types={choice.types}
          onClose={() => setChoice(null)}
          onChoose={(t) => {
            dispatch({ type: 'connect', from: choice.from, to: choice.to, edgeType: t });
            setChoice(null);
          }}
        />
      ) : null}
    </div>
  );
}
