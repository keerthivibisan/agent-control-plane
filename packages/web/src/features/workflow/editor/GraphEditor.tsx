import type {
  NodePosition,
  WorkflowEdgeType,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeId,
} from '@acp/core';
import * as RadixPopover from '@radix-ui/react-popover';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useStoreApi,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type HandleType,
  type Node,
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
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from 'react';
import { buttonClass } from '../../../components/Button';
import { AlertIcon, CloseIcon } from '../../../components/icons';
import { floatingClass } from '../../../components/Menu';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { finishView } from '../finish';
import { FitIcon, RedoIcon, TidyIcon, UndoIcon, ZoomInIcon, ZoomOutIcon } from '../icons';
import { LinkConnectionLine, blockRects } from './ConnectionLine';
import { EDITOR_COPY } from './copy';
import { LinkSample, linkEdgeTypes } from './edges';
import { linkTargets, toFlowEdges, toFlowNodes, type BlockContext, type LinkEdge } from './flow';
import type { HistoryAction } from './history';
import type { EditorIssue } from './IssuesList';
import { graphBounds, layoutGraph } from './layout';
import { HowItWorks, Legend, LegendToggle, useLegendOpen } from './Legend';
import { LinkMenuAt } from './LinkMenu';
import {
  LinkActionsContext,
  LinkStoreContext,
  createLinkStore,
  useLinkState,
  type LinkActions,
  type LinkStore,
} from './link-store';
import {
  EDGE_SLOP,
  SNAP_RADIUS,
  drawnLabel,
  linkChoices,
  linkOutcome,
  reconnectTargets,
  resolveReconnect,
  snapTarget,
  type LinkChoice,
  type LinkEnd,
} from './linking';
import { blockNodeTypes, type BlockNode } from './nodes';
import { Palette } from './Palette';
import { tidyGraph, type EditorAction, type Selection } from './state';

const G = WORKFLOW_GRAPH_COPY;
const Z = EDITOR_COPY.zoom;
const T = EDITOR_COPY.toolbar;
const FIT = { padding: 0.1, maxZoom: 1 } as const;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.5;
/** How long Tidy layout's blocks glide to their places. */
const TIDY_MS = 320;

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const UNDO_KEYS = IS_MAC ? '⌘Z' : 'Ctrl+Z';
const REDO_KEYS = IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z';

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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

/** Whether the canvas may undo or redo (the toolbar's buttons). */
export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
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
    // The links as drawn: a link around the Finish block's hidden steps ends on the block.
    const edge =
      selection.kind === 'edge'
        ? finishView(latest.current).graph.edges.find((x) => x.id === selection.id)
        : null;
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

/** Undo, Redo and Tidy layout, for the canvas toolbar (v0.3.1 P-C). */
function HistoryControls({
  history,
  tidy,
  canTidy,
  dispatch,
}: {
  history: HistoryInfo;
  tidy: () => void;
  canTidy: boolean;
  dispatch: Dispatch<HistoryAction>;
}) {
  const icon = `${buttonClass('quiet', 'sm')} w-7 px-0`;
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={`${T.undo}, ${T.redo}`}>
      <button
        type="button"
        className={icon}
        onClick={() => dispatch({ type: 'undo' })}
        disabled={!history.canUndo}
        aria-label={T.undo}
        aria-keyshortcuts={IS_MAC ? 'Meta+Z' : 'Control+Z'}
        title={T.undoTitle(UNDO_KEYS)}
        data-testid="undo"
      >
        <UndoIcon size={15} />
      </button>
      <button
        type="button"
        className={icon}
        onClick={() => dispatch({ type: 'redo' })}
        disabled={!history.canRedo}
        aria-label={T.redo}
        aria-keyshortcuts={IS_MAC ? 'Meta+Shift+Z' : 'Control+Shift+Z'}
        title={T.redoTitle(REDO_KEYS)}
        data-testid="redo"
      >
        <RedoIcon size={15} />
      </button>
      <button
        type="button"
        className={buttonClass('quiet', 'sm')}
        onClick={tidy}
        disabled={!canTidy}
        title={canTidy ? T.tidyTitle : T.tidyDone}
        data-testid="tidy-layout"
      >
        <TidyIcon size={14} />
        {T.tidy}
      </button>
    </div>
  );
}

