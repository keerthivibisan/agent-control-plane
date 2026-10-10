import { ProviderIdSchema, SessionStatusSchema, type SessionStatusThresholds } from '@acp/core';
import type {
  EventDto,
  SessionDetailDto,
  SessionEdgeDto,
  SessionSummaryDto,
  SessionTreeDto,
  UsageSnapshotDto,
} from '@acp/core/api';
import type {
  EdgeRow,
  Queries,
  Repositories,
  SessionCursor,
  SessionRow,
  StoredEvent,
} from '@acp/db';
import { z } from 'zod';
import { badRequest, notFound } from '../errors.js';
import { decodeCursor, encodeCursor } from '../http/cursor.js';
import { statusOf, toReportedCostDto, toUsageTotalsDto, type Page } from './mappers.js';

export const SessionListQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  provider: ProviderIdSchema.optional(),
  status: SessionStatusSchema.optional(),
  model: z.string().min(1).optional(),
  q: z.string().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;

const SessionCursorSchema = z.object({ t: z.string().nullable(), id: z.string().min(1) });
const EventCursorSchema = z.object({ before: z.number().int().positive() });

interface WalkFilter {
  projectId?: string | undefined;
  provider?: SessionListQuery['provider'] | undefined;
  model?: string | undefined;
  q?: string | undefined;
}

const MAX_TREE_NODES = 500;
const SCAN_PAGE = 200;

export interface SessionsService {
  list(query: SessionListQuery): Page<SessionSummaryDto>;
  detail(id: string): SessionDetailDto;
  tree(id: string): SessionTreeDto;
  events(id: string, cursor: string | undefined, limit?: number): Page<EventDto>;
  /** Builds summaries for already-loaded rows (batched queries). */
  summaries(rows: readonly SessionRow[]): SessionSummaryDto[];
  /** Every session row matching the filter, newest first. For aggregate views (overview). */
  scan(filter?: { projectId?: string | undefined }): SessionRow[];
}

export interface SessionsServiceDeps {
  repos: Repositories;
  queries: Queries;
  now: () => Date;
  thresholds: SessionStatusThresholds;
}

export function toEventDto(stored: StoredEvent): EventDto {
  const e = stored.event;
  return {
    id: stored.id,
    eventType: e.eventType,
    provider: e.provider,
    sessionId: stored.sessionId,
    projectId: stored.projectId,
    occurredAt: e.occurredAt,
    observedAt: e.observedAt,
    provenance: e.provenance,
    channel: e.source.channel,
    providerVersion: e.source.providerVersion,
    payload: e.payload,
  };
}

function toEdgeDto(edge: EdgeRow): SessionEdgeDto {
  return {
    parentId: edge.parentSessionId,
    childId: edge.childSessionId,
    kind: edge.kind,
    provenance: edge.provenance,
    evidence: edge.evidence,
  };
}

