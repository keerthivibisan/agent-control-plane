import type { CodeMapGraphEdge, CodeMapGraphNode } from '@acp/core/api';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { CODE_MAP_COPY } from '../../lib/copy';
import {
  CodeMapActionsContext,
  codeMapNodeTypes,
  type CodeMapActions,
  type GroupNode,
  type MapNode,
} from './CodeMapNodes';
import { canOpenFolder, edgeWidth, layoutCodeMap } from './layout';

const G = CODE_MAP_COPY.graph;

const FIT = { padding: 0.08, maxZoom: 1 } as const;
/** Above this many nodes, only what is on screen is rendered. */
const VISIBLE_ONLY_ABOVE = 300;

const BASE_STROKE = 'var(--color-line-strong)';
const HOT_STROKE = 'var(--color-accent)';

/** A request to bring one node into view (search and panel picks; not graph clicks). */
export interface FocusRequest {
  path: string;
  /** Bumped on every request, so picking the same file twice focuses it again. */
  n: number;
}

function FocusNode({ request, present }: { request: FocusRequest | null; present: boolean }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (request === null || !present) return;
    void fitView({ nodes: [{ id: request.path }], maxZoom: 1, padding: 0.4, duration: 300 });
  }, [fitView, request, present]);
  return null;
}

export interface CodeMapGraphProps {
  /** Names the view, so drilling in starts a fresh, fitted drawing. */
  viewKey: string;
  nodes: readonly CodeMapGraphNode[];
  edges: readonly CodeMapGraphEdge[];
  /** The open folder (null at the top), so its own node isn't offered as a drill target. */
  folder: string | null;
  activePath: string | null;
  focus: FocusRequest | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}

/**
 * The import graph (`@xyflow/react`): a box per folder, file or folder nodes inside, import links
 * between them (weighted at folder level). Read-only: nothing is dragged or connected. Hovering or
 * focusing a node highlights its links.
 */
export function CodeMapGraph({
  viewKey,
  nodes,
  edges,
  folder,
  activePath,
  focus,
  onOpenFile,
  onOpenFolder,
}: CodeMapGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => layoutCodeMap(nodes, edges), [nodes, edges]);

  const flowNodes = useMemo(() => {
    const out: (GroupNode | MapNode)[] = [];
    for (const g of layout.groups) {
      out.push({
        id: `group:${g.path}`,
        type: 'group-box',
        position: { x: g.x, y: g.y },
        width: g.width,
        height: g.height,
        data: { path: g.path, label: g.path === '.' ? G.rootGroup : g.path, count: g.count },
        selectable: false,
        focusable: false,
        zIndex: 0,
      });
    }
    for (const p of layout.nodes) {
      out.push({
        id: p.node.id,
        type: p.node.kind,
        parentId: `group:${p.group}`,
        position: { x: p.x, y: p.y },
        data: {
          node: p.node,
          active: p.node.id === activePath,
          openable: p.node.kind === 'folder' && canOpenFolder(p.node.id, folder),
        },
        focusable: false,
        zIndex: 1,
      });
    }
    return out;
  }, [layout, activePath, folder]);

  const baseEdges = useMemo<Edge[]>(
    () =>
      layout.edges.map((e) => ({
        id: JSON.stringify([e.from, e.to]),
        source: e.from,
        target: e.to,
        focusable: false,
        selectable: false,
        style: { stroke: BASE_STROKE, strokeWidth: edgeWidth(e.weight), opacity: 0.7 },
        data: { weight: e.weight },
      })),
    [layout],
  );

  // Only the hovered node's links change, so the other edges keep their objects and don't redraw.
  const hot = hovered ?? activePath;
  const flowEdges = useMemo(
    () =>
      hot === null
        ? baseEdges
        : baseEdges.map((e) =>
            e.source === hot || e.target === hot
              ? {
                  ...e,
                  zIndex: 2,
                  className: 'code-map-edge-hot',
                  style: { ...e.style, stroke: HOT_STROKE, opacity: 1 },
                }
              : e,
          ),
    [baseEdges, hot],
  );

  const actions = useMemo<CodeMapActions>(
    () => ({ openFile: onOpenFile, openFolder: onOpenFolder, hover: setHovered }),
    [onOpenFile, onOpenFolder],
  );

  const present = focus !== null && layout.nodes.some((p) => p.node.id === focus.path);

  return (
    <div
      className="h-[68vh] max-h-[860px] min-h-[420px] w-full"
      role="group"
      aria-label={G.label}
      data-testid="code-map-graph"
      data-hovered={hovered ?? undefined}
    >
      <CodeMapActionsContext.Provider value={actions}>
        <ReactFlow
          key={viewKey}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={codeMapNodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          onlyRenderVisibleElements={layout.nodes.length > VISIBLE_ONLY_ABOVE}
          fitView
          fitViewOptions={FIT}
          minZoom={0.05}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) =>
              n.type === 'group-box' ? 'var(--color-subtle)' : 'var(--color-line-strong)'
            }
            nodeStrokeColor="var(--color-line)"
            maskColor="var(--color-overlay)"
            ariaLabel={G.minimap}
          />
          <FocusNode request={focus} present={present} />
        </ReactFlow>
      </CodeMapActionsContext.Provider>
    </div>
  );
}
