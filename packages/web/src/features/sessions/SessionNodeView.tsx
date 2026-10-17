import { Handle, Position, type NodeProps } from '@xyflow/react';
import { createContext, useContext } from 'react';
import { InfoTip } from '../../components/InfoTip';
import { RelativeTime } from '../../components/RelativeTime';
import { StatusBadge } from '../../components/StatusBadge';
import { GLOSSARY, SESSIONS_COPY } from '../../lib/copy';
import { idPrefix } from '../../lib/format';
import { href } from '../../lib/router';
import { NODE_WIDTH, type SessionNode } from './graph';
import { sessionName, TokenSummary } from './session-bits';

const COPY = SESSIONS_COPY.relate;

export const GraphActions = createContext<{ toggle: (id: string) => void }>({ toggle: () => {} });

/**
 * One session in the relationships graph: name, status, its own tokens (and with helpers when it
 * has any) and last activity. A session no link points at says "No known parent", explicitly.
 */
export function SessionNodeView({ data }: NodeProps<SessionNode>) {
  const { toggle } = useContext(GraphActions);
  const s = data.session;
  const hasLinks = data.childEdgeCount > 0;
  return (
    <div
      className={`rounded-card border bg-panel px-3.5 py-3 text-ink shadow-card ${
        data.isFocus
          ? 'border-accent ring-3 ring-accent/20'
          : 'border-line hover:border-line-strong'
      }`}
      style={{ width: NODE_WIDTH }}
      data-testid={`node-${s.id}`}
    >
      <Handle type="target" position={Position.Left} className="border-0! bg-line-strong!" />
      <div className="flex items-start gap-2">
        <a
          href={href.session(s.id)}
          className="nodrag min-w-0 flex-1 truncate font-medium"
          title={s.description ?? sessionName(s)}
        >
          {sessionName(s)}
        </a>
        <StatusBadge status={s.status} withTip={false} />
      </div>
      <div className="mt-0.5 font-mono text-caption text-dim">{idPrefix(s.id)}</div>
      <div className="mt-2 text-caption">
        <TokenSummary usage={s.directUsage} withCache={false} />
      </div>
      {s.childCount > 0 ? (
        <div className="mt-1 flex flex-col text-caption text-dim">
          <span>{COPY.withHelpers}:</span>
          <TokenSummary usage={data.aggregateUsage} withCache={false} />
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-dim">
        <span>
          {COPY.lastActivity}{' '}
          <RelativeTime iso={s.lastEventAt} fallback={SESSIONS_COPY.table.noActivity} />
        </span>
        {data.parent === 'unknown' ? (
          <span className="nodrag ml-auto inline-flex items-center gap-0.5">
            <span data-testid="node-parent-unknown">{GLOSSARY.noKnownParent.term}</span>
            <InfoTip tip={GLOSSARY.noKnownParent.tip} label={GLOSSARY.noKnownParent.term} />
          </span>
        ) : null}
      </div>
      {hasLinks ? (
        <button
          type="button"
          onClick={() => toggle(s.id)}
          className="nodrag mt-2 rounded-control px-1.5 py-0.5 text-caption font-medium text-accent hover:bg-hover"
          aria-expanded={!data.collapsed}
        >
          {data.collapsed
            ? COPY.showHidden(data.hiddenDescendants)
            : COPY.hideLinked(data.childEdgeCount)}
        </button>
      ) : null}
      <Handle type="source" position={Position.Right} className="border-0! bg-line-strong!" />
    </div>
  );
}
