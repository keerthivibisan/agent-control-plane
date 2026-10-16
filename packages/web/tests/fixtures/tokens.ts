// Synthetic ProjectTokensDto fixtures for the Tokens page (R-F). Ids, titles and numbers are fake.
import { tokenHeadline, type TokenCounts } from '@acp/core';
import {
  ProjectTokensDtoSchema,
  type ProjectTokensDto,
  type TokenHeadlineDto,
  type UsageTotalsDto,
} from '@acp/core/api';

export function totals(
  tokens: TokenCounts,
  recordCount = 1,
  missing: Partial<UsageTotalsDto['recordsWithUnavailable']> = {},
): UsageTotalsDto {
  return {
    tokens,
    recordCount,
    recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, ...missing },
    provenance: 'derived',
  };
}

/** The headline exactly as the server computes it, with core's `tokenHeadline()`. */
export function headlineOf(t: TokenCounts): TokenHeadlineDto {
  return { ...tokenHeadline(t), provenance: 'derived' };
}

const row = (usage: UsageTotalsDto) => ({ usage, headline: headlineOf(usage.tokens) });
const t = (
  input: number | null,
  output: number | null,
  cacheCreation: number | null,
  cacheRead: number | null,
): TokenCounts => ({ input, output, cacheCreation, cacheRead });

/**
 * A project with external and agent sessions: new work 12,400 tokens against 1.2M cache reads,
 * one partially reported record, one undated record, a ticket with no observed usage, and a
 * session without a reported cost.
 */
export function projectTokens(over: Partial<ProjectTokensDto> = {}): ProjectTokensDto {
  const all = totals(t(1_400, 11_000, 52_000, 1_200_000), 9, { input: 1, cacheCreation: 2 });
  const dto: ProjectTokensDto = {
    projectId: 'p-1',
    range: { from: null, to: null },
    sessions: { total: 6, withUsage: 4 },
    runs: 2,
    ticketsWithRuns: 2,
    totals: all,
    headline: headlineOf(all.tokens),
    byDay: [
      { day: '2026-10-14', ...row(totals(t(400, 3_000, 20_000, 300_000), 3)) },
      {
        day: '2026-10-15',
        ...row(totals(t(1_000, 8_000, 32_000, 900_000), 5, { input: 1, cacheCreation: 2 })),
      },
    ],
    bySession: [
      {
        sessionId: 'sess-aaaaaaaa-1',
        title: 'Fix the login redirect',
        latestEstimatedCost: { provenance: 'estimated', value: 1.25 },
        ...row(totals(t(900, 7_000, 30_000, 800_000), 5, { cacheCreation: 1 })),
      },
      {
        sessionId: 'sess-bbbbbbbb-2',
        title: null,
        latestEstimatedCost: null,
        ...row(totals(t(500, 4_000, 22_000, 400_000), 3, { input: 1, cacheCreation: 1 })),
      },
      {
        sessionId: 'sess-cccccccc-3',
        title: 'Lead',
        latestEstimatedCost: { provenance: 'unavailable', value: null },
        ...row(
          totals(t(null, null, null, null), 1, {
            input: 1,
            output: 1,
            cacheCreation: 1,
            cacheRead: 1,
          }),
        ),
      },
    ],
    byTicket: [
      {
        ticketId: 't-1',
        key: 'WEB-1',
        title: 'Dark mode',
        ...row(totals(t(500, 4_000, 22_000, 400_000), 3, { input: 1, cacheCreation: 1 })),
      },
      {
        ticketId: 't-2',
        key: 'WEB-2',
        title: 'Search',
        ...row(totals(t(null, null, null, null), 0)),
      },
    ],
    byRole: [
      { role: 'lead', ...row(totals(t(200, 1_500, 10_000, 150_000), 2)) },
      {
        role: 'worker',
        ...row(totals(t(300, 2_500, 12_000, 250_000), 1, { input: 1, cacheCreation: 1 })),
      },
      { role: 'external', ...row(totals(t(900, 7_000, 30_000, 800_000), 6, { cacheCreation: 1 })) },
    ],
    byModel: [
      { model: 'claude-opus-4-1', ...row(totals(t(1_400, 11_000, 52_000, 1_200_000), 8)) },
      { model: 'unknown', ...row(totals(t(null, null, null, null), 1)) },
    ],
    ...over,
  };
  // Fixtures must satisfy the real contract, or the tests would pass against a shape the server
  // never sends.
  return ProjectTokensDtoSchema.parse(dto);
}

/** A project whose sessions never reported usage. */
export function emptyProjectTokens(over: Partial<ProjectTokensDto> = {}): ProjectTokensDto {
  const none = totals(t(null, null, null, null), 0);
  return projectTokens({
    sessions: { total: 0, withUsage: 0 },
    runs: 0,
    ticketsWithRuns: 0,
    totals: none,
    headline: headlineOf(none.tokens),
    byDay: [],
    bySession: [],
    byTicket: [],
    byRole: [],
    byModel: [],
    ...over,
  });
}