export function createSessionsService(deps: SessionsServiceDeps): SessionsService {
  const { repos, queries } = deps;

  function summaries(rows: readonly SessionRow[]): SessionSummaryDto[] {
    const ids = rows.map((r) => r.id);
    const usage = queries.directUsageBySession(ids);
    const models = queries.modelsBySession(ids);
    const children = queries.childCountBySession(ids);
    const now = deps.now();
    return rows.map((row) => {
      const direct = usage.get(row.id);
      if (direct === undefined) throw new Error('directUsageBySession omitted a requested id');
      return {
        id: row.id,
        provider: row.provider,
        providerSessionId: row.providerSessionId,
        providerAgentId: row.providerAgentId,
        origin: row.origin,
        projectId: row.projectId,
        title: row.title,
        agentType: row.agentType,
        description: row.description,
        launchCwd: row.launchCwd,
        gitBranch: row.gitBranch,
        entrypoint: row.entrypoint,
        providerVersion: row.providerVersion,
        models: models.get(row.id) ?? [],
        status: statusOf(row, now, deps.thresholds),
        firstSeenAt: row.firstSeenAt,
        lastEventAt: row.lastEventAt,
        endedAt: row.endedAt,
        endReason: row.endReason,
        lastAttentionAt: row.lastAttentionAt,
        directUsage: toUsageTotalsDto(direct),
        childCount: children.get(row.id) ?? 0,
      };
    });
  }

  function* walk(filter: WalkFilter, from: SessionCursor | null) {
    let cursor = from;
    for (;;) {
      const page = queries.listSessions(
        {
          ...(filter.projectId !== undefined && { projectId: filter.projectId }),
          ...(filter.provider !== undefined && { provider: filter.provider }),
          ...(filter.model !== undefined && { model: filter.model }),
          ...(filter.q !== undefined && { search: filter.q }),
        },
        { limit: SCAN_PAGE, cursor },
      );
      yield* page.items;
      if (page.nextCursor === null) return;
      cursor = page.nextCursor;
    }
  }

  function requireSession(id: string): SessionRow {
    const row = repos.sessions.getById(id);
    if (row === undefined) throw notFound(`Session ${id} not found`);
    return row;
  }

  function parentEdge(id: string): EdgeRow | undefined {
    return repos.edges.getByChild('subagent', id) ?? repos.edges.getByChild('continuation', id);
  }

  function snapshotDto(sessionId: string): UsageSnapshotDto | null {
    const s = repos.snapshots.latestForSession(sessionId);
    if (s === undefined) return null;
    return {
      occurredAt: s.occurredAt,
      scope: s.scope,
      byModel: s.byModel,
      reportedCostUsd: toReportedCostDto(s.reportedCostUsd),
    };
  }

  return {
    summaries,

    list(query) {
      const cursor = decodeCursor(query.cursor, SessionCursorSchema);
      const now = deps.now();
      const out: SessionRow[] = [];
      let nextCursor: string | null = null;
      for (const row of walk(
        query,
        cursor === null ? null : { lastEventAt: cursor.t, id: cursor.id },
      )) {
        if (
          query.status !== undefined &&
          statusOf(row, now, deps.thresholds).value !== query.status
        ) {
          continue;
        }
        if (out.length === query.limit) {
          const last = out[out.length - 1];
          if (last !== undefined) nextCursor = encodeCursor({ t: last.lastEventAt, id: last.id });
          break;
        }
        out.push(row);
      }
      return { items: summaries(out), page: { nextCursor } };
    },

    scan(filter = {}) {
      return [...walk(filter, null)];
    },

    detail(id) {
      const row = requireSession(id);
      const [summary] = summaries([row]);
      if (summary === undefined) throw new Error('summary missing');
      const edge = parentEdge(id);
      const parentRow =
        edge === undefined ? undefined : repos.sessions.getById(edge.parentSessionId);
      return {
        ...summary,
        parent:
          edge === undefined || parentRow === undefined
            ? { state: 'unknown' }
            : {
                state: 'known',
                sessionId: edge.parentSessionId,
                kind: edge.kind,
                provenance: edge.provenance,
                evidence: edge.evidence,
              },
        aggregateUsage: toUsageTotalsDto(queries.aggregateUsage(id)),
        latestSnapshot: snapshotDto(id),
        continuationIds: repos.edges.listChildren(id, 'continuation').map((e) => e.childSessionId),
        ambiguousAttributionCount: queries.ambiguousAttributionCount(id),
      };
    },

    tree(id) {
      requireSession(id);
      // Walk to the topmost ancestor over verified edges; the visited set guards against cycles.
      let rootId = id;
      const seen = new Set([id]);
      for (;;) {
        const edge = parentEdge(rootId);
        if (edge === undefined || seen.has(edge.parentSessionId)) break;
        rootId = edge.parentSessionId;
        seen.add(rootId);
      }

      const order = [rootId];
      const visited = new Set(order);
      const edges = new Map<string, EdgeRow>();
      for (let i = 0; i < order.length && order.length < MAX_TREE_NODES; i++) {
        const current = order[i];
        if (current === undefined) break;
        for (const edge of repos.edges.listChildren(current)) {
          edges.set(edge.id, edge);
          if (!visited.has(edge.childSessionId)) {
            visited.add(edge.childSessionId);
            order.push(edge.childSessionId);
          }
        }
      }
      const rows = new Map(repos.sessions.getByIds(order).map((r) => [r.id, r]));
      const ordered = order.flatMap((sid) => {
        const row = rows.get(sid);
        return row === undefined ? [] : [row];
      });
      const nodes = summaries(ordered).map((session) => ({
        session,
        aggregateUsage: toUsageTotalsDto(queries.aggregateUsage(session.id)),
      }));
      const included = new Set(nodes.map((n) => n.session.id));
      return {
        rootId,
        nodes,
        edges: [...edges.values()]
          .filter((e) => included.has(e.parentSessionId) && included.has(e.childSessionId))
          .map(toEdgeDto),
      };
    },

    events(id, cursor, limit = 50) {
      requireSession(id);
      const decoded = decodeCursor(cursor, EventCursorSchema);
      if (limit < 1 || limit > 200) throw badRequest('limit must be between 1 and 200');
      const page = repos.events.listRecent({
        sessionId: id,
        ...(decoded !== null && { beforeId: decoded.before }),
        limit,
      });
      return {
        items: page.items.map(toEventDto),
        page: {
          nextCursor:
            page.nextBeforeId === null ? null : encodeCursor({ before: page.nextBeforeId }),
        },
      };
    },
  };
}
