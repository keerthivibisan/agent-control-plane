import { Background, Controls, ReactFlow } from '@xyflow/react';
import { useCallback, useMemo, useState } from 'react';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { useApiQuery } from '../../lib/query';
import { buildGraph } from './graph';
import { GraphActions, SessionNodeView } from './SessionNodeView';

const nodeTypes = { session: SessionNodeView };

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-dim">
      <span className="flex items-center gap-1">
        <svg width="28" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="28" y2="3" stroke="var(--color-accent)" strokeWidth="2" />
        </svg>
        subagent edge
      </span>
      <span className="flex items-center gap-1">
        <svg width="28" height="6" aria-hidden="true">
          <line
            x1="0"
            y1="3"
            x2="28"
            y2="3"
            stroke="#a855f7"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </svg>
        continuation (fork) edge
      </span>
      <span>Edges are verified relationships only; aggregate usage follows subagent edges.</span>
    </div>
  );
}

/** React Flow graph of the session tree containing `sessionId` (GET /api/sessions/:id/tree). */
export function SessionGraph({ sessionId }: { sessionId: string }) {
  const tree = useApiQuery(paths.sessionTree(sessionId), schemas.sessionTree);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const actions = useMemo(() => ({ toggle }), [toggle]);
  const model = useMemo(
    () => (tree.data ? buildGraph(tree.data, collapsed, sessionId) : null),
    [tree.data, collapsed, sessionId],
  );

  return (
    <QueryView query={tree} loading="Loading session tree…">
      {(t) => (
        <div className="flex flex-col gap-2">
          <Legend />
          {model && model.danglingEdges > 0 ? (
            <p role="alert" className="text-[11px] text-red-700 dark:text-red-300">
              {model.danglingEdges} edge{model.danglingEdges === 1 ? '' : 's'} referenced sessions
              missing from the tree response and were not drawn.
            </p>
          ) : null}
          <p className="text-[11px] text-dim">
            {t.nodes.length} session{t.nodes.length === 1 ? '' : 's'}, {t.edges.length} edge
            {t.edges.length === 1 ? '' : 's'}
            {t.rootId !== sessionId
              ? ' · the tree is shown from its root; the selected session is outlined'
              : ''}
          </p>
          <div className="h-[560px] rounded border border-line">
            <GraphActions.Provider value={actions}>
              <ReactFlow
                nodes={model?.nodes ?? []}
                edges={model?.edges ?? []}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                fitView
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </GraphActions.Provider>
          </div>
        </div>
      )}
    </QueryView>
  );
}
