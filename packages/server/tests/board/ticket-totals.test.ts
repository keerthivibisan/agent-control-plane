// The ticket badge's numbers (v0.3.0 T-A), pure: `buildTicketTotals` with synthetic runs and
// usage; and the merge guards of the ticket branch actions (G-G) with fake dependencies.
import type { TicketBranchDto } from '@acp/core/api';
import type { TicketBranchRow } from '@acp/db';
import { describe, expect, it } from 'vitest';
import { createTicketBranchActions } from '../../src/board/ticket-branch-actions.js';
import { buildTicketTotals } from '../../src/board/ticket-totals.js';
import { HttpError } from '../../src/errors.js';

const T0 = '2026-10-23T09:00:00.000Z';
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const NULLS = { input: null, output: null, cacheCreation: null, cacheRead: null };
const UNAVAILABLE = {
  usage: {
    recordCount: 0,
    tokens: NULLS,
    recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    provenance: 'derived' as const,
  },
  headline: {
    newWork: null,
    totalProcessed: null,
    cacheReuseShare: null,
    provenance: 'derived' as const,
  },
};
const ticket = (status: 'ACTIVE' | 'DONE' | 'CANCELLED' | 'READY', updatedAt = at(500)) => ({
  id: 't1',
  status,
  updatedAt,
});

describe('buildTicketTotals', () => {
  it('no runs: nothing started, no elapsed time, usage unavailable (null, never 0)', () => {
    const t = buildTicketTotals({
      ticket: ticket('READY'),
      runs: [],
      usage: UNAVAILABLE,
      now: new Date(at(10)),
    });
    expect(t).toEqual({
      ticketId: 't1',
      startedAt: null,
      finishedAt: null,
      elapsedMs: null,
      runs: [],
      ...UNAVAILABLE,
    });
  });

  it('a live run counts to now with the injected clock', () => {
    const t = buildTicketTotals({
      ticket: ticket('ACTIVE'),
      runs: [{ id: 'r1', createdAt: at(0), endedAt: null }],
      usage: UNAVAILABLE,
      now: new Date(at(14)),
    });
    expect(t).toMatchObject({
      startedAt: at(0),
      finishedAt: null,
      elapsedMs: 14 * 60_000,
      runs: [{ runId: 'r1', startedAt: at(0), endedAt: null, durationMs: null }],
    });
  });

  it('done: from the first run’s start to the latest run end, whatever the clock says', () => {
    const t = buildTicketTotals({
      ticket: ticket('DONE'),
      // Out of order on purpose: sorted by start.
      runs: [
        { id: 'r2', createdAt: at(30), endedAt: at(72) },
        { id: 'r1', createdAt: at(0), endedAt: at(20) },
      ],
      usage: UNAVAILABLE,
      now: new Date(at(9999)),
    });
    expect(t).toMatchObject({
      startedAt: at(0),
      finishedAt: at(72),
      elapsedMs: 72 * 60_000,
      runs: [
        { runId: 'r1', durationMs: 20 * 60_000 },
        { runId: 'r2', durationMs: 42 * 60_000 },
      ],
    });
  });

  it('closed with no ended run: the ticket’s last update; reopened: counts to now again', () => {
    const runs = [{ id: 'r1', createdAt: at(0), endedAt: null }];
    const closed = buildTicketTotals({
      ticket: ticket('CANCELLED', at(5)),
      runs,
      usage: UNAVAILABLE,
      now: new Date(at(60)),
    });
    expect(closed).toMatchObject({ finishedAt: at(5), elapsedMs: 5 * 60_000 });
    const open = buildTicketTotals({
      ticket: ticket('ACTIVE'),
      runs: [{ id: 'r1', createdAt: at(0), endedAt: at(10) }],
      usage: UNAVAILABLE,
      now: new Date(at(60)),
    });
    expect(open).toMatchObject({ finishedAt: null, elapsedMs: 60 * 60_000 });
  });

  it('passes the usage through as given (partial stays partial)', () => {
    const usage = {
      usage: {
        recordCount: 3,
        tokens: { input: 10, output: 20, cacheCreation: null, cacheRead: 300 },
        recordsWithUnavailable: { input: 0, output: 0, cacheCreation: 3, cacheRead: 1 },
        provenance: 'derived' as const,
      },
      headline: {
        newWork: 30,
        totalProcessed: 330,
        cacheReuseShare: 300 / 330,
        provenance: 'derived' as const,
      },
    };
    const t = buildTicketTotals({ ticket: ticket('ACTIVE'), runs: [], usage, now: new Date(T0) });
    expect(t.usage).toEqual(usage.usage);
    expect(t.headline).toEqual(usage.headline);
  });
});

