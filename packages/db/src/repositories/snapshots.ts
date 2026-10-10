import {
  CumulativeUsageSnapshotSchema,
  ProviderIdSchema,
  unavailable,
  type CumulativeUsageSnapshot,
  type IsoTimestamp,
  type ProviderId,
  type Sourced,
  type TokenCounts,
} from '@acp/core';
import type { RepositoryContext } from '../internal/context.js';
import {
  parseInput,
  parseStored,
  parseStoredJson,
  requireNonEmpty,
  storedTimestamp,
  storedTimestampOrNull,
  toStoredTimestamp,
  toStoredTimestampOrNull,
  type Parser,
} from '../internal/validate.js';

export interface UsageSnapshotInput {
  /** The `usage.snapshot` event this snapshot came from. */
  eventId: number;
  provider: ProviderId;
  sessionId: string;
  occurredAt: IsoTimestamp | null;
  observedAt: IsoTimestamp;
  snapshot: CumulativeUsageSnapshot;
}

export interface UsageSnapshotRow {
  eventId: number;
  provider: ProviderId;
  sessionId: string;
  occurredAt: IsoTimestamp | null;
  observedAt: IsoTimestamp;
  scope: CumulativeUsageSnapshot['scope'];
  byModel: Record<string, TokenCounts>;
  /** Provider-reported cost: always `estimated`, or `unavailable` when not reported. */
  reportedCostUsd: Sourced<number>;
}

export interface SnapshotsRepository {
  /** Stores a provider running total. Never summed. Returns false if the event already has one. */
  insert(input: UsageSnapshotInput): boolean;
  /** The newest snapshot of a session by occurredAt (nulls oldest), then event id. */
  latestForSession(sessionId: string): UsageSnapshotRow | undefined;
  /** All snapshots of a session, oldest first. */
  listForSession(sessionId: string): UsageSnapshotRow[];
}

interface SnapshotDbRow {
  event_id: number;
  provider: string;
  session_id: string;
  occurred_at: string | null;
  observed_at: string;
  scope: string;
  by_model: string;
  reported_cost_usd: number | null;
}

const COLUMNS =
  'event_id, provider, session_id, occurred_at, observed_at, scope, by_model, reported_cost_usd';
const T = 'usage_snapshots';
const AnyJson: Parser<unknown> = { safeParse: (v) => ({ success: true, data: v }) };

function toSnapshot(row: SnapshotDbRow): UsageSnapshotRow {
  const snapshot = parseStored(
    CumulativeUsageSnapshotSchema,
    {
      kind: 'cumulative-snapshot',
      scope: row.scope,
      byModel: parseStoredJson(AnyJson, row.by_model, T, 'by_model'),
      reportedCostUsd: row.reported_cost_usd,
    },
    T,
    'by_model',
  );
  return {
    eventId: row.event_id,
    provider: parseStored(ProviderIdSchema, row.provider, T, 'provider'),
    sessionId: row.session_id,
    occurredAt: storedTimestampOrNull(row.occurred_at, T, 'occurred_at'),
    observedAt: storedTimestamp(row.observed_at, T, 'observed_at'),
    scope: snapshot.scope,
    byModel: snapshot.byModel,
    reportedCostUsd:
      snapshot.reportedCostUsd === null
        ? unavailable()
        : { provenance: 'estimated', value: snapshot.reportedCostUsd },
  };
}

export function createSnapshotsRepository(ctx: RepositoryContext): SnapshotsRepository {
  const c = ctx.connection;
  const insert = c.prepare(
    `INSERT INTO usage_snapshots (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_id) DO NOTHING`,
  );
  const latest = c.prepare(
    `SELECT ${COLUMNS} FROM usage_snapshots WHERE session_id = ?
     ORDER BY occurred_at IS NULL, occurred_at DESC, event_id DESC LIMIT 1`,
  );
  const all = c.prepare(
    `SELECT ${COLUMNS} FROM usage_snapshots WHERE session_id = ?
     ORDER BY occurred_at IS NULL DESC, occurred_at, event_id`,
  );

  return {
    insert(input) {
      const snapshot = parseInput(CumulativeUsageSnapshotSchema, input.snapshot, 'usage snapshot');
      const result = insert.run(
        input.eventId,
        parseInput(ProviderIdSchema, input.provider, 'provider'),
        requireNonEmpty(input.sessionId, 'sessionId'),
        toStoredTimestampOrNull(input.occurredAt, 'occurredAt'),
        toStoredTimestamp(input.observedAt, 'observedAt'),
        snapshot.scope,
        JSON.stringify(snapshot.byModel),
        snapshot.reportedCostUsd,
      );
      return result.changes > 0;
    },
    latestForSession(sessionId) {
      const row = latest.get(sessionId) as SnapshotDbRow | undefined;
      return row && toSnapshot(row);
    },
    listForSession(sessionId) {
      return (all.all(sessionId) as SnapshotDbRow[]).map(toSnapshot);
    },
  };
}
