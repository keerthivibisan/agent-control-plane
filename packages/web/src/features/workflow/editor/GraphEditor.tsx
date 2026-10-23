import type { WorkflowEdgeType, WorkflowGraph, WorkflowNode, WorkflowNodeId } from '@acp/core';
import * as RadixPopover from '@radix-ui/react-popover';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnConnectStartParams,
  type OnDelete,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { buttonClass } from '../../../components/Button';
import { AlertIcon, CloseIcon } from '../../../components/icons';
import { floatingClass } from '../../../components/Menu';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { FitIcon, ZoomInIcon, ZoomOutIcon } from '../icons';
import { EDITOR_COPY } from './copy';
import { LinkSample, linkEdgeTypes } from './edges';
import { toFlowEdges, toFlowNodes, type BlockContext, type LinkEdge } from './flow';
import type { EditorIssue } from './IssuesList';
import { graphBounds, layoutGraph } from './layout';
import { HowItWorks, Legend, LegendToggle, useLegendOpen } from './Legend';
import { blockNodeTypes, type BlockNode } from './nodes';
import { Palette } from './Palette';
import { allowedEdgeTypes, refusalFor, type EditorAction, type Selection } from './state';

const G = WORKFLOW_GRAPH_COPY;
const Z = EDITOR_COPY.zoom;
const T = EDITOR_COPY.toolbar;
const FIT = { padding: 0.1, maxZoom: 1 } as const;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.5;

/** The block as the automatic layout places it (the canvas's shape ignores moved blocks). */
function withoutPosition(node: WorkflowNode): WorkflowNode {
  if (node.position === undefined) return node;
  const copy = { ...node };
  delete copy.position;
  return copy;
}

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

/** Zoom out, the zoom level (a click sets 100%), zoom in, and Fit, for the canvas toolbar. */
function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const percent = Math.round(zoom * 100);
  const icon = `${buttonClass('quiet', 'sm')} w-7 px-0`;
  return (
    <div
      role="group"
      aria-label={Z.label}
      className="flex items-center gap-0.5"
      data-testid="zoom-controls"
    >
      <button
        type="button"
        className={icon}
        onClick={() => void zoomOut({ duration: 150 })}
        disabled={zoom <= MIN_ZOOM + 0.001}
        aria-label={Z.out}
        title={Z.out}
      >
        <ZoomOutIcon size={15} />
      </button>
      <button
        type="button"
        className={`${buttonClass('quiet', 'sm')} w-12 px-0 tabular-nums`}
        onClick={() => void zoomTo(1, { duration: 150 })}
        title={Z.level(100)}
        data-testid="zoom-level"
      >
        {Z.level(percent)}
      </button>
      <button
        type="button"
        className={icon}
        onClick={() => void zoomIn({ duration: 150 })}
        disabled={zoom >= MAX_ZOOM - 0.001}
        aria-label={Z.in}
        title={Z.in}
      >
        <ZoomInIcon size={15} />
      </button>
      <button
        type="button"
        className={buttonClass('quiet', 'sm')}
        onClick={() => void fitView({ ...FIT, duration: 200 })}
        aria-label={Z.fitLabel}
        title={Z.fitLabel}
        data-testid="zoom-fit"
      >
        <FitIcon size={14} />
        {Z.fit}
      </button>
    </div>
  );
}

interface Choice {
  from: WorkflowNodeId;
  to: WorkflowNodeId;
  types: WorkflowEdgeType[];
  /** Where the link was dropped, in the canvas frame's pixels. */
  at: { x: number; y: number };
}

/**
 * The choice of link kind when more than one fits the two blocks: a small menu of buttons where the
 * link was dropped (a Radix popover anchored at the drop point, so Escape and a click elsewhere
 * close it). Focus starts on the first kind and goes back to the canvas afterwards.
 */
