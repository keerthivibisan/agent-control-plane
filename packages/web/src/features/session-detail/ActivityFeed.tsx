import type { EventDto } from '@acp/core/api';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { RelativeTime } from '../../components/RelativeTime';
import { paths, schemas } from '../../lib/api';
import { describeEvent, EMPTY, SESSION_DETAIL_COPY } from '../../lib/copy';
import { formatExactTime } from '../../lib/format';
import { useQueryStore } from '../../lib/query';
import { useApiQueries } from '../sessions/use-api-queries';

const COPY = SESSION_DETAIL_COPY.activity;

interface EventPage {
  items: EventDto[];
  page: { nextCursor: string | null };
}

/**
 * The first `count` pages of a session's events, newest first. Each page's cursor is the CURRENT
 * `nextCursor` of the page before it, so when live updates push new events onto the first page,
 * the older pages follow it and nothing is skipped or shown twice.
 */
function useEventPages(sessionId: string, count: number) {
  const store = useQueryStore();
  const pagePaths: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < count; i++) {
    const path = paths.sessionEvents(sessionId, cursor);
    pagePaths.push(path);
    const next = store.getState<EventPage>(path).data?.page.nextCursor;
    if (!next) break;
    cursor = next;
  }
  return useApiQueries(pagePaths, schemas.eventPage);
}

/** Errors and waiting stand out a little; the sentence always says what happened. */
function dotClass(e: EventDto): string {
  if (
    e.eventType === 'provider.error' ||
    (e.eventType === 'tool.result' && e.payload.isError === true)
  )
    return 'bg-danger';
  if (e.eventType === 'session.attention') return 'bg-status-idle';
  if (e.eventType === 'subagent.spawned' || e.eventType === 'subagent.stopped') return 'bg-accent';
  return 'bg-line-strong';
}

function EventTime({ e }: { e: EventDto }) {
  if (e.occurredAt) return <RelativeTime iso={e.occurredAt} />;
  // No timestamp in the record: say so, and show when it was read instead.
  return (
    <span className="text-dim">
      {COPY.readAt} <RelativeTime iso={e.observedAt} />
    </span>
  );
}

/** Payload as short `key=value` pairs. Payloads hold typed fields only, never content (ADR-0009). */
function payloadText(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([k, v]) => {
      if (v === null || typeof v === 'number' || typeof v === 'boolean') return `${k}=${String(v)}`;
      if (typeof v === 'string') return `${k}=${v.length > 60 ? `${v.slice(0, 60)}…` : v}`;
      return `${k}={…}`;
    })
    .join('  ');
}

const RAW_COLUMNS: readonly Column<EventDto>[] = [
  {
    key: 'time',
    label: COPY.raw.occurred,
    cell: (e) =>
      e.occurredAt ? (
        <span className="whitespace-nowrap">{formatExactTime(e.occurredAt)}</span>
      ) : (
        <span className="text-dim">
          {COPY.readAt} {formatExactTime(e.observedAt)}
        </span>
      ),
  },
  {
    key: 'type',
    label: COPY.raw.event,
    cell: (e) => <code className="font-mono">{e.eventType}</code>,
  },
  { key: 'id', label: COPY.raw.eventId, cell: (e) => <span className="tabular-nums">{e.id}</span> },
  { key: 'channel', label: COPY.raw.channel, cell: (e) => e.channel },
  { key: 'provenance', label: COPY.raw.provenance, cell: (e) => e.provenance },
  {
    key: 'version',
    label: COPY.raw.version,
    cell: (e) => e.providerVersion ?? <span className="text-unavailable">—</span>,
  },
  {
    key: 'payload',
    label: COPY.raw.fields,
    className: 'lg:max-w-[26rem]',
    cell: (e) => {
      const text = payloadText(e.payload);
      return (
        <span className="block truncate font-mono text-caption text-dim" title={text}>
          {text}
        </span>
      );
    },
  },
];

/** "Activity": plain sentences, newest first, with "Load older"; raw events under Details. */
export function ActivityFeed({ sessionId }: { sessionId: string }) {
  const [count, setCount] = useState(1);
  const pages = useEventPages(sessionId, count);
  const events = pages.flatMap((p) => p.data?.items ?? []);
  const last = pages[pages.length - 1];
  const first = pages[0];
  const error = pages.find((p) => p.error)?.error ?? null;
  const loading = last?.data === undefined && last?.error === null;
  const nextCursor = last?.data?.page.nextCursor ?? null;

  return (
    <Card title={COPY.title} description={COPY.description} testId="activity">
      {error ? <ErrorNotice error={error} /> : null}
      {first?.data !== undefined && events.length === 0 ? (
        <EmptyState compact title={EMPTY.activity.title} text={EMPTY.activity.text} />
      ) : (
        <ol className="flex flex-col" aria-label={COPY.title}>
          {events.map((e) => (
            <li
              key={e.id}
              data-event-type={e.eventType}
              // A thin line joins the dots into a timeline; it stops at the first and last dot.
              className="relative flex items-baseline gap-3 py-2 before:absolute before:top-0 before:bottom-0 before:left-[3.5px] before:w-px before:bg-line first:before:top-4 last:before:bottom-[calc(100%-1rem)] only:before:hidden"
            >
              <span
                aria-hidden="true"
                className={`relative inline-block size-2 shrink-0 translate-y-[-1px] rounded-full ring-4 ring-panel ${dotClass(e)}`}
              />
              <span className="min-w-0 flex-1 break-words">{describeEvent(e)}</span>
              <span className="shrink-0 text-caption text-dim tabular-nums">
                <EventTime e={e} />
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex items-center justify-center gap-3 text-caption text-dim">
        {loading ? <span>{COPY.loading}</span> : null}
        {!loading && nextCursor !== null && pages.length === count ? (
          <Button onClick={() => setCount((c) => c + 1)}>{COPY.loadOlder}</Button>
        ) : null}
        {!loading && nextCursor === null && events.length > 0 ? <span>{COPY.start}</span> : null}
      </div>
      {events.length > 0 ? (
        <div className="mt-4">
          <Details summary={COPY.rawSummary} testId="raw-events">
            <div className="-mx-3.5 -my-3 overflow-x-auto">
              <DataTable
                label={COPY.rawTable}
                columns={RAW_COLUMNS}
                rows={events}
                rowKey={(e) => String(e.id)}
                rowAttributes={(e) => ({ 'data-event-id': String(e.id) })}
              />
            </div>
          </Details>
        </div>
      ) : null}
    </Card>
  );
}
