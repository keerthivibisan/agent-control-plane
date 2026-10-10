import { describe, expect, it } from 'vitest';
import type {
  CumulativeUsageSnapshot,
  SessionEdge,
  SessionKey,
  UsageTotals,
} from '../src/index.js';
import {
  addUsageTotals,
  aggregateUsage,
  directUsageBySession,
  emptyUsageTotals,
  sessionKeyToString,
  sumTokenCounts,
} from '../src/index.js';
import { key } from './helpers/builders.js';

const allNull = { input: null, output: null, cacheCreation: null, cacheRead: null };

function subagent(parent: SessionKey, child: SessionKey): SessionEdge {
  return {
    kind: 'subagent',
    parent,
    child,
    provenance: 'observed',
    evidence: ['subagent-metadata'],
  };
}

function continuation(parent: SessionKey, child: SessionKey): SessionEdge {
  return {
    kind: 'continuation',
    parent,
    child,
    provenance: 'derived',
    evidence: ['shared-message-history'],
  };
}

function direct(entries: [SessionKey, UsageTotals][]): Map<string, UsageTotals> {
  return new Map(entries.map(([k, t]) => [sessionKeyToString(k), t]));
}

const t = (input: number | null, output: number | null) =>
  sumTokenCounts([{ input, output, cacheCreation: null, cacheRead: null }]);

