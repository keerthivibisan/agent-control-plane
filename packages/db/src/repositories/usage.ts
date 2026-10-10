import {
  IngestionChannelSchema,
  ProvenanceSchema,
  ProviderIdSchema,
  TokenCountsSchema,
  type IngestionChannel,
  type IsoTimestamp,
  type Provenance,
  type ProviderId,
  type SessionKey,
  type TokenCounts,
} from '@acp/core';
import { DbError } from '../errors.js';
import type { RepositoryContext } from '../internal/context.js';
import {
  nonEmptyOrNull,
  parseInput,
  parseStored,
  requireNonEmpty,
  storedTimestamp,
  storedTimestampOrNull,
  toStoredTimestampOrNull,
} from '../internal/validate.js';

export interface UsageObservationInput {
  /** The `usage.reported` event this observation came from (one observation per event). */
  eventId: number;
  provider: ProviderId;
  messageId: string;
  sessionId: string;
  occurredAt: IsoTimestamp | null;
  requestId: string | null;
  model: string | null;
  /** Each category nullable: null = unavailable, never 0. */
  tokens: TokenCounts;
}

export interface UsageObservationRow {
  eventId: number;
  provider: ProviderId;
  messageId: string;
  sessionId: string;
  /** Key of the observation's session, for attribution tie-breaks (usage-accounting §5). */
  sessionKey: SessionKey;
  occurredAt: IsoTimestamp | null;
  requestId: string | null;
  model: string | null;
  tokens: TokenCounts;
}

export interface UsageRecordInput {
  provider: ProviderId;
  messageId: string;
  /** Attributed session (earliest occurrence). */
  sessionId: string;
  /** Event id of the selected (max-output) observation. */
  selectedEventId: number | null;
  /** occurredAt of the attributed observation; drives per-day grouping. */
  occurredAt: IsoTimestamp | null;
  requestId: string | null;
  model: string | null;
  /** Categories from the selected observation only. */
  tokens: TokenCounts;
  observationCount: number;
  conflict: boolean;
  /** Default `transcript`. */
  source?: IngestionChannel;
  /** Default `observed`. */
  provenance?: Provenance;
}

export interface UsageRecordRow {
  id: string;
  provider: ProviderId;
  messageId: string;
  sessionId: string;
  selectedEventId: number | null;
  occurredAt: IsoTimestamp | null;
  requestId: string | null;
  model: string | null;
  tokens: TokenCounts;
  observationCount: number;
  conflict: boolean;
  source: IngestionChannel;
  provenance: Provenance;
  updatedAt: IsoTimestamp;
}

export interface UsageRepository {
  /** Stores an observation as received. Returns false if one already exists for the event. */
  insertObservation(input: UsageObservationInput): boolean;
  /**
   * All observations of one message across every session and file, ordered by occurredAt
   * (nulls last), then event id. Feed these to core's selection and attribution.
   */
  listObservationsByMessage(provider: ProviderId, messageId: string): UsageObservationRow[];
  /** Inserts or replaces the record for `(provider, messageId)`; the record id stays stable. */
  upsertRecord(input: UsageRecordInput): { id: string; created: boolean };
  getRecord(provider: ProviderId, messageId: string): UsageRecordRow | undefined;
  /** Removes a record (e.g. when only `<synthetic>` observations remain). */
  deleteRecord(provider: ProviderId, messageId: string): boolean;
  listRecordsForSession(sessionId: string): UsageRecordRow[];
}

const TOKEN_COLUMNS = 'input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens';

interface TokenDbColumns {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
}

interface ObservationDbRow extends TokenDbColumns {
  event_id: number;
  provider: string;
  message_id: string;
  session_id: string;
  occurred_at: string | null;
  request_id: string | null;
  model: string | null;
  s_provider: string;
  s_provider_session_id: string;
  s_provider_agent_id: string;
}

interface RecordDbRow extends TokenDbColumns {
  id: string;
  provider: string;
  message_id: string;
  session_id: string;
  selected_event_id: number | null;
  occurred_at: string | null;
  request_id: string | null;
  model: string | null;
  observation_count: number;
  conflict: number;
  source: string;
  provenance: string;
  updated_at: string;
}

const RECORD_COLUMNS = `id, provider, message_id, session_id, selected_event_id, occurred_at,
  request_id, model, ${TOKEN_COLUMNS}, observation_count, conflict, source, provenance, updated_at`;

export function storedTokens(row: TokenDbColumns, table: string): TokenCounts {
  return parseStored(
    TokenCountsSchema,
    {
      input: row.input_tokens,
      output: row.output_tokens,
      cacheCreation: row.cache_creation_tokens,
      cacheRead: row.cache_read_tokens,
    },
    table,
    'tokens',
  );
}

function tokenParams(tokens: TokenCounts) {
  const t = parseInput(TokenCountsSchema, tokens, 'token counts');
  return {
    input_tokens: t.input,
    output_tokens: t.output,
    cache_creation_tokens: t.cacheCreation,
    cache_read_tokens: t.cacheRead,
  };
}

function toObservation(row: ObservationDbRow): UsageObservationRow {
  const t = 'usage_observations';
  return {
    eventId: row.event_id,
    provider: parseStored(ProviderIdSchema, row.provider, t, 'provider'),
    messageId: row.message_id,
    sessionId: row.session_id,
    sessionKey: {
      provider: parseStored(ProviderIdSchema, row.s_provider, 'sessions', 'provider'),
      providerSessionId: row.s_provider_session_id,
      providerAgentId: row.s_provider_agent_id === '' ? null : row.s_provider_agent_id,
    },
    occurredAt: storedTimestampOrNull(row.occurred_at, t, 'occurred_at'),
    requestId: row.request_id,
    model: row.model,
    tokens: storedTokens(row, t),
  };
}

