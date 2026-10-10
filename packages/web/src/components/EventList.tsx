import type { EventDto } from '@acp/core/api';
import { shortId } from '../lib/format';
import { href } from '../lib/router';
import { ProvenanceBadge } from './ProvenanceBadge';
import { Time } from './Time';

const MAX_VALUE = 80;

/**
 * One-line summary of an event payload. Payloads never hold conversation content (ADR-0009); this
 * shows their typed fields (ids, names, counts) compactly.
 */
export function summarizePayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([k, v]) => {
      if (v === null) return `${k}=null`;
      if (typeof v === 'string')
        return `${k}=${v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v}`;
      if (typeof v === 'number' || typeof v === 'boolean') return `${k}=${String(v)}`;
      return `${k}={…}`;
    })
    .join('  ');
}

function PayloadCell({ payload }: { payload: Record<string, unknown> }) {
  const text = summarizePayload(payload);
  return (
    <td className="max-w-[28rem] truncate py-1 font-mono text-[11px] text-dim" title={text}>
      {text}
    </td>
  );
}

export function EventList({
  events,
  showSession = true,
}: {
  events: readonly EventDto[];
  showSession?: boolean;
}) {
  if (events.length === 0) return <p className="text-dim italic">No events.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="text-[11px] text-dim">
          <tr className="border-b border-line">
            <th className="py-1 pr-2 font-medium">#</th>
            <th className="py-1 pr-2 font-medium">Occurred</th>
            <th className="py-1 pr-2 font-medium">Event</th>
            {showSession ? <th className="py-1 pr-2 font-medium">Session</th> : null}
            <th className="py-1 pr-2 font-medium">Channel</th>
            <th className="py-1 pr-2 font-medium">Provenance</th>
            <th className="py-1 pr-2 font-medium">Version</th>
            <th className="py-1 font-medium">Payload</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-line/60 align-top">
              <td className="py-1 pr-2 font-mono text-dim">{e.id}</td>
              <td className="py-1 pr-2">
                {e.occurredAt ? (
                  <Time iso={e.occurredAt} />
                ) : (
                  <span title="The record has no timestamp; showing when it was read">
                    <Time iso={e.observedAt} /> <span className="text-dim italic">(read at)</span>
                  </span>
                )}
              </td>
              <td className="py-1 pr-2 font-mono">{e.eventType}</td>
              {showSession ? (
                <td className="py-1 pr-2 font-mono">
                  {e.sessionId ? (
                    <a href={href.session(e.sessionId)} title={e.sessionId}>
                      {shortId(e.sessionId)}
                    </a>
                  ) : (
                    <span className="text-dim italic">—</span>
                  )}
                </td>
              ) : null}
              <td className="py-1 pr-2 font-mono">{e.channel}</td>
              <td className="py-1 pr-2">
                <ProvenanceBadge provenance={e.provenance} />
              </td>
              <td className="py-1 pr-2 font-mono text-dim">{e.providerVersion ?? '—'}</td>
              <PayloadCell payload={e.payload} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
