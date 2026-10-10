import { ApiError, type ApiClient, type Schema } from './api';

/**
 * A tiny query cache keyed by API path (no external dependency). Components subscribe with
 * `useApiQuery`; SSE notices call `invalidate`, which refetches the affected keys in place while the
 * previous data stays on screen.
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
  controller: AbortController | null;
  /** Incremented per request so a slow, superseded response can't overwrite a newer one. */
  generation: number;
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
        controller: null,
        generation: 0,
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
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    const generation = ++entry.generation;
    if (!entry.state.fetching) this.set(entry, { ...entry.state, fetching: true });
    try {
      const data = await this.client.get(key, entry.schema, controller.signal);
      if (entry.generation !== generation) return;
      this.set(entry, { data, error: null, fetching: false });
    } catch (e) {
      if (entry.generation !== generation) return;
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // Keep the last good data visible next to the error, so a failed refetch is shown, not hidden.
      this.set(entry, { data: entry.state.data, error: toApiError(key, e), fetching: false });
    } finally {
      if (entry.controller === controller) entry.controller = null;
    }
  }
}
