import { UsageGroupBySchema } from '@acp/core/api';
import type { UsageQuery } from '../../lib/api';
import type { DatePreset } from '../../lib/copy';
import { href } from '../../lib/router';

/**
 * Tokens page state lives in the hash (`#/usage?groupBy=model&range=7d`). A preset is stored as
 * its name, not as dates, so a bookmarked "Last 7 days" still means the last 7 days tomorrow.
 * Custom ranges store their `from`/`to` days.
 */
export interface UsageParams {
  groupBy: UsageQuery['groupBy'];
  preset: DatePreset;
  /** Date-only (UTC) values: the resolved range, inclusive of both days. */
  from?: string | undefined;
  to?: string | undefined;
  projectId?: string | undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string | null) =>
  v !== null && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`)) ? v : undefined;

const DAY_MS = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The inclusive UTC days a preset covers, ending today (UTC). `all` has no bounds. */
export function presetRange(preset: '7d' | '30d', now: Date): { from: string; to: string } {
  const days = preset === '7d' ? 7 : 30;
  const today = Date.parse(`${utcDay(now.getTime())}T00:00:00.000Z`);
  return { from: utcDay(today - (days - 1) * DAY_MS), to: utcDay(today) };
}

export function readUsageParams(search: URLSearchParams, now: Date = new Date()): UsageParams {
  const groupBy = UsageGroupBySchema.safeParse(search.get('groupBy'));
  const projectId = search.get('projectId')?.trim();
  const base = {
    groupBy: groupBy.success ? groupBy.data : 'project',
    projectId: projectId ? projectId : undefined,
  } as const;
  const range = search.get('range');
  if (range === '7d' || range === '30d')
    return { ...base, preset: range, ...presetRange(range, now) };
  const from = validDate(search.get('from'));
  const to = validDate(search.get('to'));
  if (range === 'custom' || from !== undefined || to !== undefined) {
    return { ...base, preset: 'custom', from, to };
  }
  return { ...base, preset: 'all', from: undefined, to: undefined };
}

export function usageHref(p: Partial<UsageParams> & Pick<UsageParams, 'groupBy'>): string {
  const preset = p.preset ?? (p.from || p.to ? 'custom' : 'all');
  const custom = preset === 'custom';
  return href.usage({
    groupBy: p.groupBy,
    range: preset === 'all' ? undefined : custom && (p.from || p.to) ? undefined : preset,
    from: custom ? p.from : undefined,
    to: custom ? p.to : undefined,
    projectId: p.projectId,
  });
}

/** Start of the UTC day after `day`. The server's `to` bound is exclusive. */
function nextDayStart(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS).toISOString();
}

/** The range is inclusive of both UTC days. */
export function toUsageQuery(
  p: Pick<UsageParams, 'from' | 'to' | 'projectId'>,
  groupBy: UsageQuery['groupBy'],
): UsageQuery {
  return {
    groupBy,
    from: p.from ? `${p.from}T00:00:00.000Z` : undefined,
    to: p.to ? nextDayStart(p.to) : undefined,
    projectId: p.projectId,
  };
}
