import { TokenCountsSchema, type IsoTimestamp, type ProviderId, type TokenCounts } from '@acp/core';
import { DbError } from '../errors.js';
import type { SqliteConnection } from '../database.js';
import { parseStored, placeholders, toStoredTimestamp } from '../internal/validate.js';
import { subagentSubtreeCte } from './tree.js';

/** Count of records that did not report a category (so the UI can say "partial"). */
export interface UnavailableCounts {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/**
 * Null-preserving per-category sums over usage records (usage-accounting §6).
 * A category is `null` (unavailable) when every contributing record is null for it — including
 * when there are no records at all — and is never coerced to 0.
 */
export interface UsageTotals {
  recordCount: number;
  tokens: TokenCounts;
  recordsWithUnavailable: UnavailableCounts;
}

export type UsageGroupBy = 'project' | 'session' | 'model' | 'day';

export interface UsageSummaryFilter {
  projectId?: string;
  provider?: ProviderId;
  /** Inclusive lower bound on the record's `occurredAt`. Records without a time are excluded. */
  from?: IsoTimestamp;
  /** Exclusive upper bound on the record's `occurredAt`. Records without a time are excluded. */
  to?: IsoTimestamp;
}

export interface UsageGroup {
  /**
   * Project id, session id, model, or UTC day (`YYYY-MM-DD`). `null` groups records with no
   * project, no reported model, or no timestamp.
   */
  key: string | null;
  totals: UsageTotals;
}

/** SELECT list computing UsageTotals over the `r` alias of usage_records. */
export const TOTALS_SELECT = `
  COUNT(*) AS record_count,
  SUM(r.input_tokens) AS input,
  SUM(r.output_tokens) AS output,
  SUM(r.cache_creation_tokens) AS cache_creation,
  SUM(r.cache_read_tokens) AS cache_read,
  COUNT(*) - COUNT(r.input_tokens) AS input_unavailable,
  COUNT(*) - COUNT(r.output_tokens) AS output_unavailable,
  COUNT(*) - COUNT(r.cache_creation_tokens) AS cache_creation_unavailable,
  COUNT(*) - COUNT(r.cache_read_tokens) AS cache_read_unavailable`;

export interface TotalsDbRow {
  record_count: number;
  input: number | null;
  output: number | null;
  cache_creation: number | null;
  cache_read: number | null;
  input_unavailable: number;
  output_unavailable: number;
  cache_creation_unavailable: number;
  cache_read_unavailable: number;
}

export function toTotals(row: TotalsDbRow): UsageTotals {
  return {
    recordCount: row.record_count,
    tokens: parseStored(
      TokenCountsSchema,
      {
        input: row.input,
        output: row.output,
        cacheCreation: row.cache_creation,
        cacheRead: row.cache_read,
      },
      'usage_records',
      'tokens',
    ),
    recordsWithUnavailable: {
      input: row.input_unavailable,
      output: row.output_unavailable,
      cacheCreation: row.cache_creation_unavailable,
      cacheRead: row.cache_read_unavailable,
    },
  };
}

const EMPTY_ROW: TotalsDbRow = {
  record_count: 0,
  input: null,
  output: null,
  cache_creation: null,
  cache_read: null,
  input_unavailable: 0,
  output_unavailable: 0,
  cache_creation_unavailable: 0,
  cache_read_unavailable: 0,
};

const GROUP_KEYS: Record<UsageGroupBy, string> = {
  project: 's.project_id',
  session: 'r.session_id',
  model: 'r.model',
  day: 'substr(r.occurred_at, 1, 10)',
};

export interface UsageQueries {
  /** Direct usage: the sum of the records attributed to this session only. */
  directUsage(sessionId: string): UsageTotals;
  /** Direct usage for many sessions at once (list views). Every requested id gets an entry. */
  directUsageBySession(sessionIds: readonly string[]): Map<string, UsageTotals>;
  /**
   * Aggregate usage: direct usage of the session plus every descendant over `subagent` edges.
   * Continuation (fork) children are excluded; their copied messages are already attributed to
   * the original session.
   */
  aggregateUsage(rootSessionId: string): UsageTotals;
  /**
   * Usage grouped by project, session, model, or UTC day. Every group sums records directly, so
   * project and model totals never double-count subagents (usage-accounting §6).
   * Ordered by key, with the `null` group last.
   */
  usageSummary(groupBy: UsageGroupBy, filter?: UsageSummaryFilter): UsageGroup[];
}

export function createUsageQueries(c: SqliteConnection): UsageQueries {
  const direct = c.prepare(`SELECT ${TOTALS_SELECT} FROM usage_records r WHERE r.session_id = ?`);
  const aggregate = c.prepare(`
    WITH RECURSIVE ${subagentSubtreeCte('@root')}
    SELECT ${TOTALS_SELECT} FROM usage_records r
    WHERE r.session_id IN (SELECT session_id FROM subtree)`);

  return {
    directUsage(sessionId) {
      return toTotals(direct.get(sessionId) as TotalsDbRow);
    },
    directUsageBySession(sessionIds) {
      const out = new Map<string, UsageTotals>();
      for (const id of sessionIds) out.set(id, toTotals(EMPTY_ROW));
      for (let i = 0; i < sessionIds.length; i += 500) {
        const chunk = sessionIds.slice(i, i + 500);
        const rows = c
          .prepare(
            `SELECT r.session_id AS session_id, ${TOTALS_SELECT} FROM usage_records r
             WHERE r.session_id IN (${placeholders(chunk.length)}) GROUP BY r.session_id`,
          )
          .all(...chunk) as (TotalsDbRow & { session_id: string })[];
        for (const row of rows) out.set(row.session_id, toTotals(row));
      }
      return out;
    },
    aggregateUsage(rootSessionId) {
      return toTotals(aggregate.get({ root: rootSessionId }) as TotalsDbRow);
    },
    usageSummary(groupBy, filter = {}) {
      const keyExpr = GROUP_KEYS[groupBy];
      if (keyExpr === undefined) throw new DbError('invalid_input', 'invalid usage groupBy');
      const where: string[] = [];
      const params: Record<string, string> = {};
      if (filter.projectId !== undefined) {
        where.push('s.project_id = @project_id');
        params.project_id = filter.projectId;
      }
      if (filter.provider !== undefined) {
        where.push('r.provider = @provider');
        params.provider = filter.provider;
      }
      if (filter.from !== undefined) {
        where.push('r.occurred_at >= @from');
        params.from = toStoredTimestamp(filter.from, 'from');
      }
      if (filter.to !== undefined) {
        where.push('r.occurred_at < @to');
        params.to = toStoredTimestamp(filter.to, 'to');
      }
      const rows = c
        .prepare(
          `SELECT ${keyExpr} AS group_key, ${TOTALS_SELECT}
           FROM usage_records r JOIN sessions s ON s.id = r.session_id
           ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           GROUP BY group_key
           ORDER BY group_key IS NULL, group_key`,
        )
        .all(params) as (TotalsDbRow & { group_key: string | null })[];
      return rows.map((row) => ({ key: row.group_key, totals: toTotals(row) }));
    },
  };
}