function toRecord(row: RecordDbRow): UsageRecordRow {
  const t = 'usage_records';
  return {
    id: row.id,
    provider: parseStored(ProviderIdSchema, row.provider, t, 'provider'),
    messageId: row.message_id,
    sessionId: row.session_id,
    selectedEventId: row.selected_event_id,
    occurredAt: storedTimestampOrNull(row.occurred_at, t, 'occurred_at'),
    requestId: row.request_id,
    model: row.model,
    tokens: storedTokens(row, t),
    observationCount: row.observation_count,
    conflict: row.conflict === 1,
    source: parseStored(IngestionChannelSchema, row.source, t, 'source'),
    provenance: parseStored(ProvenanceSchema, row.provenance, t, 'provenance'),
    updatedAt: storedTimestamp(row.updated_at, t, 'updated_at'),
  };
}

export function createUsageRepository(ctx: RepositoryContext): UsageRepository {
  const c = ctx.connection;
  const insertObservation = c.prepare(`
    INSERT INTO usage_observations (event_id, provider, message_id, session_id, occurred_at,
      request_id, model, ${TOKEN_COLUMNS})
    VALUES (@event_id, @provider, @message_id, @session_id, @occurred_at, @request_id, @model,
      @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens)
    ON CONFLICT (event_id) DO NOTHING`);
  const byMessage = c.prepare(`
    SELECT o.event_id, o.provider, o.message_id, o.session_id, o.occurred_at, o.request_id,
      o.model, o.input_tokens, o.output_tokens, o.cache_creation_tokens, o.cache_read_tokens,
      s.provider AS s_provider, s.provider_session_id AS s_provider_session_id,
      s.provider_agent_id AS s_provider_agent_id
    FROM usage_observations o JOIN sessions s ON s.id = o.session_id
    WHERE o.provider = ? AND o.message_id = ?
    ORDER BY o.occurred_at IS NULL, o.occurred_at, o.event_id`);
  const upsertRecord = c.prepare(`
    INSERT INTO usage_records (${RECORD_COLUMNS})
    VALUES (@id, @provider, @message_id, @session_id, @selected_event_id, @occurred_at,
      @request_id, @model, @input_tokens, @output_tokens, @cache_creation_tokens,
      @cache_read_tokens, @observation_count, @conflict, @source, @provenance, @updated_at)
    ON CONFLICT (provider, message_id) DO UPDATE SET
      session_id = excluded.session_id,
      selected_event_id = excluded.selected_event_id,
      occurred_at = excluded.occurred_at,
      request_id = excluded.request_id,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      observation_count = excluded.observation_count,
      conflict = excluded.conflict,
      source = excluded.source,
      provenance = excluded.provenance,
      updated_at = excluded.updated_at
    RETURNING id`);
  const getRecord = c.prepare(
    `SELECT ${RECORD_COLUMNS} FROM usage_records WHERE provider = ? AND message_id = ?`,
  );
  const deleteRecord = c.prepare('DELETE FROM usage_records WHERE provider = ? AND message_id = ?');
  const forSession = c.prepare(
    `SELECT ${RECORD_COLUMNS} FROM usage_records WHERE session_id = ?
     ORDER BY occurred_at IS NULL, occurred_at, message_id`,
  );

  return {
    insertObservation(input) {
      const result = insertObservation.run({
        event_id: input.eventId,
        provider: parseInput(ProviderIdSchema, input.provider, 'provider'),
        message_id: requireNonEmpty(input.messageId, 'messageId'),
        session_id: requireNonEmpty(input.sessionId, 'sessionId'),
        occurred_at: toStoredTimestampOrNull(input.occurredAt, 'occurredAt'),
        request_id: nonEmptyOrNull(input.requestId, 'requestId'),
        model: nonEmptyOrNull(input.model, 'model'),
        ...tokenParams(input.tokens),
      });
      return result.changes > 0;
    },
    listObservationsByMessage(provider, messageId) {
      return (byMessage.all(provider, messageId) as ObservationDbRow[]).map(toObservation);
    },
    upsertRecord(input) {
      if (!Number.isInteger(input.observationCount) || input.observationCount < 1) {
        throw new DbError('invalid_input', 'observationCount must be a positive integer');
      }
      const id = ctx.newId();
      const row = upsertRecord.get({
        id,
        provider: parseInput(ProviderIdSchema, input.provider, 'provider'),
        message_id: requireNonEmpty(input.messageId, 'messageId'),
        session_id: requireNonEmpty(input.sessionId, 'sessionId'),
        selected_event_id: input.selectedEventId,
        occurred_at: toStoredTimestampOrNull(input.occurredAt, 'occurredAt'),
        request_id: nonEmptyOrNull(input.requestId, 'requestId'),
        model: nonEmptyOrNull(input.model, 'model'),
        ...tokenParams(input.tokens),
        observation_count: input.observationCount,
        conflict: input.conflict ? 1 : 0,
        source: parseInput(IngestionChannelSchema, input.source ?? 'transcript', 'source'),
        provenance: parseInput(ProvenanceSchema, input.provenance ?? 'observed', 'provenance'),
        updated_at: ctx.now().toISOString(),
      }) as { id: string };
      return { id: row.id, created: row.id === id };
    },
    getRecord(provider, messageId) {
      const row = getRecord.get(provider, messageId) as RecordDbRow | undefined;
      return row && toRecord(row);
    },
    deleteRecord(provider, messageId) {
      return deleteRecord.run(provider, messageId).changes > 0;
    },
    listRecordsForSession(sessionId) {
      return (forSession.all(sessionId) as RecordDbRow[]).map(toRecord);
    },
  };
}
