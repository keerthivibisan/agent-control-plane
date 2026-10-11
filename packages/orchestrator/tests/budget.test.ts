import { budgetTokens } from '@acp/core';
import type { TokenCounts } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEDGER,
  agentBudgetUsage,
  agentEvent,
  budgetOvershoot,
  compareUsage,
  recordUsage,
} from '../src/index.js';
import type { RunState, UsageLedger } from '../src/index.js';
import {
  LEAD,
  agentOf,
  event,
  makeCtx,
  ok,
  runningRun,
  startWorker,
  statusOf,
  tokens,
} from './helpers.js';

/** ADR-0014 budget accounting, usage-accounting §4–§5 dedup. Synthetic data, seeded PRNG. */

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

describe('ledger', () => {
  it('counts output + uncached input + cache write, never cache reads', () => {
    const l = recordUsage(EMPTY_LEDGER, 'a', 'm1', {
      input: 10,
      output: 20,
      cacheCreation: 5,
      cacheRead: 1_000_000,
    });
    expect(agentBudgetUsage(l, 'a')).toEqual({
      used: 35,
      countedMessages: 1,
      unavailableMessages: 0,
    });
  });

  it('dedups repeated reports of one message and keeps the max-output observation', () => {
    let l = recordUsage(EMPTY_LEDGER, 'a', 'm1', tokens(5));
    l = recordUsage(l, 'a', 'm1', tokens(50));
    l = recordUsage(l, 'a', 'm1', tokens(20));
    expect(agentBudgetUsage(l, 'a').used).toBe(60);
    expect(Object.keys(l.entries)).toEqual(['m1']);
  });

  it('never sums cumulative snapshots of one message', () => {
    let l: UsageLedger = EMPTY_LEDGER;
    for (const out of [1, 2, 3, 4]) l = recordUsage(l, 'a', 'm1', tokens(out, 0, 0, 0));
    expect(agentBudgetUsage(l, 'a').used).toBe(4);
  });

  it('treats a message with no counted category as unavailable, not 0 usage', () => {
    const l = recordUsage(EMPTY_LEDGER, 'a', 'm1', {
      input: null,
      output: null,
      cacheCreation: null,
      cacheRead: 99,
    });
    expect(budgetTokens(l.entries.m1?.tokens ?? tokens(0))).toBeNull();
    expect(agentBudgetUsage(l, 'a')).toEqual({
      used: 0,
      countedMessages: 0,
      unavailableMessages: 1,
    });
  });

  it('dedups globally across agents and charges one agent deterministically', () => {
    let l = recordUsage(EMPTY_LEDGER, 'b', 'm1', tokens(30));
    l = recordUsage(l, 'a', 'm1', tokens(30));
    expect(agentBudgetUsage(l, 'a').used).toBe(40);
    expect(agentBudgetUsage(l, 'b').used).toBe(0);
  });

  it('accepts any messageId, including "__proto__"', () => {
    const l = recordUsage(EMPTY_LEDGER, 'a', '__proto__', tokens(7, 0, 0, 0));
    expect(agentBudgetUsage(l, 'a').used).toBe(7);
    expect(Object.hasOwn(l.entries, '__proto__')).toBe(true);
  });

  it('does not mutate the input ledger', () => {
    const l1 = recordUsage(EMPTY_LEDGER, 'a', 'm1', tokens(1));
    const snapshot = JSON.stringify(l1);
    recordUsage(l1, 'a', 'm1', tokens(9));
    recordUsage(l1, 'a', 'm2', tokens(9));
    expect(JSON.stringify(l1)).toBe(snapshot);
    expect(Object.keys(EMPTY_LEDGER.entries)).toHaveLength(0);
  });

  it('orders observations by output, null lowest', () => {
    expect(compareUsage(tokens(1), tokens(null))).toBeGreaterThan(0);
    expect(compareUsage(tokens(5, 1), tokens(5, 2))).toBeLessThan(0);
    expect(compareUsage(tokens(5), tokens(5))).toBe(0);
  });

  it('reports overshoot past the cap only', () => {
    expect(budgetOvershoot(90, 100)).toBe(0);
    expect(budgetOvershoot(130, 100)).toBe(30);
  });
});

