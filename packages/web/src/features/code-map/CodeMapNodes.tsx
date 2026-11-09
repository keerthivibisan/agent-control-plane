import type { CodeMapGraphNode } from '@acp/core/api';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { createContext, memo, useContext } from 'react';
import { CODE_MAP_COPY } from '../../lib/copy';
import { FILE_HEIGHT, FOLDER_HEIGHT, NODE_WIDTH, lastSegment } from './layout';

const G = CODE_MAP_COPY.graph;

/** What a node can do; one stable value for the whole graph, so nodes don't re-render on hover. */
export interface CodeMapActions {
  openFile: (path: string) => void;
  openFolder: (path: string) => void;
  hover: (id: string | null) => void;
}

export const CodeMapActionsContext = createContext<CodeMapActions>({
  openFile: () => undefined,
  openFolder: () => undefined,
  hover: () => undefined,
});

export interface MapNodeData extends Record<string, unknown> {
  node: CodeMapGraphNode;
  /** The file shown in the details panel (or picked in search). */
  active: boolean;
  /** A folder node that can be opened (not the root, not the folder already open). */
  openable: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  path: string;
  label: string;
  count: number;
}

export type MapNode = Node<MapNodeData, 'file' | 'folder'>;
export type GroupNode = Node<GroupNodeData, 'group-box'>;

const HANDLE = 'opacity-0! border-0! size-1! min-w-0! min-h-0! pointer-events-none!';

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Right} isConnectable={false} className={HANDLE} />
    </>
  );
}

// Light on purpose: up to 1500 of these render at once (no tooltips, no icons per node).
const BOX =
  'flex w-full items-center gap-1.5 rounded-[3px] border bg-panel px-2 text-left text-caption text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** One file: its name (the full path in the accessible name and on hover). */
const FileNodeView = memo(function FileNodeView({ data }: NodeProps<MapNode>) {
  const { node, active } = data;
  const actions = useContext(CodeMapActionsContext);
  return (
    <>
      <Handles />
      <button
        type="button"
        className={`${BOX} ${active ? 'border-accent bg-accent-soft font-medium' : 'border-line hover:border-line-strong'}`}
        style={{ width: NODE_WIDTH, height: FILE_HEIGHT }}
        title={node.id}
        aria-label={G.openFile(node.id)}
        data-testid="code-map-file"
        data-path={node.id}
        data-active={active ? 'true' : undefined}
        onClick={() => actions.openFile(node.id)}
        onMouseEnter={() => actions.hover(node.id)}
        onMouseLeave={() => actions.hover(null)}
        onFocus={() => actions.hover(node.id)}
        onBlur={() => actions.hover(null)}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-micro">{lastSegment(node.id)}</span>
        {node.isTest ? (
          <span className="shrink-0 rounded-[2px] border border-line px-1 text-micro text-dim">
            {G.test}
          </span>
        ) : null}
      </button>
    </>
  );
});

/** One folder (folder level): its name and file count; a click opens it. */
const FolderNodeView = memo(function FolderNodeView({ data }: NodeProps<MapNode>) {
  const { node, openable } = data;
  const actions = useContext(CodeMapActionsContext);
  const label = node.id === '.' ? G.rootGroup : lastSegment(node.id);
  const body = (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-mono text-micro font-medium">{label}</span>
      <span className="block text-micro text-dim">{G.files(node.fileCount)}</span>
    </span>
  );
  const hover = {
    onMouseEnter: () => actions.hover(node.id),
    onMouseLeave: () => actions.hover(null),
  };
  return (
    <>
      <Handles />
      {openable ? (
        <button
          type="button"
          className={`${BOX} border-line-strong hover:border-accent`}
          style={{ width: NODE_WIDTH, height: FOLDER_HEIGHT }}
          title={node.id}
          aria-label={G.openFolder(node.id)}
          data-testid="code-map-folder"
          data-path={node.id}
          onClick={() => actions.openFolder(node.id)}
          onFocus={() => actions.hover(node.id)}
          onBlur={() => actions.hover(null)}
          {...hover}
        >
          {body}
        </button>
      ) : (
        <div
          className={`${BOX} border-line`}
          style={{ width: NODE_WIDTH, height: FOLDER_HEIGHT }}
          title={node.id}
          data-testid="code-map-folder"
          data-path={node.id}
          {...hover}
        >
          {body}
        </div>
      )}
    </>
  );
});

/** A folder's box around its nodes, labelled with the folder's path. */
const GroupBoxView = memo(function GroupBoxView({ data, width, height }: NodeProps<GroupNode>) {
  return (
    <div
      className="rounded-card border border-line bg-subtle/70"
      style={{ width, height }}
      data-testid="code-map-group"
      data-path={data.path}
    >
      <div className="flex items-baseline gap-2 px-3 pt-2 text-caption">
        <span className="min-w-0 truncate font-mono font-medium text-ink" title={data.label}>
          {data.label}
        </span>
        <span className="shrink-0 text-micro text-dim">{data.count}</span>
      </div>
    </div>
  );
});

export const codeMapNodeTypes = {
  file: FileNodeView,
  folder: FolderNodeView,
  'group-box': GroupBoxView,
};