interface Choice {
  /** The stored ends (`resolveLink`). */
  from: WorkflowNodeId;
  to: WorkflowNodeId;
  /** The blocks as drawn, for the words and for focus afterwards. */
  shownFrom: WorkflowNodeId;
  shownTo: WorkflowNodeId;
  types: WorkflowEdgeType[];
  /** Where the link was dropped, in the canvas frame's pixels. */
  at: { x: number; y: number };
  /** A moved end: the link that gets the new ends (else a new link is made). */
  replace?: string;
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

// ---------------------------------------------------------------- keeping React Flow's work small

/** Equal for the canvas: the same primitives, arrays and plain objects, a few levels deep. */
function similar(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => similar(ra[k], rb[k], depth - 1));
}

/**
 * Hands React Flow the previous object for every node or edge that hasn't changed, so after an
 * edit only the blocks and links it touched re-render (the graph's own nodes keep their identity
 * in the reducer, and the mapping is pure).
 */
class StableList<T extends { id: string }> {
  private last = new Map<string, T>();
  share(list: readonly T[]): T[] {
    const out = list.map((item) => {
      const old = this.last.get(item.id);
      return old !== undefined && similar(old, item, 4) ? old : item;
    });
    this.last = new Map(out.map((i) => [i.id, i]));
    return out;
  }
}

function useStableList<T extends Node | Edge>(list: readonly T[]): T[] {
  const [cache] = useState(() => new StableList<T>());
  return useMemo(() => cache.share(list), [cache, list]);
}

/** Positions shown instead of the graph's: a block being dragged, blocks gliding to Tidy layout. */
type Overlay = ReadonlyMap<WorkflowNodeId, NodePosition> | null;

