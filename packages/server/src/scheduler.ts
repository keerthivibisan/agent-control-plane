import type { ObservationAdapter, RegisteredRoot } from '@acp/core';
import type { Repositories } from '@acp/db';
import type { Logger } from './logger.js';
import type { Pipeline } from './pipeline/ingest.js';

/**
 * Drives ingestion: an interval poll plus immediate polls requested by hooks and project
 * registration. A poll walks every allowlisted source of every adapter, so running two polls at
 * once could read the same file twice. Polls are therefore single-flight: a request that arrives
 * during a poll coalesces into exactly one follow-up poll that starts when the current one ends.
 */

export interface SchedulerStats {
  polls: number;
  pollErrors: number;
  batchesIngested: number;
  eventsInserted: number;
  lastPollAt: string | null;
}

export interface Scheduler {
  start(): void;
  /** Stops the timer and waits for an in-flight poll to finish. */
  stop(): Promise<void>;
  /** Requests a poll as soon as possible; resolves when a poll that began after the call is done. */
  pollNow(): Promise<void>;
  stats(): SchedulerStats;
}

export interface SchedulerDeps {
  adapters: readonly ObservationAdapter[];
  repos: Repositories;
  pipeline: Pipeline;
  logger: Logger;
  now: () => Date;
  intervalMs: number;
  /** Injected for tests. */
  timers?: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const timers = deps.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const stats: SchedulerStats = {
    polls: 0,
    pollErrors: 0,
    batchesIngested: 0,
    eventsInserted: 0,
    lastPollAt: null,
  };
  let stopped = true;
  let timer: unknown;
  let current: Promise<void> | null = null;
  let rerun: Promise<void> | null = null;

  async function pollOnce(): Promise<void> {
    stats.polls++;
    const roots: RegisteredRoot[] = deps.repos.projects
      .list()
      .map((p) => ({ projectId: p.id, rootPath: p.rootPath }));
    for (const adapter of deps.adapters) {
      try {
        for await (const batch of adapter.poll(roots, deps.repos.checkpoints)) {
          const result = deps.pipeline.ingestBatch(batch);
          stats.batchesIngested++;
          stats.eventsInserted += result.inserted;
        }
      } catch (error) {
        // One failing adapter or batch must not stop the others; it is counted and logged.
        stats.pollErrors++;
        deps.logger.log('error', 'poll failed', {
          provider: adapter.provider,
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    stats.lastPollAt = deps.now().toISOString();
  }

  function schedule(): void {
    if (stopped) return;
    timer = timers.set(() => {
      void run().finally(schedule);
    }, deps.intervalMs);
  }

  function run(): Promise<void> {
    if (current !== null) {
      // A poll is in flight: queue one follow-up and share it among all callers.
      rerun ??= current.then(() => {
        rerun = null;
        return run();
      });
      return rerun;
    }
    current = pollOnce().finally(() => {
      current = null;
    });
    return current;
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void run().finally(schedule);
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) timers.clear(timer);
      while (current !== null || rerun !== null) await (rerun ?? current);
    },
    pollNow: run,
    stats: () => ({ ...stats }),
  };
}
