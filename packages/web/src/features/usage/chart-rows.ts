import type { TokenCounts } from '@acp/core';
import type { UsageSummaryDto, UsageTotalsDto } from '@acp/core/api';

export interface ChartRow extends TokenCounts {
  /** UTC day, `YYYY-MM-DD` (the API groups by `substr(occurred_at, 1, 10)`). */
  day: string;
}

export interface ChartData {
  rows: ChartRow[];
  /** Records with no timestamp can't be placed on a time axis; they are reported, not dropped. */
  undated: UsageTotalsDto | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `groupBy=day` groups to chart rows, ascending by day. Token values are copied as-is: `null`
 * (unavailable) stays `null`, so the chart shows a gap, never a zero. Days with no records have no
 * row at all (nothing is invented to fill the axis). The null-day group (`unknown`) becomes
 * `undated`.
 */
export function toChartRows(groups: UsageSummaryDto['groups']): ChartData {
  const rows: ChartRow[] = [];
  let undated: UsageTotalsDto | null = null;
  for (const g of groups) {
    if (!DAY.test(g.key)) {
      undated = g.usage;
      continue;
    }
    const t = g.usage.tokens;
    rows.push({
      day: g.key,
      input: t.input,
      output: t.output,
      cacheCreation: t.cacheCreation,
      cacheRead: t.cacheRead,
    });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  return { rows, undated };
}