describe('ticket branch actions: merge guards (G-G)', () => {
  const row = (over: Partial<TicketBranchRow> = {}): TicketBranchRow => ({
    runId: 'r1',
    projectId: 'p1',
    branch: 'feature/WEB-1-x',
    baseBranch: 'develop',
    baseCommit: 'a'.repeat(40),
    headCommit: 'b'.repeat(40),
    state: 'open',
    mergedCommit: null,
    createdAt: T0,
    updatedAt: T0,
    pullRequest: {
      provider: 'github',
      number: 12,
      url: 'https://github.com/acme/widgets/pull/12',
      state: 'open',
      checkedAt: T0,
      pushedCommit: 'b'.repeat(40),
    },
    ...over,
  });
  const ctx = { runId: 'r1', projectRoot: '/tmp/none', strategy: undefined };
  const host = (calls: string[]) => ({
    mergePullRequest: () => {
      calls.push('merge');
      return Promise.resolve();
    },
    ticketBranchPresence: () => Promise.reject(new Error('no git here')),
    deleteTicketBranch: () => Promise.reject(new Error('unused')),
    deleteLocalBranch: () => Promise.resolve('deleted' as const),
  });
  const refreshed: TicketBranchDto = {
    runId: 'r1',
    branch: 'feature/WEB-1-x',
    baseBranch: 'develop',
    baseCommit: 'a'.repeat(40),
    headCommit: 'b'.repeat(40),
    state: 'merged',
    mergedCommit: 'b'.repeat(40),
    pullRequest: null,
    createdAt: T0,
    updatedAt: T0,
  };

  async function httpError(p: Promise<unknown>): Promise<HttpError> {
    try {
      await p;
    } catch (e) {
      if (e instanceof HttpError) return e;
      throw e;
    }
    throw new Error('expected an HttpError');
  }

  it('refuses unpushed commits before asking GitHub', async () => {
    const calls: string[] = [];
    const actions = createTicketBranchActions({
      refreshPullRequest: () => Promise.resolve(refreshed),
      peek: () => undefined,
      branchOf: () => row({ headCommit: 'c'.repeat(40) }),
      logger: { log() {} },
    });
    const e = await httpError(
      actions.merge(host(calls), ctx, { method: 'merge', deleteBranch: true }),
    );
    expect(e).toMatchObject({ status: 409, code: 'unpushed_commits' });
    expect(calls).toEqual([]);
  });

  it('no open pull request; a merged one read back badly says so; presence unread keeps the DTO', async () => {
    const calls: string[] = [];
    const none = createTicketBranchActions({
      refreshPullRequest: () => Promise.resolve(refreshed),
      peek: () => undefined,
      branchOf: () => row({ pullRequest: null }),
      logger: { log() {} },
    });
    expect(
      await httpError(none.merge(host(calls), ctx, { method: 'merge', deleteBranch: false })),
    ).toMatchObject({ status: 409, code: 'no_open_pull_request' });

    const failing = createTicketBranchActions({
      refreshPullRequest: () => Promise.reject(new HttpError(502, 'gh-failed', 'gh said no')),
      peek: () => undefined,
      branchOf: () => row(),
      logger: { log() {} },
    });
    const e = await httpError(
      failing.merge(host(calls), ctx, { method: 'merge', deleteBranch: false }),
    );
    expect(e).toMatchObject({ status: 502, code: 'gh-failed' });
    expect(e.message).toContain('GitHub merged pull request #12, but reading it back did not work');
    expect(calls).toEqual(['merge']);

    const ok = createTicketBranchActions({
      refreshPullRequest: () => Promise.resolve(refreshed),
      peek: () => undefined,
      branchOf: () => row(),
      logger: { log() {} },
    });
    const dto = await ok.merge(host(calls), ctx, { method: 'squash', deleteBranch: false });
    expect(dto).toEqual(refreshed);
    expect(dto).not.toHaveProperty('localExists');
  });
});
