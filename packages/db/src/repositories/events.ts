import { NormalizedEventSchema, type NormalizedEvent } from '@acp/core';
import type { RepositoryContext } from '../internal/context.js';
import {
  nonEmptyOrNull,
  pageLimit,
  parseInput,
  parseStored,
  parseStoredJson,
  toStoredTimestamp,
  toStoredTimestampOrNull,
  type Parser,
} from '../internal/validate.js';

export interface EventInsertInput {
  /** Validated with NormalizedEventSchema before insert. */
  event: NormalizedEvent;
  /** Internal session id resolved by the pipeline, when the event belongs to a session. */
  sessionId: string | null;
  projectId: string | null;
}

export interface EventInsertResult {
  /** `false` when an event with the same `dedupKey` already exists (record-level dedup). */
  inserted: boolean;
  /** Row id of the new event, or of the existing one when not inserted. */
  id: number;
}

export interface StoredEvent {
  /** Monotonic row id; also the SSE event id. */
  id: number;
  sessionId: string | null;
  projectId: string | null;
  /** The event as stored, re-validated with NormalizedEventSchema. Timestamps are UTC `Z`. */
  event: NormalizedEvent;
}

export interface RecentEventsQuery {
  sessionId?: string;
  projectId?: string;
  /** Exclusive upper bound: pass the previous page's `nextBeforeId`. */
  beforeId?: number;
  /** 1..500, default 50. */
  limit?: number;
}

export interface EventPage {
  /** Newest first (descending id). */
  items: StoredEvent[];
  /** Cursor for the next (older) page, or null when this is the last page. */
  nextBeforeId: number | null;
}

export interface EventsRepository {
  /**
   * Inserts with `ON CONFLICT(dedup_key) DO NOTHING`. Projections must be updated only when
   * `inserted` is true (usage-accounting §4).
   */
  insertIfNew(input: EventInsertInput): EventInsertResult;
  getById(id: number): StoredEvent | undefined;
  getByDedupKey(dedupKey: string): StoredEvent | undefined;
  /** Recent events, newest first, with keyset pagination by id. */
  listRecent(query?: RecentEventsQuery): EventPage;
  /** Events with `id > afterId` in ascending order (SSE `Last-Event-ID` replay). */
  listAfter(afterId: number, limit?: number): StoredEvent[];
  /** Highest event id, or null when there are no events. */
  maxId(): number | null;
}

interface EventDbRow {
  id: number;
  schema_version: number;
  provider: string;
  event_type: string;
  dedup_key: string;
  source_event_id: string | null;
  provider_session_id: string | null;
  provider_agent_id: string | null;
  session_id: string | null;
  project_id: string | null;
  occurred_at: string | null;
  observed_at: string;
  provenance: string;
  channel: string;
  provider_version: string | null;
  source_path: string | null;
  source_offset: number | null;
  hook_event: string | null;
  payload: string;
}

const COLUMNS = `id, schema_version, provider, event_type, dedup_key, source_event_id,
  provider_session_id, provider_agent_id, session_id, project_id, occurred_at, observed_at,
  provenance, channel, provider_version, source_path, source_offset, hook_event, payload`;

const T = 'events';
const AnyJson: Parser<unknown> = { safeParse: (v) => ({ success: true, data: v }) };

function toStoredEvent(row: EventDbRow): StoredEvent {
  const event = parseStored(
    NormalizedEventSchema,
    {
      schemaVersion: row.schema_version,
      provider: row.provider,
      eventType: row.event_type,
      dedupKey: row.dedup_key,
      sourceEventId: row.source_event_id,
      providerSessionId: row.provider_session_id,
      providerAgentId: row.provider_agent_id,
      occurredAt: row.occurred_at,
      observedAt: row.observed_at,
      provenance: row.provenance,
      source: {
        channel: row.channel,
        providerVersion: row.provider_version,
        path: row.source_path,
        byteOffset: row.source_offset,
        hookEvent: row.hook_event,
      },
      payload: parseStoredJson(AnyJson, row.payload, T, 'payload'),
    },
    T,
    'payload',
  );
  return { id: row.id, sessionId: row.session_id, projectId: row.project_id, event };
}