function EdgeChoice({
  choice,
  from,
  to,
  onChoose,
  onClose,
  restoreFocus,
}: {
  choice: Choice;
  from: string;
  to: string;
  onChoose: (t: WorkflowEdgeType) => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <RadixPopover.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <RadixPopover.Anchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-px"
          style={{ left: choice.at.x, top: choice.at.y }}
        />
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        <RadixPopover.Content
          ref={content}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label={EDITOR_COPY.chooser.title}
          data-testid="edge-choice"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            content.current?.querySelector<HTMLElement>('button')?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            restoreFocus();
          }}
          className={`${floatingClass} flex w-80 max-w-[calc(100vw-1rem)] flex-col p-2 focus:outline-none`}
        >
          <p className="px-2 pt-1 font-semibold">{EDITOR_COPY.chooser.title}</p>
          <p className="px-2 pb-2 text-caption text-dim">{G.chooseEdge.description(from, to)}</p>
          <div className="flex flex-col gap-0.5">
            {choice.types.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChoose(t)}
                className="flex flex-col items-start gap-0.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:-outline-offset-2"
              >
                <span className="flex items-center gap-2 font-medium">
                  <LinkSample type={t} />
                  {G.edges[t]}
                </span>
                <span className="pl-9 text-caption text-dim">{G.edgeText[t]}</span>
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-end border-t border-line pt-2">
            <button type="button" className={buttonClass('quiet', 'sm')} onClick={onClose}>
              {G.chooseEdge.cancel}
            </button>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** The pointer's position of a mouse or touch event. */
function pointOf(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } | null {
  if ('changedTouches' in event) {
    const t = event.changedTouches[0];
    return t === undefined ? null : { clientX: t.clientX, clientY: t.clientY };
  }
  return { clientX: event.clientX, clientY: event.clientY };
}