function Canvas({
  graph,
  selection,
  issues,
  context,
  refusal,
  dispatch,
  focus,
  store,
  tidyRef,
}: {
  graph: WorkflowGraph;
  selection: Selection;
  issues: readonly EditorIssue[];
  context: BlockContext;
  refusal: string | null;
  dispatch: Dispatch<HistoryAction>;
  focus: FocusRequest | null;
  store: LinkStore;
  /** Where the canvas puts its Tidy layout, for the toolbar's button. */
  tidyRef: MutableRefObject<(() => void) | null>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow<BlockNode, LinkEdge>();
  const flowStore = useStoreApi<BlockNode, LinkEdge>();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [menu, setMenu] = useState<{ id: WorkflowNodeId; at: { x: number; y: number } } | null>(
    null,
  );
  const [overlay, setOverlay] = useState<Overlay>(null);
  /** The link whose end is being moved, between React Flow's start and end callbacks. */
  const reconnecting = useRef<{ id: string; moving: LinkEnd } | null>(null);
  const animation = useRef<number | null>(null);
  const linkFrom = useLinkState((s) => s.from, store);
  const linkMode = useLinkState((s) => s.mode, store);

  // Event handlers read the latest graph without being re-created for every edit (so the blocks'
  // link actions keep their identity and no block re-renders for them).
  const latest = useRef(graph);
  useEffect(() => {
    latest.current = graph;
  });

  const positions = useMemo(() => layoutGraph(graph), [graph]);
  const mappedNodes = useMemo(
    () => toFlowNodes(graph, issues, selection, context, positions),
    [graph, issues, selection, context, positions],
  );
  const stableNodes = useStableList(mappedNodes);
  const nodes = useMemo(
    () =>
      overlay === null
        ? stableNodes
        : stableNodes.map((n) => {
            const p = overlay.get(n.id);
            return p === undefined ? n : { ...n, position: p };
          }),
    [stableNodes, overlay],
  );
  const mappedEdges = useMemo(
    () => toFlowEdges(graph, issues, selection, positions),
    [graph, issues, selection, positions],
  );
  const edges = useStableList(mappedEdges);

  const label = useCallback((id: string) => drawnLabel(graph, id), [graph]);

  const stopAnimation = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);
  useEffect(() => stopAnimation, [stopAnimation]);

  /**
   * Tidy layout: every block back in the automatic layout, gliding there from where it is (no
   * glide with reduced motion), then the view refits. One undo step.
   */
  const tidy = useCallback(() => {
    const g = latest.current;
    const next = tidyGraph(g);
    if (next === g) return;
    stopAnimation();
    const from = layoutGraph(g);
    const to = layoutGraph(next);
    const ids = finishView(next).graph.nodes.map((n) => n.id);
    dispatch({ type: 'tidy' });
    if (reducedMotion()) {
      setOverlay(null);
      void fitView({ ...FIT });
      return;
    }
    const at = (t: number) =>
      new Map(
        ids.map((id): [string, NodePosition] => {
          const a = from.get(id) ?? { x: 0, y: 0 };
          const b = to.get(id) ?? a;
          return [id, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }];
        }),
      );
    setOverlay(at(0));
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TIDY_MS);
      if (t >= 1) {
        animation.current = null;
        setOverlay(null);
        void fitView({ ...FIT, duration: 200 });
        return;
      }
      setOverlay(at(1 - (1 - t) ** 3));
      animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
  }, [dispatch, fitView, stopAnimation]);
  useEffect(() => {
    tidyRef.current = tidy;
    return () => {
      tidyRef.current = null;
    };
  }, [tidy, tidyRef]);

  /**
   * Block moves: while a block is dragged only the overlay changes (React Flow moves it and its
   * links; the graph, its problems and its routes stay as they are), and the drop is one
   * `move-node`, one undo step. A keyboard nudge is a move at once.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNode>[]) => {
      const moved: EditorAction[] = [];
      let dragging: Map<string, NodePosition> | null = null;
      for (const c of changes) {
        if (c.type === 'position') {
          if (c.dragging === true && c.position !== undefined) {
            dragging ??= new Map();
            dragging.set(c.id, c.position);
          } else if (c.position !== undefined) {
            moved.push({ type: 'move-node', id: c.id, position: c.position });
          }
        } else if (c.type === 'select') {
          dispatch(
            c.selected
              ? { type: 'select', selection: { kind: 'node', id: c.id } }
              : { type: 'deselect', id: c.id },
          );
        }
      }
      if (dragging !== null) {
        stopAnimation();
        const live = dragging;
        setOverlay((o) => {
          const next = new Map(o ?? []);
          for (const [id, p] of live) next.set(id, p);
          return next;
        });
      }
      if (moved.length > 0) {
        dispatch(moved.length === 1 && moved[0] ? moved[0] : { type: 'batch', actions: moved });
        setOverlay((o) => {
          if (o === null) return o;
          const next = new Map(o);
          for (const m of moved) if (m.type === 'move-node') next.delete(m.id);
          return next.size === 0 ? null : next;
        });
      }
    },
    [dispatch, stopAnimation],
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
  // One step for a delete: a block's own removal (which rejoins the final chain) runs before its
  // links are dropped, and one undo brings all of it back.
  const onDelete: OnDelete<BlockNode, LinkEdge> = useCallback(
    ({ nodes: gone, edges: goneEdges }) => {
      const ids = new Set(gone.map((n) => n.id));
      const actions: EditorAction[] = [
        ...gone.map((n): EditorAction => ({ type: 'remove-node', id: n.id })),
        ...goneEdges
          .filter((e) => !ids.has(e.source) && !ids.has(e.target))
          .map((e): EditorAction => ({ type: 'remove-edge', id: e.id })),
      ];
      if (actions.length > 0) dispatch({ type: 'batch', actions });
    },
    [dispatch],
  );

  /** A point in the canvas frame's pixels (for the chooser and the menu). */
  const framePoint = useCallback((clientX: number, clientY: number) => {
    const box = frame.current?.getBoundingClientRect();
    return box === undefined ? { x: 24, y: 24 } : { x: clientX - box.left, y: clientY - box.top };
  }, []);
  /** Where a block is, as a client point (its centre): the chooser for a click-made link. */
  const blockPoint = useCallback((id: string) => {
    const el = frame.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
    const r = el?.getBoundingClientRect();
    return r === undefined ? null : { clientX: r.left + r.width / 2, clientY: r.bottom - 4 };
  }, []);

  /**
   * Ends a link from `from` on `to` (both as drawn), however it was made: at once when one kind
   * fits, a choice by the drop point when several do, refused in `canConnect`'s words when none.
   */
  const finishLink = useCallback(
    (
      from: WorkflowNodeId,
      to: WorkflowNodeId | null,
      point: { clientX: number; clientY: number } | null,
    ) => {
      const outcome = linkOutcome(latest.current, from, to);
      if (outcome.kind === 'refused') {
        dispatch({ type: 'refuse', message: outcome.message });
      } else if (outcome.kind === 'link') {
        dispatch({ type: 'connect', from: outcome.from, to: outcome.to, edgeType: outcome.type });
      } else if (outcome.kind === 'choose' && to !== null) {
        const at = point === null ? { x: 24, y: 24 } : framePoint(point.clientX, point.clientY);
        setChoice({ ...outcome.option, shownFrom: from, shownTo: to, at });
      }
    },
    [dispatch, framePoint],
  );

  /** The block a link dropped at a client point ends on (`snapTarget`, as the line drew it). */
  const dropTarget = useCallback(
    (point: { clientX: number; clientY: number } | null, from: string): string | null => {
      if (point === null) return null;
      const p = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const { nodeLookup, transform } = flowStore.getState();
      const { targets } = store.get();
      const zoom = transform[2];
      const hit = snapTarget(
        p,
        blockRects(nodeLookup),
        targets,
        SNAP_RADIUS / zoom,
        from,
        EDGE_SLOP / zoom,
      );
      return hit?.id ?? null;
    },
    [screenToFlowPosition, flowStore, store],
  );

  const onConnectStart = useCallback(
    (_: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      if (params.nodeId === null) return;
      setMenu(null);
      const r = reconnecting.current;
      const targets =
        r !== null
          ? reconnectTargets(latest.current, r.id, r.moving)
          : linkTargets(latest.current, params.nodeId);
      store.set({
        from: params.nodeId,
        mode: r !== null ? 'reconnect' : 'drag',
        targets,
        snap: null,
      });
    },
    [store],
  );
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      // A moved link end is finished by onReconnectEnd, which React Flow calls next.
      if (reconnecting.current !== null) return;
      const from = state.fromNode?.id;
      const point = pointOf(event);
      const to = from === undefined ? null : dropTarget(point, from);
      store.reset();
      if (from !== undefined) finishLink(from, to, point);
    },
    [dropTarget, finishLink, store],
  );
  const onReconnectStart = useCallback(
    (_: ReactMouseEvent, edge: LinkEdge, handleType: HandleType) => {
      // `handleType` is the end that stays: the target staying means the source end moves.
      reconnecting.current = { id: edge.id, moving: handleType === 'target' ? 'source' : 'target' };
    },
    [],
  );
  /**
   * A link end dropped: onto a block core allows, the link moves there (keeping its kind when it
   * fits); onto a block it may not end on, the refusal says why; anywhere else it snaps back.
   */
  const onReconnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      _edge: LinkEdge,
      _type: HandleType,
      state: FinalConnectionState,
    ) => {
      const r = reconnecting.current;
      reconnecting.current = null;
      const fixed = state.fromNode?.id;
      const point = pointOf(event);
      const onto = r === null || fixed === undefined ? null : dropTarget(point, fixed);
      store.reset();
      if (r === null || onto === null) return;
      const g = latest.current;
      const result = resolveReconnect(g, r.id, r.moving, onto);
      if (result.kind === 'refused') {
        dispatch({ type: 'refuse', message: result.message });
      } else if (result.kind === 'ok') {
        const [only] = result.types;
        if (result.types.length === 1 && only !== undefined) {
          dispatch({
            type: 'reconnect',
            id: r.id,
            from: result.from,
            to: result.to,
            edgeType: only,
          });
        } else {
          const at = point === null ? { x: 24, y: 24 } : framePoint(point.clientX, point.clientY);
          const drawn = finishView(g).graph.edges.find((e) => e.id === r.id);
          setChoice({
            from: result.from,
            to: result.to,
            types: result.types,
            shownFrom: r.moving === 'source' ? onto : (drawn?.from ?? result.from),
            shownTo: r.moving === 'target' ? onto : (drawn?.to ?? result.to),
            at,
            replace: r.id,
          });
        }
      }
    },
    [dispatch, dropTarget, framePoint, store],
  );

  /** Click-to-link: a click on a connector starts a link, a click on a lit block ends it. */
  const clickTo = useCallback(
    (to: WorkflowNodeId) => {
      const { from } = store.get();
      store.reset();
      if (from !== null) finishLink(from, to, blockPoint(to));
    },
    [store, finishLink, blockPoint],
  );
  const actions: LinkActions = useMemo(
    () => ({
      connector: (id) => {
        const s = store.get();
        if (s.mode === 'click') {
          if (s.from === id) store.reset();
          else clickTo(id);
          return;
        }
        if (s.mode !== null) return;
        setMenu(null);
        const targets = linkTargets(latest.current, id);
        if (targets !== null) store.set({ from: id, mode: 'click', targets, snap: null });
      },
    }),
    [store, clickTo],
  );
  const onNodeClick = useCallback(
    (_: ReactMouseEvent, node: BlockNode) => {
      if (store.get().mode === 'click') clickTo(node.id);
    },
    [store, clickTo],
  );
  const onNodeMouseEnter = useCallback(
    (_: ReactMouseEvent, node: BlockNode) => {
      if (store.get().mode === 'click') store.set({ snap: node.id });
    },
    [store],
  );
  const onNodeMouseLeave = useCallback(
    (_: ReactMouseEvent, node: BlockNode) => {
      const s = store.get();
      if (s.mode === 'click' && s.snap === node.id) store.set({ snap: null });
    },
    [store],
  );
  const onPaneClick = useCallback(() => {
    store.reset();
    dispatch({ type: 'select', selection: null });
  }, [store, dispatch]);
  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: BlockNode) => {
      event.preventDefault();
      store.reset();
      setMenu({ id: node.id, at: framePoint(event.clientX, event.clientY) });
    },
    [store, framePoint],
  );

  // Escape cancels a click-made link wherever the focus is.
  useEffect(() => {
    if (linkMode !== 'click') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      store.reset();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [linkMode, store]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const block =
        e.target instanceof HTMLElement && e.target.classList.contains('react-flow__node')
          ? e.target.dataset['id']
          : undefined;
      // Enter on a focused block ends a click-made link there.
      if (e.key === 'Enter' && block !== undefined && store.get().mode === 'click') {
        e.preventDefault();
        clickTo(block);
        return;
      }
      // The context-menu key or Shift+F10 opens the block's menu.
      if (block !== undefined && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
        e.preventDefault();
        const r = (e.target as HTMLElement).getBoundingClientRect();
        setMenu({ id: block, at: framePoint(r.left + r.width / 2, r.top + r.height / 2) });
        return;
      }
      // Escape clears the selection, so the problems list shows again.
      if (e.key === 'Escape' && selection !== null && choice === null && menu === null) {
        dispatch({ type: 'select', selection: null });
      }
    },
    [selection, choice, menu, dispatch, store, clickTo, framePoint],
  );

  const shape = graph.nodes.map((n) => n.id).join(',');
  // The canvas takes the automatic layout's shape (moving a block doesn't resize it, so the view
  // never jumps mid-drag): it fills the width without empty bands, within the viewport. Measured
  // on the blocks as drawn (the Finish block, not the steps it stands for).
  const bounds = useMemo(() => {
    const unmoved = { ...graph, nodes: graph.nodes.map(withoutPosition) };
    return graphBounds(finishView(unmoved).graph, layoutGraph(unmoved));
  }, [graph]);
  const menuChoices = useMemo(
    () => (menu === null ? [] : linkChoices(graph, menu.id)),
    [graph, menu],
  );
  const focusBlock = useCallback((id: string) => {
    frame.current
      ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
      ?.focus({ preventScroll: true });
  }, []);
  return (
    <LinkActionsContext.Provider value={actions}>
      <div className="relative" ref={frame}>
        <div
          className="w-full overflow-hidden"
          style={{
            aspectRatio: `${bounds.width + 120} / ${bounds.height + 120}`,
            maxHeight: 'min(720px, calc(100vh - 17rem))',
            minHeight: 400,
          }}
          data-testid="graph-editor"
          data-connecting={linkFrom ?? undefined}
          data-link-mode={linkMode ?? undefined}
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
            onReconnect={keepForReconnectEnd}
            onReconnectStart={onReconnectStart}
            onReconnectEnd={onReconnectEnd}
            edgesReconnectable
            reconnectRadius={7}
            connectOnClick={false}
            onNodeClick={onNodeClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={onPaneClick}
            connectionLineComponent={LinkConnectionLine}
            connectionRadius={SNAP_RADIUS}
            connectionDragThreshold={4}
            deleteKeyCode={DELETE_KEYS}
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
            proOptions={PRO_OPTIONS}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <FitOnChange shape={shape} />
            <FocusOn request={focus} graph={graph} />
          </ReactFlow>
        </div>
        <p id="graph-editor-hint" className="sr-only">
          {G.canvasHint}
        </p>
        {linkMode === 'click' && linkFrom !== null ? (
          <div
            role="status"
            data-testid="click-link-hint"
            className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-control border border-accent/40 bg-accent-soft px-3 py-1.5 text-caption text-ink shadow-pop sm:inset-x-auto sm:left-3 sm:max-w-md"
          >
            <span className="min-w-0 flex-1">{EDITOR_COPY.clickLink.hint(label(linkFrom))}</span>
            <button
              type="button"
              className={buttonClass('quiet', 'sm')}
              onClick={() => store.reset()}
            >
              {EDITOR_COPY.clickLink.cancel}
            </button>
          </div>
        ) : null}
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
            from={label(choice.shownFrom)}
            to={label(choice.shownTo)}
            onClose={() => setChoice(null)}
            restoreFocus={() => focusBlock(choice.shownTo)}
            onChoose={(t) => {
              dispatch(
                choice.replace !== undefined
                  ? {
                      type: 'reconnect',
                      id: choice.replace,
                      from: choice.from,
                      to: choice.to,
                      edgeType: t,
                    }
                  : { type: 'connect', from: choice.from, to: choice.to, edgeType: t },
              );
              setChoice(null);
            }}
          />
        ) : null}
        {menu !== null ? (
          <LinkMenuAt
            at={menu.at}
            label={label(menu.id)}
            choices={menuChoices}
            onClose={() => setMenu(null)}
            restoreFocus={() => focusBlock(menu.id)}
            onPick={(c: LinkChoice) => {
              setMenu(null);
              dispatch({ type: 'connect', from: c.link.from, to: c.link.to, edgeType: c.type });
            }}
          />
        ) : null}
      </div>
    </LinkActionsContext.Provider>
  );
}

