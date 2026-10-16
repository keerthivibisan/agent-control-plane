import type { CheckRunDto } from '@acp/core/api';
import { useCallback, useSyncExternalStore } from 'react';
import {
  ApiError,
  isBoardPath,
  isProjectSetupPath,
  runHarnessChecks,
  type ApiClient,
} from '../../lib/api';
import { useQueryStore } from '../../lib/query';
import type { QueryStore } from '../../lib/query-store';

/**
 * "Run checks now" attempts on a project's main branch, kept in memory for as long as the app is
 * open. There is no API that lists past main-branch runs yet (docs/redesign/wp/R-E.md, blocked
 * part), so the Harness page shows the runs started in this app session, and says so. Keeping
 * them here rather than in the page lets the ⌘K "Run checks" action start a run that the page
 * then shows, and lets a run finish while the owner looks at another page.
 */
export interface MainCheckAttempt {
  /** Local id, for React keys only. */
  id: string;
  projectId: string;
  /** When the owner started it (this browser's clock). */
  startedAt: string;
  state: 'running' | 'finished' | 'failed';
  /** The server's results, in run order; null until finished. */
  results: CheckRunDto[] | null;
  error: ApiError | null;
}

const NO_ATTEMPTS: readonly MainCheckAttempt[] = Object.freeze([]);

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path: '',
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

export class MainCheckRuns {
  private readonly byProject = new Map<string, readonly MainCheckAttempt[]>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  constructor(
    private readonly client: ApiClient,
    /** Refetches cached views once a run ends (the harness status, the board). */
    private readonly invalidate: (match: (key: string) => boolean) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Newest first. The same array until something changes (for useSyncExternalStore). */
  attempts(projectId: string): readonly MainCheckAttempt[] {
    return this.byProject.get(projectId) ?? NO_ATTEMPTS;
  }

  running(projectId: string): boolean {
    return this.attempts(projectId)[0]?.state === 'running';
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Starts a run unless one from this app is still going (the server would refuse a second one
   * with `checks_running` anyway). Resolves when the run has ended; never rejects, the error is
   * kept on the attempt.
   */
  async start(projectId: string): Promise<void> {
    if (this.running(projectId)) return;
    const attempt: MainCheckAttempt = {
      id: `main-${++this.seq}`,
      projectId,
      startedAt: this.now().toISOString(),
      state: 'running',
      results: null,
      error: null,
    };
    this.put(projectId, [attempt, ...this.attempts(projectId)]);
    let done: MainCheckAttempt;
    try {
      const results = await runHarnessChecks(this.client, projectId);
      done = { ...attempt, state: 'finished', results };
    } catch (e) {
      done = { ...attempt, state: 'failed', error: toApiError(e) };
    }
    this.put(
      projectId,
      this.attempts(projectId).map((a) => (a.id === attempt.id ? done : a)),
    );
    const setup = isProjectSetupPath(projectId);
    this.invalidate((key) => setup(key) || isBoardPath(key));
  }

  private put(projectId: string, list: readonly MainCheckAttempt[]): void {
    this.byProject.set(projectId, list);
    for (const l of [...this.listeners]) l();
  }
}

/** One instance per query store, so every test (and the app) starts with an empty history. */
const instances = new WeakMap<QueryStore, MainCheckRuns>();

export function mainCheckRunsFor(store: QueryStore): MainCheckRuns {
  let runs = instances.get(store);
  if (runs === undefined) {
    runs = new MainCheckRuns(store.client, (match) => store.invalidate(match));
    instances.set(store, runs);
  }
  return runs;
}

/** The project's attempts (newest first) and a stable `start`. */
export function useMainCheckRuns(projectId: string) {
  const runs = mainCheckRunsFor(useQueryStore());
  const subscribe = useCallback((l: () => void) => runs.subscribe(l), [runs]);
  const snapshot = useCallback(() => runs.attempts(projectId), [runs, projectId]);
  const attempts = useSyncExternalStore(subscribe, snapshot, snapshot);
  const start = useCallback(() => runs.start(projectId), [runs, projectId]);
  return { attempts, running: attempts[0]?.state === 'running', start };
}
