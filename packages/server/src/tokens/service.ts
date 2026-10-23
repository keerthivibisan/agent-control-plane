import { addUsageTotals, IsoTimestampSchema, tokenHeadline } from '@acp/core';
import type { ProjectTokensDto, ReportedCostUsdDto, TokenHeadlineDto } from '@acp/core/api';
import { createRepositories, createTokenQueries, type AcpDatabase, type TokenRow } from '@acp/db';
import { z } from 'zod';
import { badRequest, notFound } from '../errors.js';
import { createManagedSessionNames } from '../services/managed-sessions.js';
import { toUsageTotalsDto } from '../services/mappers.js';

/** `?from&to`: ISO-8601 timestamps, `from` inclusive and `to` exclusive, `from` before `to`. */
export const TokensQuerySchema = z
  .object({
    from: IsoTimestampSchema.optional(),
    to: IsoTimestampSchema.optional(),
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to),
    {
      message: 'from must be before to',
      path: ['from'],
    },
  );
export type TokensQuery = z.infer<typeof TokensQuerySchema>;

/** The DTO needs a non-empty model; records with no reported model are grouped under this key. */
export const UNKNOWN_MODEL = 'unknown';

export interface TokensService {
  /** Throws 404 for an unknown project and 400 for a bad range. */
  project(projectId: string, query: unknown): ProjectTokensDto;
}

const headlineDto = (h: TokenRow['headline']): TokenHeadlineDto => ({
  ...h,
  provenance: 'derived',
});
const rowDto = (r: TokenRow) => ({
  usage: toUsageTotalsDto(r.totals),
  headline: headlineDto(r.headline),
});

/** Provider-reported cost is `estimated` at best; a snapshot without one is `unavailable`. */
function costDto(snapshot: { reportedCostUsd: number | null } | null): ReportedCostUsdDto | null {
  if (snapshot === null) return null;
  return snapshot.reportedCostUsd === null
    ? { provenance: 'unavailable', value: null }
    : { provenance: 'estimated', value: snapshot.reportedCostUsd };
}

/**
 * The project Tokens page (docs/redesign/README.md §4.5): the db query does the accounting
 * (direct usage only, usage-accounting §6); this maps it to `ProjectTokensDto`, adding provenance.
 */
export function createTokensService(deps: { db: AcpDatabase; now?: () => Date }): TokensService {
  const queries = createTokenQueries(deps.db);
  const now = deps.now ?? (() => new Date());
  const repos = createRepositories(deps.db, { now });
  // ADR-0024 §2: the session list's names, for this page's per-session rows.
  const names = createManagedSessionNames({ db: deps.db, now });
  return {
    project(projectId, query) {
      const parsed = TokensQuerySchema.safeParse(query);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw badRequest(
          `${issue?.path.join('.') || 'range'}: ${issue?.message ?? 'invalid range'}`,
          'invalid_range',
        );
      }
      const t = queries.projectTokens(projectId, {
        from: parsed.data.from,
        to: parsed.data.to,
      });
      if (t === undefined) throw notFound(`Project ${projectId} not found`);

      // A record with no model and a model literally named "unknown" share the key: merge them, so
      // the key stays unique and nothing is dropped.
      const models = new Map<string, TokenRow>();
      for (const m of t.byModel) {
        const key = m.model ?? UNKNOWN_MODEL;
        const prev = models.get(key);
        const totals = prev === undefined ? m.totals : addUsageTotals(prev.totals, m.totals);
        models.set(key, { totals, headline: tokenHeadline(totals.tokens) });
      }

      const rows = new Map(
        repos.sessions.getByIds(t.bySession.map((s) => s.sessionId)).map((r) => [r.id, r]),
      );
      const managed = names.of([...rows.values()]);

      return {
        projectId: t.projectId,
        range: t.range,
        sessions: t.sessions,
        runs: t.runs,
        ticketsWithRuns: t.ticketsWithRuns,
        totals: toUsageTotalsDto(t.totals),
        headline: headlineDto(t.headline),
        byDay: t.byDay.map((d) => ({ day: d.day, ...rowDto(d) })),
        bySession: t.bySession.map((s) => {
          const row = rows.get(s.sessionId);
          const app = managed.get(s.sessionId);
          return {
            sessionId: s.sessionId,
            title: s.title === '' ? null : s.title,
            latestEstimatedCost: costDto(s.latestSnapshot),
            ...(app !== undefined && { managed: app }),
            ...(row !== undefined && {
              firstSeenAt: row.firstSeenAt,
              gitBranch: row.gitBranch,
              agentType: row.agentType,
            }),
            ...rowDto(s),
          };
        }),
        byTicket: t.byTicket.map((r) => ({
          ticketId: r.ticketId,
          key: r.key,
          title: r.title,
          ...rowDto(r),
        })),
        byRole: t.byRole.map((r) => ({ role: r.role, ...rowDto(r) })),
        byModel: [...models].map(([model, r]) => ({ model, ...rowDto(r) })),
      };
    },
  };
}

/**
 * One ticket's tokens (v0.3.0 T-A, the ticket badge): its direct usage, mapped exactly as the
 * Tokens page's `byTicket` row (the same cells, all time), so the two always show the same
 * numbers. `undefined` for an unknown project.
 */
export function createTicketTokens(
  db: AcpDatabase,
): (projectId: string, ticketId: string) => ReturnType<typeof rowDto> | undefined {
  const queries = createTokenQueries(db);
  return (projectId, ticketId) => {
    const r = queries.ticketTokens(projectId, ticketId);
    return r === undefined ? undefined : rowDto(r);
  };
}