const DELETE_KEYS = ['Backspace', 'Delete'];
const PRO_OPTIONS = { hideAttribution: true };
/**
 * React Flow draws the grips at a link's ends only with an `onReconnect`; it calls it only for a
 * drop on a handle, while a drop anywhere on a block counts here, so `onReconnectEnd` does the work.
 */
function keepForReconnectEnd(): void {}

/** Whether a key press belongs to a text field (its own undo), not to the canvas. */
function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(target.type)
  );
}

/** ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z (and Ctrl+Y) redoes, outside text fields and dialogs. */
function useUndoKeys(dispatch: Dispatch<HistoryAction>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.shiftKey);
      const undo = key === 'z' && !e.shiftKey;
      if (!undo && !redo) return;
      if (inTextField(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]') !== null) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      e.preventDefault();
      dispatch({ type: redo ? 'redo' : 'undo' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dispatch]);
}

interface GraphEditorProps {
  graph: WorkflowGraph;
  selection: Selection;
  issues: readonly EditorIssue[];
  context: BlockContext;
  refusal: string | null;
  dispatch: Dispatch<HistoryAction>;
  focus: FocusRequest | null;
  history: HistoryInfo;
}

function EditorBox(props: GraphEditorProps) {
  const [legendOpen, setLegendOpen] = useLegendOpen();
  const [store] = useState(createLinkStore);
  const tidyRef = useRef<(() => void) | null>(null);
  const tidy = useCallback(() => tidyRef.current?.(), []);
  useUndoKeys(props.dispatch);
  const canTidy = props.graph.nodes.some((n) => n.position !== undefined);
  return (
    <LinkStoreContext.Provider value={store}>
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
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
          <HistoryControls
            history={props.history}
            tidy={tidy}
            canTidy={canTidy}
            dispatch={props.dispatch}
          />
          <div className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1">
            <LegendToggle open={legendOpen} onChange={setLegendOpen} />
            <HowItWorks />
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
            <ZoomControls />
          </div>
        </div>
        <Canvas {...props} store={store} tidyRef={tidyRef} />
        {legendOpen ? (
          <div className="rounded-b-[calc(var(--radius-card)-1px)] border-t border-line px-4 py-2.5">
            <Legend />
          </div>
        ) : null}
      </section>
    </LinkStoreContext.Provider>
  );
}

/**
 * The canvas box (v0.3.0 D-C; linking v0.3.1 P-C): a toolbar row (Add block; Undo, Redo and Tidy
 * layout; the legend's toggle, How this works and the zoom controls), the canvas, and the legend
 * under it. A link starts from any connector dot or edge of a block (drag it, or click a dot and
 * then a block); while it is made, the blocks it may end on glow and the others fade (core's
 * `canConnect`), the line follows the pointer and snaps onto the nearest of them. A drop makes the
 * link when one kind fits, offers a small choice by the drop point when several do, and is refused
 * in `canConnect`'s own words when none does. A selected link's ends can be dragged to other
 * blocks. Right-click (or the context-menu key) on a block lists the links it may make. Delete or
 * Backspace removes the selected block or link (the steps every workflow has can't be removed),
 * the arrow keys nudge a focused block, Escape clears the selection, ⌘Z / ⇧⌘Z undo and redo.
 */
export function GraphEditor(props: GraphEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorBox {...props} />
    </ReactFlowProvider>
  );
}
