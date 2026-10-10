import type { AcpDatabase } from '../database.js';
import { createSessionListQueries, type SessionListQueries } from './sessions.js';
import { createStatsQueries, type StatsQueries } from './stats.js';
import { createSessionTreeQuery, type SessionTreeNode } from './tree.js';
import { createUsageQueries, type UsageQueries } from './usage.js';

/**
 * Read-side queries for the Phase 1 API (implementation plan B6). Recent events with id-cursor
 * pagination live on the events repository (`events.listRecent` / `events.listAfter`).
 * Totals use core's `UsageTotals`; `groupBy` uses `UsageGroupBy` from `@acp/core/api`.
 */
export interface Queries extends SessionListQueries, UsageQueries, StatsQueries {
  /** The session and its descendants over `subagent` edges (recursive CTE). */
  sessionTree(rootSessionId: string): SessionTreeNode[];
}

export function createQueries(db: AcpDatabase): Queries {
  const c = db.connection;
  return {
    ...createSessionListQueries(c),
    ...createUsageQueries(c),
    ...createStatsQueries(c),
    sessionTree: createSessionTreeQuery(c),
  };
}

export type {
  SessionCursor,
  SessionListFilter,
  SessionListQueries,
  SessionPage,
  SessionPageRequest,
} from './sessions.js';
export type {
  DiagnosticsCounts,
  ProjectStats,
  StatsQueries,
  UnrecognizedRecordCount,
} from './stats.js';
export type { SessionTreeNode } from './tree.js';
export type { UsageGroup, UsageQueries, UsageSummaryFilter } from './usage.js';
