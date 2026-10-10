import { UsageGroupBySchema } from '@acp/core/api';
import type { UsageQuery } from '../../lib/api';
import { href } from '../../lib/router';

/** Usage view state lives in the hash (`#/usage?groupBy=model&from=2026-10-01`). */
export interface UsageParams {
  groupBy: UsageQuery['groupBy'];
  /** Date-only (UTC) values, as typed in the date inputs. */
  from?: string | undefined;
  to?: string | undefined;
  projectId?: string | undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string | null) =>
  v !== null && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`)) ? v : undefined;

export function readUsageParams(search: URLSearchParams): UsageParams {
  const groupBy = UsageGroupBySchema.safeParse(search.get('groupBy'));
  const projectId = search.get('projectId')?.trim();
  return {
    groupBy: groupBy.success ? groupBy.data : 'project',
    from: validDate(search.get('from')),
    to: validDate(search.get('to')),
    projectId: projectId ? projectId : undefined,
  };
}

export function usageHref(p: UsageParams): string {
  return href.usage({ ...p });
}

/** Start of the UTC day after `day`. The server's `to` bound is exclusive. */
function nextDayStart(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();
}

/** The range is inclusive of both UTC days. */
export function toUsageQuery(p: UsageParams, groupBy: UsageQuery['groupBy']): UsageQuery {
  return {
    groupBy,
    from: p.from ? `${p.from}T00:00:00.000Z` : undefined,
    to: p.to ? nextDayStart(p.to) : undefined,
    projectId: p.projectId,
  };
}
