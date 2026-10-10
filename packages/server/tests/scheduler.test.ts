import { describe, expect, it } from 'vitest';
import type { IngestionBatch, ObservationAdapter } from '@acp/core';
import { createScheduler } from '../src/scheduler.js';
import { silentLogger } from '../src/logger.js';
import { batch, setupPipeline, tokens, usage } from './helpers.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** An adapter whose poll blocks until released, recording overlap. */
function blockingAdapter(batches: IngestionBatch[] = []) {
  const state = { active: 0, maxActive: 0, started: 0, gates: [] as ReturnType<typeof deferred>[] };
  const adapter: ObservationAdapter = {
    provider: 'claude-code',
    capabilities: () => Promise.reject(new Error('unused')),
    discoverCandidates: () => Promise.resolve([]),
    normalizeHook: () => [],
    diagnostics: () => ({ fileIssues: [], ignoredRecords: {}, parseErrors: 0 }),
    async *poll() {
      state.started++;
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      const gate = deferred();
      state.gates.push(gate);
      try {
        await gate.promise;
        for (const b of batches) yield b;
      } finally {
        state.active--;
      }
    },
  };
  return { adapter, state };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('scheduler', () => {
  it('never runs two polls at once and coalesces requests made during a poll into one rerun', async () => {
    const s = setupPipeline();
    const { adapter, state } = blockingAdapter();
    const scheduler = createScheduler({
      adapters: [adapter],
      repos: s.repos,
      pipeline: s.pipeline,
      logger: silentLogger,
      now: () => new Date(0),
      intervalMs: 60_000,
    });

    const first = scheduler.pollNow();
    await tick();
    // Three requests while the first poll is blocked.
    const queued = [scheduler.pollNow(), scheduler.pollNow(), scheduler.pollNow()];
    await tick();
    expect(state.started).toBe(1);

    state.gates[0]!.resolve();
    await first;
    await tick();
    expect(state.started).toBe(2);
    state.gates[1]!.resolve();
    await Promise.all(queued);

    expect(state.started).toBe(2);
    expect(state.maxActive).toBe(1);
    expect(scheduler.stats().polls).toBe(2);
  });

  it('ingests adapter batches through the pipeline and counts what it inserted', async () => {
    const s = setupPipeline();
    const b = batch('/src/a.jsonl', [usage({ dedupKey: 'u1' }, 'msg-1', tokens(1, 2))]);
    const { adapter, state } = blockingAdapter([b]);
    const scheduler = createScheduler({
      adapters: [adapter],
      repos: s.repos,
      pipeline: s.pipeline,
      logger: silentLogger,
      now: () => new Date('2026-10-10T08:00:00.000Z'),
      intervalMs: 60_000,
    });
    const done = scheduler.pollNow();
    await tick();
    state.gates[0]!.resolve();
    await done;
    expect(scheduler.stats()).toMatchObject({
      batchesIngested: 1,
      eventsInserted: 1,
      lastPollAt: '2026-10-10T08:00:00.000Z',
    });
    expect(s.repos.checkpoints.get('/src/a.jsonl')).toBeDefined();
  });

  it('counts a failing adapter and still polls the others', async () => {
    const s = setupPipeline();
    const failing: ObservationAdapter = {
      ...blockingAdapter().adapter,
      poll: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('boom')) }),
      }),
    };
    const b = batch('/src/b.jsonl', [usage({ dedupKey: 'u2' }, 'msg-2', tokens(1, 2))]);
    const ok = blockingAdapter([b]);
    const scheduler = createScheduler({
      adapters: [failing, ok.adapter],
      repos: s.repos,
      pipeline: s.pipeline,
      logger: silentLogger,
      now: () => new Date(0),
      intervalMs: 60_000,
    });
    const done = scheduler.pollNow();
    await tick();
    ok.state.gates[0]!.resolve();
    await done;
    expect(scheduler.stats()).toMatchObject({ pollErrors: 1, eventsInserted: 1 });
  });

  it('polls on the interval and stop() waits for the in-flight poll and cancels the timer', async () => {
    const s = setupPipeline();
    const fired: (() => void)[] = [];
    let cleared = 0;
    const { adapter, state } = blockingAdapter();
    const scheduler = createScheduler({
      adapters: [adapter],
      repos: s.repos,
      pipeline: s.pipeline,
      logger: silentLogger,
      now: () => new Date(0),
      intervalMs: 5000,
      timers: { set: (fn) => (fired.push(fn), fired.length), clear: () => void cleared++ },
    });
    scheduler.start();
    await tick();
    state.gates[0]!.resolve();
    await tick();
    expect(fired.length).toBe(1); // next poll scheduled after the first completes
    fired[0]!();
    await tick();
    expect(state.started).toBe(2);

    const stopping = scheduler.stop();
    state.gates[1]!.resolve();
    await stopping;
    expect(cleared).toBe(1);
    expect(state.active).toBe(0);
  });
});