function Canvas({
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
  const frame = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  /** The block a link is being dragged from, so the canvas can show where it may end. */
  const [connectFrom, setConnectFrom] = useState<WorkflowNodeId | null>(null);
  const positions = useMemo(() => layoutGraph(graph), [graph]);
  const nodes = useMemo(
    () => toFlowNodes(graph, issues, selection, context, positions, connectFrom),
    [graph, issues, selection, context, positions, connectFrom],
  );
  const edges = useMemo(
    () => toFlowEdges(graph, issues, selection, positions, connectFrom !== null),
    [graph, issues, selection, positions, connectFrom],
  );
  const label = useCallback(
    (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id,
    [graph],
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
  const isValidConnection = useCallback(
    (c: { source: string; target: string }) =>
      c.source !== c.target && allowedEdgeTypes(graph, c.source, c.target).length > 0,
    [graph],
  );
  const onConnectStart = useCallback((_: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    if (params.nodeId !== null) setConnectFrom(params.nodeId);
  }, []);
  /**
   * The end of a dragged link, on a block's handle or anywhere on a block: made at once when one
   * kind fits, a choice by the drop point when several do, and refused with `canConnect`'s own
   * words when none does.
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      setConnectFrom(null);
      const from = state.fromNode?.id;
      if (from === undefined) return;
      const point = pointOf(event);
      let to: string | null = state.toNode?.id ?? null;
      if (to === null && point !== null) {
        const hit = document
          .elementFromPoint(point.clientX, point.clientY)
          ?.closest<HTMLElement>('.react-flow__node');
        to = hit?.dataset['id'] ?? null;
      }
      if (to === null || to === from) return;
      const types = allowedEdgeTypes(graph, from, to);
      if (types.length === 0) {
        dispatch({ type: 'refuse', message: refusalFor(graph, from, to) });
      } else if (types.length === 1 && types[0] !== undefined) {
        dispatch({ type: 'connect', from, to, edgeType: types[0] });
      } else {
        const box = frame.current?.getBoundingClientRect();
        const at =
          box === undefined || point === null
            ? { x: 24, y: 24 }
            : { x: point.clientX - box.left, y: point.clientY - box.top };
        setChoice({ from, to, types, at });
      }
    },
    [graph, dispatch],
  );
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      // Escape clears the selection, so the problems list shows again.
      if (e.key === 'Escape' && selection !== null && choice === null) {
        dispatch({ type: 'select', selection: null });
      }
    },
    [selection, choice, dispatch],
  );

  const shape = graph.nodes.map((n) => n.id).join(',');
  // The canvas takes the automatic layout's shape (moving a block doesn't resize it, so the view
  // never jumps mid-drag): it fills the width without empty bands, within the viewport.
  const bounds = useMemo(
    () => graphBounds({ ...graph, nodes: graph.nodes.map(withoutPosition) }),
    [graph],
  );
  return (
    <div className="relative" ref={frame}>
      <div
        className="w-full overflow-hidden"
        style={{
          aspectRatio: `${bounds.width + 120} / ${bounds.height + 120}`,
          maxHeight: 'min(720px, calc(100vh - 17rem))',
          minHeight: 400,
        }}
        data-testid="graph-editor"
        data-connecting={connectFrom ?? undefined}
        role="group"
        aria-label={G.canvasLabel}
        aria-describedby="graph-editor-hint"
        onKeyDown={onKeyDown}
      >
        <ReactFlow<BlockNode, LinkEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={blockNodeTypes}
          edgeTypes={linkEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onDelete={onDelete}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onPaneClick={() => dispatch({ type: 'select', selection: null })}
          connectionLineType={ConnectionLineType.Step}
          connectionLineStyle={{
            stroke: 'var(--color-accent)',
            strokeWidth: 1.75,
            strokeDasharray: '5 4',
          }}
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
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <FitOnChange shape={shape} />
          <FocusOn request={focus} graph={graph} />
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
          choice={choice}
          from={label(choice.from)}
          to={label(choice.to)}
          onClose={() => setChoice(null)}
          restoreFocus={() =>
            frame.current
              ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${choice.to}"]`)
              ?.focus({ preventScroll: true })
          }
          onChoose={(t) => {
            dispatch({ type: 'connect', from: choice.from, to: choice.to, edgeType: t });
            setChoice(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The canvas box (v0.3.0 D-C): a toolbar row (Add block; the legend's toggle, How this works and
 * the zoom controls), the canvas, and the legend under it. On the canvas the owner drags blocks and
 * links from a block's right handle to another block. While a link is dragged, the blocks it may
 * end on are highlighted and the others fade (`canConnect`); a drop on one makes the link when one
 * kind fits, offers a small choice by the drop point when several do, and is refused in
 * `canConnect`'s own words when none does. Delete or Backspace removes the selected block or link
 * (the steps every workflow has can't be removed), the arrow keys nudge a focused block, and
 * Escape clears the selection.
 */
export function GraphEditor(props: {
  graph: WorkflowGraph;
  selection: Selection;
  issues: readonly EditorIssue[];
  context: BlockContext;
  refusal: string | null;
  dispatch: Dispatch<EditorAction>;
  focus: FocusRequest | null;
}) {
  const [legendOpen, setLegendOpen] = useLegendOpen();
  return (
    <ReactFlowProvider>
      <section
        aria-label={G.canvasTitle}
        data-testid="workflow-card"
        className="min-w-0 rounded-card border border-line bg-panel shadow-card"
      >
        <div
          aria-label={T.label}
          role="group"
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-t-[calc(var(--radius-card)-1px)] border-b border-line bg-subtle px-3 py-2"
        >
          <Palette
            graph={props.graph}
            dispatch={props.dispatch}
            selectedNode={props.selection?.kind === 'node' ? props.selection.id : undefined}
          />
          <div className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1">
            <LegendToggle open={legendOpen} onChange={setLegendOpen} />
            <HowItWorks />
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
            <ZoomControls />
          </div>
        </div>
        <Canvas {...props} />
        {legendOpen ? (
          <div className="rounded-b-[calc(var(--radius-card)-1px)] border-t border-line px-4 py-2.5">
            <Legend />
          </div>
        ) : null}
      </section>
    </ReactFlowProvider>
  );
}