describe('sumTokenCounts (usage-accounting §6, A3)', () => {
  it('scenario 4: a category that is null on every record stays null, not 0', () => {
    const totals = sumTokenCounts([allNull, allNull]);
    expect(totals.tokens).toEqual(allNull);
    expect(totals.recordCount).toBe(2);
    expect(totals.recordsWithUnavailable).toEqual({
      input: 2,
      output: 2,
      cacheCreation: 2,
      cacheRead: 2,
    });
  });

  it('sums non-null values per category and counts the unavailable ones', () => {
    const totals = sumTokenCounts([
      { input: 3, output: 10, cacheCreation: null, cacheRead: 100 },
      { input: null, output: 5, cacheCreation: null, cacheRead: 0 },
      { input: 4, output: null, cacheCreation: 7, cacheRead: 50 },
    ]);
    expect(totals.tokens).toEqual({ input: 7, output: 15, cacheCreation: 7, cacheRead: 150 });
    expect(totals.recordsWithUnavailable).toEqual({
      input: 1,
      output: 1,
      cacheCreation: 2,
      cacheRead: 0,
    });
  });

  it('keeps a reported 0 distinct from unavailable', () => {
    const totals = sumTokenCounts([{ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }]);
    expect(totals.tokens).toEqual({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
  });

  it('returns all-null totals for no records', () => {
    expect(sumTokenCounts([])).toEqual(emptyUsageTotals());
  });

  it('scenario 3: cumulative snapshots cannot be fed into per-record sums', () => {
    const snapshot: CumulativeUsageSnapshot = {
      kind: 'cumulative-snapshot',
      scope: 'unknown',
      byModel: { 'model-a': { input: 1, output: 1, cacheCreation: 1, cacheRead: 1 } },
      reportedCostUsd: 0.5,
    };
    // @ts-expect-error a snapshot is not a TokenCounts record; it is displayed, never summed
    const attempt = () => sumTokenCounts([snapshot]);
    expect(typeof attempt).toBe('function');
  });
});

describe('addUsageTotals', () => {
  it('is null-preserving and adds unavailable counts', () => {
    const sum = addUsageTotals(t(null, 5), t(null, null));
    expect(sum.tokens.input).toBeNull();
    expect(sum.tokens.output).toBe(5);
    expect(sum.recordCount).toBe(2);
    expect(sum.recordsWithUnavailable.input).toBe(2);
    expect(sum.recordsWithUnavailable.output).toBe(1);
  });
});

describe('directUsageBySession', () => {
  it('sums records per attributed session', () => {
    const byKey = directUsageBySession([
      { session: key('a'), tokens: { input: 1, output: 2, cacheCreation: null, cacheRead: 3 } },
      { session: key('a'), tokens: { input: 1, output: 2, cacheCreation: null, cacheRead: 3 } },
      { session: key('a', 'sub'), tokens: allNull },
    ]);
    expect(byKey.get(sessionKeyToString(key('a')))?.tokens).toEqual({
      input: 2,
      output: 4,
      cacheCreation: null,
      cacheRead: 6,
    });
    expect(byKey.get(sessionKeyToString(key('a', 'sub')))?.tokens).toEqual(allNull);
    expect(byKey.size).toBe(2);
  });
});

describe('aggregateUsage (usage-accounting §6, A3)', () => {
  const root = key('root');
  const sub1 = key('root', 'a1');
  const sub2 = key('root', 'a2');
  const nested = key('root', 'a3');
  const fork = key('fork');

  it('equals direct usage plus subagent descendants', () => {
    const agg = aggregateUsage(
      root,
      direct([
        [root, t(1, 10)],
        [sub1, t(2, 20)],
        [sub2, t(null, 30)],
        [nested, t(4, 40)],
      ]),
      [subagent(root, sub1), subagent(root, sub2), subagent(sub1, nested)],
    );
    expect(agg.tokens.input).toBe(7);
    expect(agg.tokens.output).toBe(100);
    expect(agg.recordsWithUnavailable.input).toBe(1);
    expect(agg.recordCount).toBe(4);
    expect(agg.sessionCount).toBe(4);
    expect(agg.cycleDetected).toBe(false);
  });

  it('excludes continuation children', () => {
    const agg = aggregateUsage(
      root,
      direct([
        [root, t(1, 10)],
        [fork, t(100, 1000)],
      ]),
      [continuation(root, fork)],
    );
    expect(agg.tokens).toEqual(t(1, 10).tokens);
    expect(agg.sessionCount).toBe(1);
  });

  it('does not follow subagent edges hanging off a continuation child', () => {
    const forkSub = key('fork', 'b1');
    const agg = aggregateUsage(
      root,
      direct([
        [root, t(1, 1)],
        [fork, t(10, 10)],
        [forkSub, t(100, 100)],
      ]),
      [continuation(root, fork), subagent(fork, forkSub)],
    );
    expect(agg.tokens.output).toBe(1);
  });

  it('keeps categories null when the root and all descendants lack them', () => {
    const agg = aggregateUsage(
      root,
      direct([
        [root, sumTokenCounts([allNull])],
        [sub1, sumTokenCounts([allNull])],
      ]),
      [subagent(root, sub1)],
    );
    expect(agg.tokens).toEqual(allNull);
    expect(agg.recordsWithUnavailable.output).toBe(2);
  });

  it('treats a session without records as contributing nothing', () => {
    const agg = aggregateUsage(root, direct([[sub1, t(2, 2)]]), [subagent(root, sub1)]);
    expect(agg.tokens.output).toBe(2);
    expect(agg.sessionCount).toBe(2);
    expect(aggregateUsage(root, new Map(), []).tokens).toEqual(allNull);
  });

  it('detects and ignores cycles instead of looping forever', () => {
    const agg = aggregateUsage(
      root,
      direct([
        [root, t(1, 1)],
        [sub1, t(1, 1)],
        [sub2, t(1, 1)],
      ]),
      [subagent(root, sub1), subagent(sub1, sub2), subagent(sub2, root), subagent(sub2, sub2)],
    );
    expect(agg.tokens.output).toBe(3);
    expect(agg.sessionCount).toBe(3);
    expect(agg.cycleDetected).toBe(true);
  });

  it('counts a session reachable along two paths once, without reporting a cycle', () => {
    const agg = aggregateUsage(
      root,
      direct([
        [root, t(1, 1)],
        [sub1, t(1, 1)],
        [sub2, t(1, 1)],
        [nested, t(1, 1)],
      ]),
      [subagent(root, sub1), subagent(root, sub2), subagent(sub1, nested), subagent(sub2, nested)],
    );
    expect(agg.tokens.output).toBe(4);
    expect(agg.cycleDetected).toBe(false);
  });

  it('handles a long chain without recursion limits', () => {
    const chain: SessionKey[] = Array.from({ length: 20_000 }, (_, i) => key('root', `a${i}`));
    const edges = chain.map((child, i) => subagent(i === 0 ? root : (chain[i - 1] ?? root), child));
    const agg = aggregateUsage(root, direct(chain.map((k) => [k, t(1, 1)])), edges);
    expect(agg.tokens.output).toBe(20_000);
  });
});