describe('property: usage replay order does not change budgets', () => {
  interface Report {
    agent: string;
    messageId: string;
    tokens: TokenCounts;
  }
  const maybe = (r: () => number, max: number): number | null =>
    r() < 0.15 ? null : Math.floor(r() * max);

  function reports(seed: number): Report[] {
    const r = prng(seed);
    const out: Report[] = [];
    for (let m = 0; m < 25; m++) {
      const agent = ['lead', 'w1', 'w2', 'w3'][Math.floor(r() * 4)] ?? 'lead';
      const repeats = 1 + Math.floor(r() * 4);
      for (let k = 0; k < repeats; k++) {
        // Occasionally the same message is also reported by another agent.
        const reporter = r() < 0.1 ? 'w9' : agent;
        out.push({
          agent: reporter,
          messageId: `msg-${m}`,
          tokens: {
            input: maybe(r, 50),
            output: maybe(r, 500),
            cacheCreation: maybe(r, 100),
            cacheRead: maybe(r, 1e6),
          },
        });
      }
    }
    return out;
  }

  const replay = (rs: readonly Report[]): Record<string, number> => {
    let l: UsageLedger = EMPTY_LEDGER;
    for (const x of rs) l = recordUsage(l, x.agent, x.messageId, x.tokens);
    return Object.fromEntries(
      ['lead', 'w1', 'w2', 'w3', 'w9'].map((a) => [a, agentBudgetUsage(l, a).used]),
    );
  };

  for (const seed of [1, 7, 42, 1234, 99991]) {
    it(`seed ${seed}: 50 shuffles give identical per-agent budgets`, () => {
      const base = reports(seed);
      const expected = replay(base);
      const r = prng(seed * 31 + 1);
      for (let i = 0; i < 50; i++) expect(replay(shuffle(base, r))).toEqual(expected);
    });
  }

  it('the engine gives the same agent budgets and statuses for shuffled usage events', () => {
    const base = runningRun(1_000_000);
    const { state: withWorker, id } = startWorker(base);
    const r = prng(5);
    const events: { agent: string; messageId: string; tokens: TokenCounts }[] = [];
    for (let m = 0; m < 30; m++) {
      for (let k = 0; k < 3; k++) {
        events.push({
          agent: m % 2 === 0 ? LEAD : id,
          messageId: `m${m}`,
          tokens: {
            input: maybe(r, 50),
            output: maybe(r, 500),
            cacheCreation: maybe(r, 100),
            cacheRead: 10,
          },
        });
      }
    }
    const run = (es: typeof events): RunState => {
      let s = withWorker;
      for (const e of es) {
        s = ok(
          agentEvent(
            s,
            e.agent,
            { type: 'usage', messageId: e.messageId, tokens: e.tokens },
            makeCtx(5000),
          ),
        ).state;
      }
      return s;
    };
    const expected = run(events);
    for (let i = 0; i < 20; i++) {
      const got = run(shuffle(events, r));
      expect(agentOf(got, LEAD).budgetTokensUsed).toBe(agentOf(expected, LEAD).budgetTokensUsed);
      expect(agentOf(got, id).budgetTokensUsed).toBe(agentOf(expected, id).budgetTokensUsed);
    }
  });
});

describe('soft cap in the engine', () => {
  it('moves a running agent to BLOCKED, interrupts it and asks for a budget-raise', () => {
    const started = startWorker(runningRun(100));
    const id = started.id;
    let state = started.state;
    const result = ok(
      event(state, id, { type: 'usage', messageId: 'm1', tokens: tokens(80, 40, 0) }),
    );
    state = result.state;
    expect(statusOf(state, id)).toBe('BLOCKED');
    expect(agentOf(state, id).budgetTokensUsed).toBe(120);
    const approval = state.approvals.find((a) => a.kind === 'budget-raise');
    expect(approval?.status).toBe('pending');
    expect(approval?.summary).toBe('Budget reached: 120 of 100 budget tokens used');
    expect(result.effects.map((e) => e.type)).toEqual([
      'budget-overshoot',
      'interrupt-agent',
      'approval-requested',
    ]);
    expect(result.effects[0]).toEqual({
      type: 'budget-overshoot',
      agentRunId: id,
      used: 120,
      limit: 100,
      overshoot: 20,
    });
  });

  it('reports further overshoot from in-flight calls without a second approval', () => {
    const started = startWorker(runningRun(100));
    const id = started.id;
    let state = started.state;
    state = ok(
      event(state, id, { type: 'usage', messageId: 'm1', tokens: tokens(100, 0, 0) }),
    ).state;
    const more = ok(event(state, id, { type: 'usage', messageId: 'm2', tokens: tokens(25, 0, 0) }));
    expect(more.effects).toEqual([
      { type: 'budget-overshoot', agentRunId: id, used: 125, limit: 100, overshoot: 25 },
    ]);
    expect(more.state.approvals.filter((a) => a.kind === 'budget-raise')).toHaveLength(1);
  });

  it('counts usage that arrives after an agent ended', () => {
    const started = startWorker(runningRun());
    const id = started.id;
    let state = started.state;
    state = ok(
      event(state, id, { type: 'finished', outcome: 'success', reportedCostUsd: 0.5 }),
    ).state;
    state = ok(
      event(state, id, { type: 'usage', messageId: 'late', tokens: tokens(5, 5, 0) }),
    ).state;
    expect(agentOf(state, id).budgetTokensUsed).toBe(10);
    expect(statusOf(state, id)).toBe('SUCCEEDED');
  });

  it('flags invalid usage as a content-free diagnostic and records nothing', () => {
    const { state, id } = startWorker(runningRun());
    const bad = ok(
      event(state, id, {
        type: 'usage',
        messageId: 'm1',
        tokens: { input: -1, output: 2, cacheCreation: 0, cacheRead: 0 },
      }),
    );
    expect(bad.effects).toEqual([{ type: 'diagnostic', code: 'invalid-usage', agentRunId: id }]);
    expect(Object.keys(bad.state.ledger.entries)).toHaveLength(0);
  });
});
