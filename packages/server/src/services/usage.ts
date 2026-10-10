import { IsoTimestampSchema, addUsageTotals, emptyUsageTotals } from '@acp/core';
import { UsageGroupBySchema, type UsageGroupBy, type UsageSummaryDto } from '@acp/core/api';
import type { Queries, Repositories } from '@acp/db';
import { z } from 'zod';
import { toUsageTotalsDto } from './mappers.js';

export const UsageSummaryQuerySchema = z.object({
  groupBy: UsageGroupBySchema,
  from: IsoTimestampSchema.optional(),
  to: IsoTimestampSchema.optional(),
  projectId: z.string().min(1).optional(),
});
export type UsageSummaryQuery = z.infer<typeof UsageSummaryQuerySchema>;

/** Groups with no project, model, or time have a null key in SQL; the DTO needs a non-empty one. */
const NULL_KEYS: Record<UsageGroupBy, { key: string; label: string }> = {
  project: { key: 'unassigned', label: 'No project' },
  session: { key: 'unknown', label: 'Unknown session' },
  model: { key: 'unknown', label: 'Unknown model' },
  day: { key: 'unknown', label: 'Unknown date' },
};

export interface UsageService {
  summary(query: UsageSummaryQuery): UsageSummaryDto;
}

const toIso = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : new Date(value).toISOString();

export function createUsageService(deps: { repos: Repositories; queries: Queries }): UsageService {
  return {
    summary(query) {
      const from = toIso(query.from);
      const to = toIso(query.to);
      const groups = deps.queries.usageSummary(query.groupBy, {
        ...(query.projectId !== undefined && { projectId: query.projectId }),
        ...(from !== undefined && { from }),
        ...(to !== undefined && { to }),
      });

      const label = (key: string): string => {
        if (query.groupBy === 'project') return deps.repos.projects.getById(key)?.name ?? key;
        if (query.groupBy === 'session') {
          const s = deps.repos.sessions.getById(key);
          return s === undefined ? key : (s.title ?? s.providerAgentId ?? s.providerSessionId);
        }
        return key;
      };

      // Groups sum DIRECT usage, so adding them never counts a subagent's usage twice.
      let totals = emptyUsageTotals();
      const out = groups.map((g) => {
        totals = addUsageTotals(totals, g.totals);
        const fallback = NULL_KEYS[query.groupBy];
        return {
          key: g.key ?? fallback.key,
          label: g.key === null ? fallback.label : label(g.key),
          usage: toUsageTotalsDto(g.totals),
        };
      });
      return {
        groupBy: query.groupBy,
        groups: out,
        totals: toUsageTotalsDto(totals),
        range: { from: from ?? null, to: to ?? null },
      };
    },
  };
}
