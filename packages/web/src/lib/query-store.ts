import { ApiError, type ApiClient, type Schema } from './api';

/**
 * A tiny query cache keyed by API path (no external dependency). Components subscribe with
 * `useApiQuery`; SSE notices call `invalidate`, which refetches the affected keys in place while the
 * previous data stays on screen.
 *
 * At most one request per key is in flight. Notices come in bursts, and aborting a request only
 * stops the browser waiting: the server still runs it. Restarting on every notice sent the server
 * several copies of the same request at once, and some routes can't run twice at the same time
 * (a run's review stages the helper's worktree, and two `git add` calls collide on its index).
 * So a notice during a request marks the key stale, and it is fetched once more when the request
 * ends: the data is as fresh as before, with no overlap.
 */
export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  /** True while a request for this key is in flight (first load or refetch). */
  fetching: boolean;
}

interface Entry {
  state: QueryState<unknown>;
  schema: Schema<unknown>;
  listeners: Set<() => void>;
  /** True while a request for this key is in flight. */
  inFlight: boolean;
  /** Invalidated while in flight: fetch again once the current request ends. */
  stale: boolean;
}

const INITIAL: QueryState<never> = Object.freeze({ data: undefined, error: null, fetching: true });

function toApiError(path: string, e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError({
    kind: 'parse',
    path,
    message: e instanceof Error ? e.message : 'unknown client error',
  });
}

export class QueryStore {
  private readonly entries = new Map<string, Entry>();

  constructor(readonly client: ApiClient) {}

  getState<T>(key: string): QueryState<T> {
    return (this.entries.get(key)?.state as QueryState<T> | undefined) ?? INITIAL;
  }

  subscribe<T>(key: string, schema: Schema<T>, listener: () => void): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        state: INITIAL,
        schema,
        listeners: new Set(),
        inFlight: false,
        stale: false,
      };
      this.entries.set(key, entry);
      entry.listeners.add(listener);
      void this.fetch(key);
    } else {
      const wasIdle = entry.listeners.size === 0 && !entry.state.fetching;
      entry.listeners.add(listener);
      // Remounting a screen shows the cached data and revalidates it.
      if (wasIdle) void this.fetch(key);
    }
    const e = entry;
    return () => {
      e.listeners.delete(listener);
    };
  }

  /** Refetch every key matching `match` that something is watching; forget the rest. */
  invalidate(match: (key: string) => boolean): void {
    for (const [key, entry] of [...this.entries]) {
      if (!match(key)) continue;
      if (entry.listeners.size > 0) void this.fetch(key);
      // In flight: the request's end refetches or forgets it, so two never overlap.
      else if (entry.inFlight) entry.stale = true;
      else this.entries.delete(key);
    }
  }

  invalidateAll(): void {
    this.invalidate(() => true);
  }

  private set(entry: Entry, next: QueryState<unknown>): void {
    entry.state = next;
    for (const l of [...entry.listeners]) l();
  }

  private async fetch(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.inFlight) {
      entry.stale = true;
      return;
    }
    entry.inFlight = true;
    entry.stale = false;
    if (!entry.state.fetching) this.set(entry, { ...entry.state, fetching: true });
    let next: QueryState<unknown>;
    try {
      const data = await this.client.get(key, entry.schema);
      next = { data, error: null, fetching: false };
    } catch (e) {
      // Keep the last good data visible next to the error, so a failed refetch is shown, not hidden.
      next = { data: entry.state.data, error: toApiError(key, e), fetching: false };
    }
    entry.inFlight = false;
    if (!entry.stale) {
      this.set(entry, next);
      return;
    }
    // Invalidated meanwhile: show this answer and fetch again while something watches the key;
    // with nobody watching, forget it as `invalidate` would have.
    entry.stale = false;
    if (entry.listeners.size === 0) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      return;
    }
    this.set(entry, { ...next, fetching: true });
    void this.fetch(key);
  }
}
