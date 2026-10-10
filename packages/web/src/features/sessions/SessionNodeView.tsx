import type { UsageTotalsDto } from '@acp/core/api';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { createContext, useContext } from 'react';
import { StatusPill } from '../../components/StatusPill';
import { Time } from '../../components/Time';
import { TokenCount } from '../../components/TokenCount';
import { sessionLabel, shortId } from '../../lib/format';
import { href } from '../../lib/router';
import { TOKEN_CATEGORIES } from '../../lib/tokens';
import { NODE_WIDTH, type SessionNode } from './graph';

export const GraphActions = createContext<{ toggle: (id: string) => void }>({ toggle: () => {} });

function UsageRow({ label, usage }: { label: string; usage: UsageTotalsDto }) {
  return (
    <tr>
      <th className="pr-1 text-left font-normal text-dim">{label}</th>
      {TOKEN_CATEGORIES.map((c) => (
        <td key={c.key} className="px-0.5 text-right">
          <TokenCount
            value={usage.tokens[c.key]}
            unavailableRecords={usage.recordsWithUnavailable[c.key]}
            recordCount={usage.recordCount}
            compact
          />
        </td>
      ))}
    </tr>
  );
}

/** One session in the tree graph: identity, status, models, direct and aggregate usage, last seen. */
export function SessionNodeView({ data }: NodeProps<SessionNode>) {
  const { toggle } = useContext(GraphActions);
  const s = data.session;
  return (
    <div
      className={`rounded border bg-panel p-2 text-[11px] text-ink shadow-sm ${data.isFocus ? 'border-accent ring-2 ring-accent/40' : 'border-line'}`}
      style={{ width: NODE_WIDTH }}
      data-testid={`node-${s.id}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-start gap-1.5">
        <a
          href={href.session(s.id)}
          className="min-w-0 flex-1 truncate text-xs font-semibold"
          title={s.description ?? sessionLabel(s)}
        >
          {sessionLabel(s)}
        </a>
        <StatusPill status={s.status} />
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-dim">
        <span title={s.id}>{shortId(s.id)}</span>
        <span>{s.provider}</span>
        {s.agentType && s.title ? <span>{s.agentType}</span> : null}
        {s.providerAgentId ? <span>subagent</span> : null}
      </div>
      <div className="mt-0.5 truncate font-mono" title={s.models.join(', ')}>
        {s.models.length > 0 ? (
          s.models.join(', ')
        ) : (
          <span className="text-unavailable italic">no model observed</span>
        )}
      </div>
      <table className="mt-1 w-full font-mono">
        <thead>
          <tr className="text-dim">
            <th />
            {TOKEN_CATEGORIES.map((c) => (
              <th key={c.key} className="px-0.5 text-right font-normal">
                {c.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <UsageRow label="direct" usage={s.directUsage} />
          <UsageRow label="aggregate" usage={data.aggregateUsage} />
        </tbody>
      </table>
      <div className="mt-1 flex items-center gap-2 text-dim">
        <span>
          last seen <Time iso={s.lastEventAt} fallback="no events" />
        </span>
        {data.parent === 'unknown' ? (
          <span className="ml-auto italic" data-testid="node-parent-unknown">
            parent: unknown
          </span>
        ) : null}
      </div>
      {data.childEdgeCount > 0 ? (
        <button
          type="button"
          onClick={() => toggle(s.id)}
          className="nodrag mt-1 rounded border border-line px-1 hover:bg-sunken"
          aria-expanded={!data.collapsed}
        >
          {data.collapsed
            ? `expand (${data.hiddenDescendants} hidden)`
            : `collapse ${data.childEdgeCount} child edge${data.childEdgeCount === 1 ? '' : 's'}`}
        </button>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
