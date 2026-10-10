import type { AcpDatabase } from '../database.js';
import { createSessionListQueries, type SessionListQueries } from './sessions.js';
import { createSessionTreeQuery, type SessionTreeNode } from './tree.js';
import { createUsageQueries, type UsageQueries } from './usage.js';

/**
 * Read-side queries for the Phase 1 API (implementation plan B6). Recent events with id-cursor
 * pagination live on the events repository (`events.listRecent` / `events.listAfter`).
 */
export interface Queries extends SessionListQueries, UsageQueries {
  /** The session and its descendants over `subagent` edges (recursive CTE). */
  sessionTree(rootSessionId: string): SessionTreeNode[];
}

export function createQueries(db: AcpDatabase): Queries {
  const c = db.connection;
  return {
    ...createSessionListQueries(c),
    ...createUsageQueries(c),
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
export type { SessionTreeNode } from './tree.js';
export type {
  UnavailableCounts,
  UsageGroup,
  UsageGroupBy,
  UsageQueries,
  UsageSummaryFilter,
  UsageTotals,
} from './usage.js';
