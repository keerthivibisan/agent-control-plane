import type { ObservationAdapter } from '@acp/core';
import type {
  CandidateRootDto,
  CapabilitiesDto,
  DiagnosticsDto,
  HealthDto,
  EventDto,
  OverviewDto,
} from '@acp/core/api';
import { SessionStatusSchema, addUsageTotals, emptyUsageTotals } from '@acp/core';
import type { Queries, Repositories } from '@acp/db';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../http/cursor.js';
import type { Page } from './mappers.js';
import { toEventDto, type SessionsService } from './sessions.js';
import { toUsageTotalsDto } from './mappers.js';
import type { SessionStatusDto } from '@acp/core/api';

export interface HookState {
  receivedAny: boolean;
}

export interface SystemService {
  health(): HealthDto;
  capabilities(): Promise<CapabilitiesDto>;
  candidates(): Promise<CandidateRootDto[]>;
  diagnostics(): DiagnosticsDto;
  overview(): Promise<OverviewDto>;
  /** Newest-first events across all sessions. */
  events(cursor: string | undefined, limit?: number): Page<EventDto>;
}

const EventCursorSchema = z.object({ before: z.number().int().positive() });

export interface SystemServiceDeps {
  adapters: readonly ObservationAdapter[];
  repos: Repositories;
  queries: Queries;
  sessions: SessionsService;
  mode: 'live' | 'demo';
  version: string;
  hookReceiverUrl: string;
  hookState: HookState;
  /** Provider data root; used only to show checkpoint paths relative to it. */
  claudeDir: string;
}

const LIST_LIMIT = 20;

/** Never expose an absolute home path (DiagnosticsDto): relative to the data root, else the tail. */
function displayPath(sourcePath: string, dataRoot: string): string {
  if (sourcePath.includes('://')) return sourcePath;
  const prefix = dataRoot.endsWith('/') ? dataRoot : `${dataRoot}/`;
  if (sourcePath.startsWith(prefix)) return sourcePath.slice(prefix.length);
  return sourcePath.split('/').slice(-2).join('/') || sourcePath;
}

export function createSystemService(deps: SystemServiceDeps): SystemService {
  const roots = () =>
    deps.repos.projects.list().map((p) => ({ projectId: p.id, rootPath: p.rootPath }));

  async function candidates(): Promise<CandidateRootDto[]> {
    const lists = await Promise.all(deps.adapters.map((a) => a.discoverCandidates(roots())));
    return lists.flat().map((c) => ({
      provider: c.provider,
      cwd: c.cwd,
      sessionCount: c.sessionCount,
      lastSeenAt: c.lastSeenAt,
    }));
  }

  return {
    candidates,

    events(cursor, limit = 50) {
      const decoded = decodeCursor(cursor, EventCursorSchema);
      const page = deps.repos.events.listRecent({
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

    health: () => ({ status: 'ok', mode: deps.mode, version: deps.version }),

    async capabilities() {
      const providers = await Promise.all(deps.adapters.map((a) => a.capabilities()));
      return {
        mode: deps.mode,
        providers,
        hooks: { receiverUrl: deps.hookReceiverUrl, receivedAny: deps.hookState.receivedAny },
      };
    },

    diagnostics() {
      const counts = deps.queries.diagnosticsCounts();
      return {
        sources: deps.repos.checkpoints.list().map((c) => ({
          sourcePath: displayPath(c.sourcePath, deps.claudeDir),
          byteOffset: c.byteOffset,
          sizeBytes: c.sizeBytes,
          parseErrors: c.parseErrors,
          updatedAt: c.updatedAt,
        })),
        unrecognized: counts.unrecognized,
        edgeConflictCount: counts.edgeConflictCount,
        usageConflictCount: counts.usageConflictCount,
      };
    },

    async overview() {
      const all = deps.sessions.scan();
      const summaries = deps.sessions.summaries(all);
      const sessionsByStatus = Object.fromEntries(
        SessionStatusSchema.options.map((s) => [s, 0]),
      ) as OverviewDto['sessionsByStatus'];
      for (const s of summaries) sessionsByStatus[s.status.value] += 1;

      const byModel = deps.queries.usageSummary('model');
      const totals = byModel.reduce((acc, g) => addUsageTotals(acc, g.totals), emptyUsageTotals());

      // Attention = a Notification arrived and nothing has happened in the session since.
      const needsAttention = summaries
        .filter((s) => s.lastAttentionAt !== null && s.status.value !== 'ended')
        .filter((s) => s.lastEventAt === null || s.lastEventAt <= (s.lastAttentionAt ?? ''))
        .sort((a, b) => (b.lastAttentionAt ?? '').localeCompare(a.lastAttentionAt ?? ''))
        .slice(0, LIST_LIMIT);
      const isActive = (s: { status: SessionStatusDto }) => s.status.value === 'active';

      return {
        projectCount: deps.repos.projects.list().length,
        sessionsByStatus,
        totals: toUsageTotalsDto(totals),
        needsAttention,
        activeSessions: summaries.filter(isActive).slice(0, LIST_LIMIT),
        recentEvents: deps.repos.events.listRecent({ limit: LIST_LIMIT }).items.map(toEventDto),
        candidateRootCount: (await candidates()).length,
      };
    },
  };
}
