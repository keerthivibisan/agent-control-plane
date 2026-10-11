import type { EventDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { RelativeTime } from '../../components/RelativeTime';
import { describeEvent, EMPTY, NOT_REPORTED, OVERVIEW_COPY, TECH_LABELS } from '../../lib/copy';
import { idPrefix } from '../../lib/format';
import { href } from '../../lib/router';

/** How many sentences the feed shows; the raw table under Technical details lists the same ones. */
export const ACTIVITY_LIMIT = 10;

const mono = 'font-mono text-caption break-all';

const RAW_COLUMNS: readonly Column<EventDto>[] = [
  { key: 'id', label: TECH_LABELS.eventId, cell: (e) => <span className={mono}>{e.id}</span> },
  { key: 'type', label: TECH_LABELS.eventType, cell: (e) => <code>{e.eventType}</code> },
  {
    key: 'session',
    label: TECH_LABELS.sessionId,
    cell: (e) => <span className={mono}>{e.sessionId ?? NOT_REPORTED}</span>,
  },
  {
    key: 'at',
    label: TECH_LABELS.occurredAt,
    cell: (e) => <span className={mono}>{e.occurredAt ?? NOT_REPORTED}</span>,
  },
  { key: 'channel', label: TECH_LABELS.channel, cell: (e) => <code>{e.channel}</code> },
  { key: 'provenance', label: TECH_LABELS.provenance, cell: (e) => <code>{e.provenance}</code> },
];

/**
 * Recent activity as plain sentences (describeEvent), each linking to its session. The event
 * types, ids and channels stay available under Technical details. Payload content is never shown
 * (ADR-0009); describeEvent reads only names, counts and flags.
 */
export function ActivityFeed({
  events,
  sessionNames,
}: {
  events: readonly EventDto[];
  /** Names of sessions the overview already knows; others read "Session 1a2b3c4d". */
  sessionNames: ReadonlyMap<string, string>;
}) {
  const shown = events.slice(0, ACTIVITY_LIMIT);
  return (
    <Card title={OVERVIEW_COPY.activity.title} description={OVERVIEW_COPY.activity.description}>
      {shown.length === 0 ? (
        <EmptyState compact title={EMPTY.activity.title} text={EMPTY.activity.text} />
      ) : (
        <div className="flex flex-col gap-4">
          <ul
            data-testid="activity-feed"
            aria-label={OVERVIEW_COPY.activity.title}
            className="-my-2"
          >
            {shown.map((e) => (
              <li
                key={e.id}
                data-event-id={e.id}
                className="flex items-baseline gap-4 border-b border-line py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{describeEvent(e)}</div>
                  <div className="truncate text-caption">
                    {e.sessionId === null ? (
                      <span className="text-dim">{OVERVIEW_COPY.activity.unknownSession}</span>
                    ) : (
                      <a href={href.session(e.sessionId)}>
                        {sessionNames.get(e.sessionId) ??
                          OVERVIEW_COPY.sessionById(idPrefix(e.sessionId))}
                      </a>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-caption text-dim">
                  <RelativeTime iso={e.occurredAt} />
                </span>
              </li>
            ))}
          </ul>
          <Details summary={OVERVIEW_COPY.activity.raw} testId="raw-events">
            <DataTable
              label={TECH_LABELS.rawEvents}
              columns={RAW_COLUMNS}
              rows={shown}
              rowKey={(e) => String(e.id)}
            />
          </Details>
        </div>
      )}
    </Card>
  );
}
