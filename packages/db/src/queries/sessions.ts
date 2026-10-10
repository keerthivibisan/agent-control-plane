import { ProviderIdSchema, type IsoTimestamp, type ProviderId } from '@acp/core';
import type { SqliteConnection } from '../database.js';
import { DbError } from '../errors.js';
import { pageLimit, parseInput, placeholders, toStoredTimestamp } from '../internal/validate.js';
import {
  SESSION_COLUMNS,
  toSessionRow,
  type SessionDbRow,
  type SessionRow,
} from '../repositories/sessions.js';

export interface SessionListFilter {
  /** A project id, or `null` for sessions with no project. */
  projectId?: string | null;
  provider?: ProviderId;
  /** Sessions with at least one usage record of this model. */
  model?: string;
  /** Case-insensitive substring of the internal id, provider session id, or provider agent id. */
  search?: string;
  /** Only top-level sessions (no subagents). */
  topLevelOnly?: boolean;
  /**
   * Status inputs. Status is derived in TypeScript from the evidence columns; these bounds let
   * the caller narrow the candidates in SQL. `lastEventAfter` is inclusive, `lastEventBefore`
   * exclusive; sessions without `lastEventAt` match neither bound.
   */
  lastEventAfter?: IsoTimestamp;
  lastEventBefore?: IsoTimestamp;
  /** `true`: an end was observed (`endedAt` set); `false`: no observed end. */
  ended?: boolean;
}

/** Keyset position: the last row of the previous page. */
export interface SessionCursor {
  lastEventAt: IsoTimestamp | null;
  id: string;
}

export interface SessionPageRequest {
  /** 1..500, default 50. */
  limit?: number;
  cursor?: SessionCursor | null;
}

export interface SessionPage {
  /** Ordered by `lastEventAt` descending (sessions without one last), then `id` descending. */
  items: SessionRow[];
  nextCursor: SessionCursor | null;
}

export interface SessionListQueries {
  listSessions(filter?: SessionListFilter, page?: SessionPageRequest): SessionPage;
  /** Distinct models seen in each session's usage records (sorted; unknown model omitted). */
  modelsBySession(sessionIds: readonly string[]): Map<string, string[]>;
}

/**
 * Sort key matching the `sessions_activity_order` index on `(COALESCE(last_event_at, ''), id)`:
 * NULL sorts below every timestamp. Both columns descend, so SQLite walks the index backwards and
 * the keyset condition is a single row-value comparison.
 */
const ORDER_KEY = "COALESCE(last_event_at, '')";

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export function createSessionListQueries(c: SqliteConnection): SessionListQueries {
  return {
    listSessions(filter = {}, page = {}) {
      const limit = pageLimit(page.limit);
      const where: string[] = [];
      const params: Record<string, string | number> = { limit: limit + 1 };

      if (filter.projectId === null) {
        where.push('project_id IS NULL');
      } else if (filter.projectId !== undefined) {
        where.push('project_id = @project_id');
        params.project_id = filter.projectId;
      }
      if (filter.provider !== undefined) {
        where.push('provider = @provider');
        params.provider = parseInput(ProviderIdSchema, filter.provider, 'provider');
      }
      if (filter.model !== undefined) {
        where.push(
          'EXISTS (SELECT 1 FROM usage_records r WHERE r.session_id = sessions.id AND r.model = @model)',
        );
        params.model = filter.model;
      }
      if (filter.search !== undefined && filter.search.length > 0) {
        where.push(
          `(id LIKE @search ESCAPE '\\' OR provider_session_id LIKE @search ESCAPE '\\'
            OR provider_agent_id LIKE @search ESCAPE '\\')`,
        );
        params.search = likePattern(filter.search);
      }
      if (filter.topLevelOnly === true) where.push("provider_agent_id = ''");
      if (filter.lastEventAfter !== undefined) {
        where.push('last_event_at >= @last_event_after');
        params.last_event_after = toStoredTimestamp(filter.lastEventAfter, 'lastEventAfter');
      }
      if (filter.lastEventBefore !== undefined) {
        where.push('last_event_at < @last_event_before');
        params.last_event_before = toStoredTimestamp(filter.lastEventBefore, 'lastEventBefore');
      }
      if (filter.ended !== undefined) {
        where.push(filter.ended ? 'ended_at IS NOT NULL' : 'ended_at IS NULL');
      }
      if (page.cursor) {
        if (typeof page.cursor.id !== 'string' || page.cursor.id.length === 0) {
          throw new DbError('invalid_input', 'invalid session cursor');
        }
        where.push(`(${ORDER_KEY}, id) < (@cursor_key, @cursor_id)`);
        params.cursor_key =
          page.cursor.lastEventAt === null
            ? ''
            : toStoredTimestamp(page.cursor.lastEventAt, 'cursor.lastEventAt');
        params.cursor_id = page.cursor.id;
      }

      const rows = c
        .prepare(
          `SELECT ${SESSION_COLUMNS} FROM sessions
           ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY ${ORDER_KEY} DESC, id DESC
           LIMIT @limit`,
        )
        .all(params) as SessionDbRow[];

      const items = rows.slice(0, limit).map(toSessionRow);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last ? { lastEventAt: last.lastEventAt, id: last.id } : null,
      };
    },

    modelsBySession(sessionIds) {
      const out = new Map<string, string[]>();
      for (const id of sessionIds) out.set(id, []);
      for (let i = 0; i < sessionIds.length; i += 500) {
        const chunk = sessionIds.slice(i, i + 500);
        const rows = c
          .prepare(
            `SELECT DISTINCT session_id, model FROM usage_records
             WHERE model IS NOT NULL AND session_id IN (${placeholders(chunk.length)})
             ORDER BY session_id, model`,
          )
          .all(...chunk) as { session_id: string; model: string }[];
        for (const row of rows) out.get(row.session_id)?.push(row.model);
      }
      return out;
    },
  };
}
