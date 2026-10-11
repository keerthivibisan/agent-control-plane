import { Background, Controls, ReactFlow } from '@xyflow/react';
import { useCallback, useMemo, useState } from 'react';
import { InfoTip } from '../../components/InfoTip';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { GLOSSARY, SESSIONS_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { buildGraph, EDGE_STYLE } from './graph';
import { GraphActions, SessionNodeView } from './SessionNodeView';

const COPY = SESSIONS_COPY.relate;
const nodeTypes = { session: SessionNodeView };

function LineSample({ kind }: { kind: keyof typeof EDGE_STYLE }) {
  const { stroke, dash } = EDGE_STYLE[kind];
  return (
    <svg width="32" height="8" aria-hidden="true" className="shrink-0">
      <line x1="0" y1="4" x2="26" y2="4" stroke={stroke} strokeWidth="2" strokeDasharray={dash} />
      <path d="M25 1 L31 4 L25 7 Z" fill={stroke} />
    </svg>
  );
}

function Legend() {
  return (
    <ul
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption text-dim"
      aria-label={SESSIONS_COPY.relate.legendLabel}
    >
      <li className="flex items-center gap-1.5">
        <LineSample kind="subagent" />
        {COPY.legend.subagent}
      </li>
      <li className="flex items-center gap-1.5">
        <LineSample kind="continuation" />
        {COPY.legend.continuation}
        <InfoTip tip={GLOSSARY.continued.tip} label={COPY.legend.continuation} />
      </li>
      <li className="flex items-center gap-1">
        {COPY.legend.noParent}
        <InfoTip tip={GLOSSARY.noKnownParent.tip} label={COPY.legend.noParent} />
      </li>
    </ul>
  );
}

/**
 * The family of sessions containing `sessionId` (GET /api/sessions/:id/tree), as a graph. Lines
 * come only from the tree's edges, which carry evidence; nothing is drawn from timing or folders.
 */
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
    <QueryView query={tree} loading={COPY.loading}>
      {(t) => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <Legend />
            <p className="text-caption text-dim">
              {COPY.size(t.nodes.length)}
              {t.rootId !== sessionId ? ` · ${COPY.fromRoot}` : ''}
            </p>
          </div>
          {model && model.danglingEdges > 0 ? (
            <p role="alert" className="text-caption text-danger">
              {COPY.dangling(model.danglingEdges)}
            </p>
          ) : null}
          <div className="h-[520px] overflow-hidden rounded-control border border-line">
            <GraphActions.Provider value={actions}>
              <ReactFlow
                nodes={model?.nodes ?? []}
                edges={model?.edges ?? []}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="var(--color-line-strong)" gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </GraphActions.Provider>
          </div>
          <p className="text-caption text-dim">{COPY.evidenceNote}</p>
        </div>
      )}
    </QueryView>
  );
}