export function createEventsRepository(ctx: RepositoryContext): EventsRepository {
  const c = ctx.connection;
  const insert = c.prepare(`
    INSERT INTO events (schema_version, provider, event_type, dedup_key, source_event_id,
      provider_session_id, provider_agent_id, session_id, project_id, occurred_at, observed_at,
      provenance, channel, provider_version, source_path, source_offset, hook_event, payload)
    VALUES (@schema_version, @provider, @event_type, @dedup_key, @source_event_id,
      @provider_session_id, @provider_agent_id, @session_id, @project_id, @occurred_at,
      @observed_at, @provenance, @channel, @provider_version, @source_path, @source_offset,
      @hook_event, @payload)
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id`);
  const idByDedup = c.prepare('SELECT id FROM events WHERE dedup_key = ?').pluck();
  const byId = c.prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?`);
  const byDedup = c.prepare(`SELECT ${COLUMNS} FROM events WHERE dedup_key = ?`);
  const recent = c.prepare(`
    SELECT ${COLUMNS} FROM events
    WHERE (@before_id IS NULL OR id < @before_id)
      AND (@session_id IS NULL OR session_id = @session_id)
      AND (@project_id IS NULL OR project_id = @project_id)
    ORDER BY id DESC LIMIT @limit`);
  const after = c.prepare(`SELECT ${COLUMNS} FROM events WHERE id > ? ORDER BY id LIMIT ?`);
  const max = c.prepare('SELECT MAX(id) FROM events').pluck();

  return {
    insertIfNew(input) {
      const e = parseInput(NormalizedEventSchema, input.event, 'normalized event');
      // Look up first: with AUTOINCREMENT, an INSERT that hits the conflict still consumes an id,
      // and re-ingestion (e.g. after a file rewrite) would otherwise leave large gaps.
      const existing = idByDedup.get(e.dedupKey) as number | undefined;
      if (existing !== undefined) return { inserted: false, id: existing };
      const row = insert.get({
        schema_version: e.schemaVersion,
        provider: e.provider,
        event_type: e.eventType,
        dedup_key: e.dedupKey,
        source_event_id: e.sourceEventId,
        provider_session_id: e.providerSessionId,
        provider_agent_id: e.providerAgentId,
        session_id: nonEmptyOrNull(input.sessionId, 'sessionId'),
        project_id: nonEmptyOrNull(input.projectId, 'projectId'),
        occurred_at: toStoredTimestampOrNull(e.occurredAt, 'occurredAt'),
        observed_at: toStoredTimestamp(e.observedAt, 'observedAt'),
        provenance: e.provenance,
        channel: e.source.channel,
        provider_version: e.source.providerVersion,
        source_path: e.source.path,
        source_offset: e.source.byteOffset,
        hook_event: e.source.hookEvent,
        payload: JSON.stringify(e.payload),
      }) as { id: number } | undefined;
      if (row) return { inserted: true, id: row.id };
      // Another connection inserted it between the lookup and the insert; the row now exists in
      // this connection's view, so this lookup cannot miss.
      return { inserted: false, id: idByDedup.get(e.dedupKey) as number };
    },
    getById(id) {
      const row = byId.get(id) as EventDbRow | undefined;
      return row && toStoredEvent(row);
    },
    getByDedupKey(dedupKey) {
      const row = byDedup.get(dedupKey) as EventDbRow | undefined;
      return row && toStoredEvent(row);
    },
    listRecent(query = {}) {
      const limit = pageLimit(query.limit);
      const rows = recent.all({
        before_id: query.beforeId ?? null,
        session_id: query.sessionId ?? null,
        project_id: query.projectId ?? null,
        limit: limit + 1,
      }) as EventDbRow[];
      const page = rows.slice(0, limit).map(toStoredEvent);
      const last = page.at(-1);
      return { items: page, nextBeforeId: rows.length > limit && last ? last.id : null };
    },
    listAfter(afterId, limit) {
      return (after.all(afterId, pageLimit(limit)) as EventDbRow[]).map(toStoredEvent);
    },
    maxId() {
      return (max.get() as number | null) ?? null;
    },
  };
}
