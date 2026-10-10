import type { SessionSummaryDto } from '@acp/core/api';
import { sessionLabel, shortId } from '../lib/format';
import { href } from '../lib/router';
import { TOKEN_CATEGORIES } from '../lib/tokens';
import { StatusPill } from './StatusPill';
import { Time } from './Time';
import { TokenCount } from './TokenCount';

export function SessionName({ session }: { session: SessionSummaryDto }) {
  return (
    <span className="flex min-w-0 flex-col">
      <a href={href.session(session.id)} className="truncate" title={session.description ?? ''}>
        {sessionLabel(session)}
      </a>
      <span className="font-mono text-[11px] text-dim" title={session.id}>
        {shortId(session.id)}
        {session.providerAgentId ? ' · subagent' : ''}
        {session.origin === 'demo' ? ' · demo' : ''}
      </span>
    </span>
  );
}

/**
 * Sessions with their DIRECT usage per category. Aggregate usage is only shown where it is labeled
 * as such (detail page, tree nodes), so a column total here never double-counts subagents.
 */
export function SessionTable({
  sessions,
  projectNames,
  selectedId,
  onSelect,
  selectLabel = 'graph',
}: {
  sessions: readonly SessionSummaryDto[];
  projectNames?: ReadonlyMap<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  selectLabel?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="text-[11px] text-dim">
          <tr className="border-b border-line">
            <th className="py-1 pr-2 font-medium">Session</th>
            {projectNames ? <th className="py-1 pr-2 font-medium">Project</th> : null}
            <th className="py-1 pr-2 font-medium">Provider</th>
            <th className="py-1 pr-2 font-medium">Status</th>
            <th className="py-1 pr-2 font-medium">Models (observed)</th>
            {TOKEN_CATEGORIES.map((c) => (
              <th key={c.key} className="py-1 pr-2 text-right font-medium" title={c.label}>
                direct {c.short}
              </th>
            ))}
            <th className="py-1 pr-2 text-right font-medium" title="Direct subagent children">
              children
            </th>
            <th className="py-1 pr-2 font-medium">First seen</th>
            <th className="py-1 pr-2 font-medium">Last event</th>
            {onSelect ? <th className="py-1 font-medium" /> : null}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.id}
              className={`border-b border-line/60 align-top ${selectedId === s.id ? 'bg-sunken' : ''}`}
              data-session-id={s.id}
            >
              <td className="max-w-64 py-1 pr-2">
                <SessionName session={s} />
              </td>
              {projectNames ? (
                <td className="py-1 pr-2">
                  {s.projectId ? (
                    <a href={href.project(s.projectId)}>
                      {projectNames.get(s.projectId) ?? shortId(s.projectId)}
                    </a>
                  ) : (
                    <span className="text-dim italic">none</span>
                  )}
                </td>
              ) : null}
              <td className="py-1 pr-2 font-mono">{s.provider}</td>
              <td className="py-1 pr-2">
                <StatusPill status={s.status} />
              </td>
              <td className="max-w-48 py-1 pr-2 font-mono text-[11px]">
                {s.models.length > 0 ? (
                  s.models.join(', ')
                ) : (
                  <span className="text-unavailable italic">none observed</span>
                )}
              </td>
              {TOKEN_CATEGORIES.map((c) => (
                <td key={c.key} className="py-1 pr-2 text-right font-mono">
                  <TokenCount
                    value={s.directUsage.tokens[c.key]}
                    unavailableRecords={s.directUsage.recordsWithUnavailable[c.key]}
                    recordCount={s.directUsage.recordCount}
                    compact
                  />
                </td>
              ))}
              <td className="py-1 pr-2 text-right font-mono">{s.childCount}</td>
              <td className="py-1 pr-2">
                <Time iso={s.firstSeenAt} />
              </td>
              <td className="py-1 pr-2">
                <Time iso={s.lastEventAt} fallback="no events" />
              </td>
              {onSelect ? (
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    aria-pressed={selectedId === s.id}
                    className="rounded border border-line px-1.5 text-[11px] hover:bg-sunken"
                  >
                    {selectLabel}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.length === 0 ? <p className="py-2 text-dim italic">No sessions.</p> : null}
    </div>
  );
}
