// Contract tests for merging a pull request, deleting the ticket branch (ADR-0025 §9, v0.3.0 G-G)
// and the ticket totals badge (T-A). Additive: older payloads still parse. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MergePullRequestRequestSchema, TicketTotalsDtoSchema } from '../src/api/index.js';

describe('merging a pull request', () => {
  it('takes a method and whether to delete the branch', () => {
    expect(MergePullRequestRequestSchema.parse({ method: 'squash', deleteBranch: true })).toEqual({
      method: 'squash',
      deleteBranch: true,
    });
    expect(
      MergePullRequestRequestSchema.safeParse({ method: 'fast-forward', deleteBranch: true })
        .success,
    ).toBe(false);
  });
});

describe('ticket totals', () => {
  const usage = {
    tokens: { input: 10, output: 20, cacheCreation: null, cacheRead: 5 },
    recordCount: 3,
    recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 3, cacheRead: 0 },
    provenance: 'derived',
  };
  const headline = {
    newWork: 30,
    totalProcessed: 35,
    cacheReuseShare: 5 / 35,
    provenance: 'derived',
  };

  it('reads a finished ticket and one never started', () => {
    const done = TicketTotalsDtoSchema.parse({
      ticketId: 't1',
      startedAt: '2026-10-23T09:00:00.000Z',
      finishedAt: '2026-10-23T10:12:00.000Z',
      elapsedMs: 72 * 60_000,
      runs: [
        {
          runId: 'r1',
          startedAt: '2026-10-23T09:00:00.000Z',
          endedAt: '2026-10-23T09:40:00.000Z',
          durationMs: 40 * 60_000,
        },
      ],
      usage,
      headline,
    });
    expect(done.elapsedMs).toBe(72 * 60_000);
    const fresh = TicketTotalsDtoSchema.parse({
      ticketId: 't2',
      startedAt: null,
      finishedAt: null,
      elapsedMs: null,
      runs: [],
      usage: { ...usage, recordCount: 0 },
      headline: {
        newWork: null,
        totalProcessed: null,
        cacheReuseShare: null,
        provenance: 'derived',
      },
    });
    expect(fresh.runs).toEqual([]);
  });
});
