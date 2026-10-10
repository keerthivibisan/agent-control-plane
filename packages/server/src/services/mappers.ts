import type { SessionStatusThresholds, Sourced, UsageTotals } from '@acp/core';
import { deriveSessionStatus } from '@acp/core';
import type { ReportedCostUsdDto, SessionStatusDto, UsageTotalsDto } from '@acp/core/api';
import type { SessionRow } from '@acp/db';

/** Row → DTO conversions shared by the read-model services. */

export function toUsageTotalsDto(t: UsageTotals): UsageTotalsDto {
  return {
    tokens: { ...t.tokens },
    recordCount: t.recordCount,
    recordsWithUnavailable: { ...t.recordsWithUnavailable },
    provenance: 'derived',
  };
}

export function statusOf(
  row: Pick<SessionRow, 'lastEventAt' | 'endedAt'>,
  now: Date,
  thresholds: SessionStatusThresholds,
): SessionStatusDto {
  return {
    value: deriveSessionStatus(
      { lastEventAt: row.lastEventAt, endedAt: row.endedAt },
      now,
      thresholds,
    ),
    provenance: 'derived',
    basis: { lastEventAt: row.lastEventAt, endedAt: row.endedAt, evaluatedAt: now.toISOString() },
  };
}

/** Provider-reported cost is `estimated` at best; a missing value stays `unavailable`, never 0. */
export function toReportedCostDto(cost: Sourced<number>): ReportedCostUsdDto {
  return cost.provenance === 'estimated'
    ? { provenance: 'estimated', value: cost.value }
    : { provenance: 'unavailable', value: null };
}

/** The `PageDto<T>` shape (`pageSchema` in `@acp/core/api` validates it). */
export interface Page<T> {
  items: T[];
  page: { nextCursor: string | null };
}
